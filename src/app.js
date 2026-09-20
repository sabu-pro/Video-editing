import { uid, clamp, clone, DEFAULT_EFFECTS, EFFECT_PRESETS, createProject, createClip, duration, timecode, deleteClips, animatedValue, setKeyframe, insertGap, overwriteRange, parseSrt, serializeSrt, validateProject, History } from './core.js';
import { MediaEngine, readAsset, waveform, makeDemoAudio, openDatabase, dbRead, dbAll, dbWrite } from './engine.js';
import { icon, hydrateIcons } from './icons.js';
import { finalizeWebm } from './webm.js';
import { quantize, toFrame, endTime, floorFrames, normalizeTiming, FrameClock } from './timing.js';
import { resolveSnap } from './snapping.js';
import { linkedIds, editableIds, linkClips, unlinkClips } from './links.js';
import { cutClips, moveClips, trimBounds, trimLinked, slipLinked, changeSpeed, audioCompanion, separateAudio } from './editing.js';
import { MeterBallistics, dbToPercent } from './audio-meter.js';
import { waveformPath } from './waveforms.js';
import { removeProjectAsset, keyframeTime, changeKeyframe } from './core.js';

const $=(selector,root=document)=>root.querySelector(selector), $$=(selector,root=document)=>[...root.querySelectorAll(selector)];
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let project=createProject(), assets=new Map(), selected=new Set(), selectedAsset=null;
let playhead=3.5, playing=false, playbackRate=1, loop=false, snapping=true, tool='select', zoom=36, libraryTab='media', inspectorTab='video', assetView='grid', searchText='';
let db=null, saveTimer, saving=false, saveAgain=false, exporting=false, stopExport=null, clipboard=[], inputSnapshot=false, modalSubmit=null, dragDepth=0;
let history=new History(), lastFrame=0, lastUiFrame=0, sourceRange=null, trackZoom=60;
const transportClock=new FrameClock();
const clockNow=()=>engine.audio?.state==='running'?engine.audio.currentTime:performance.now()/1000;
let focusedClipId=null;
let editingContext='timeline';
let automationProperty='scale',automationIndex=-1;
const activeAssets=()=>[...assets.values()].filter(a=>!project.removedAssetIds?.includes(a.id));
const meter=new MeterBallistics();
let clipElements=new Map();
const engine=new MediaEngine($('#preview'),assets,()=>project,message=>{toast(message,true);if(exporting)stopExport?.(message);});
const primaryClip=()=>project.clips.find(c=>c.id===focusedClipId&&selected.has(c.id))||project.clips.find(c=>selected.has(c.id));
const trackLocked=c=>project.tracks.find(t=>t.id===c.track)?.locked;
const assetIcon=a=>({image:'image',audio:'music',video:'film',title:'type',color:'color'}[a.type]||'film');

function toast(message,error=false){const el=document.createElement('div');el.className=`toast${error?' error':''}`;el.textContent=message;$('#toast-stack').append(el);setTimeout(()=>el.remove(),error?7000:3800);}
function status(message){$('#status-text').textContent=message;}
function snapshot(){if(exporting)return false;history.push(project);return true;}
function changed({inspector=true,timeline=true}={}) {
  playhead=clamp(quantize(playhead,project.fps),0,duration(project));
  if(timeline)renderTimeline();if(inspector)renderInspector();renderHeader();engine.sync(playhead,playing);queueSave();
}
function edit(fn,options){if(!snapshot())return;fn();changed(options);}
function renderHeader(){
  $('#project-name').textContent=project.name;document.title=`${project.name} — Cutline Studio`;
  $('#sequence-label').textContent=project.sequence;$('#timeline-sequence-name').textContent=project.sequence;
  $('#sequence-spec').innerHTML=`${project.width} × ${project.height} <span>${project.fps} fps</span>`;
  $('#timeline-duration').textContent=`${duration(project).toFixed(2)} seconds`;
  $('#selection-status').textContent=selected.size?`${selected.size} clip${selected.size>1?'s':''} selected`:'No clip selected';
  $('[data-action="undo"]').disabled=!history.past.length;$('[data-action="redo"]').disabled=!history.future.length;
  $('#preview-empty').hidden=project.clips.length>0;
  $('#monitor-seek').max=duration(project)||1;$('#monitor-seek').step=1/project.fps;
  $('#total-time').textContent=timecode(duration(project),project.fps);
}
function queueSave(){clearTimeout(saveTimer);$('#save-status').textContent='Saving…';saveTimer=setTimeout(saveSession,650);}
async function saveSession(){
  if(!db){$('#save-status').textContent='Session only';return;}
  if(saving){saveAgain=true;return;}saving=true;
  try{await dbWrite(db,'session',{project:clone(project),assetIds:activeAssets().map(a=>a.id),playhead,view:{trackZoom,zoom}},'current');$('#save-status').textContent='Saved locally';}
  catch{ $('#save-status').textContent='Save failed';toast('Browser storage is full or unavailable. Save a project file to keep your work.',true);}
  finally{saving=false;if(saveAgain){saveAgain=false;queueSave();}}
}
async function storeAsset(asset){if(db){const {url,...stored}=asset;try{await dbWrite(db,'assets',stored);}catch{toast('Media could not be cached. Save a portable project file before closing.',true);}}}
function seek(time,{refreshInspector=false}={}){
  if(exporting)return;playhead=clamp(quantize(time,project.fps),0,duration(project));
  if(playing)transportClock.start(playhead,clockNow(),playbackRate);
  engine.sync(playhead,playing);updateTime();if(refreshInspector)renderInspector();
}
function updateTime(){
  const text=timecode(playhead,project.fps);$('#current-time').textContent=text;$('#timeline-time').textContent=text;$('#monitor-seek').value=playhead;
  $('#playhead').style.left=`${playhead*zoom}px`;
}
async function play(rate=1){
  if(exporting||!project.clips.length)return;
  try{await engine.audioInit();}catch(e){toast(`Audio could not start: ${e.message}`,true);}
  playbackRate=rate;engine.playbackMultiplier=Math.max(1,rate);if(playhead>=duration(project)&&rate>0)playhead=project.inPoint??0;if(playhead<=0&&rate<0)playhead=duration(project);
  transportClock.start(playhead,clockNow(),rate);playing=true;lastFrame=performance.now();$('#play-button').innerHTML=icon('pause');status(rate===1?'Playing sequence':`Playback ${rate}×`);
}
function pause(){playing=false;engine.pause();$('#play-button').innerHTML=icon('play');status('Paused');renderInspector();queueSave();}
function togglePlay(){playing?pause():play();}
function tick(now){
  requestAnimationFrame(tick);
  if(exporting)return;
  if(playing){
    playhead=transportClock.time(clockNow(),project.fps);
    const end=loop?(project.outPoint??duration(project)):duration(project),start=loop?(project.inPoint??0):0;
    if(playhead>=end||playhead<start){if(loop){playhead=playbackRate>0?start:Math.max(start,end-1/project.fps);transportClock.start(playhead,clockNow(),playbackRate);}else{playhead=clamp(playhead,0,duration(project));pause();}}
    engine.sync(playhead,playing&&playbackRate>0);
    if(now-lastUiFrame>32){lastUiFrame=now;updateTime();updateMeter(now);}
  }else if(now-lastUiFrame>32){lastUiFrame=now;updateMeter(now);}
}
function updateMeter(now){const channels=meter.update(engine.level(),now/1000);channels.forEach((c,i)=>{const side=i?'right':'left';$('#meter-'+side).style.setProperty('--meter-height',`${dbToPercent(c.db)}%`);$('#peak-'+side).style.bottom=`${dbToPercent(c.hold)}%`;$('#clip-'+side).classList.toggle('clipped',c.clipping);$('#meter-'+side).dataset.db=c.db.toFixed(1);$('#level-'+side).textContent=c.hold<=-60?'??':c.hold.toFixed(1);});}
function applyPreviewSize(){const q=Number($('#preview-quality').value);$('#preview').width=Math.round(project.width*q);$('#preview').height=Math.round(project.height*q);$('#preview').style.aspectRatio=`${project.width}/${project.height}`;engine.render();}

function renderLibrary(){
  if(project.removedAssetIds?.includes(selectedAsset))selectedAsset=null;
  $$('[data-library]').forEach(b=>b.classList.toggle('active',b.dataset.library===libraryTab));
  $('#asset-count').textContent=libraryTab==='media'?`${activeAssets().length} items`:libraryTab==='effects'?`${EFFECT_PRESETS.length} effects`:'4 templates';
  const content=$('#library-content');
  if(libraryTab==='media'){
    const filtered=activeAssets().filter(a=>a.name.toLowerCase().includes(searchText.toLowerCase()));
    content.innerHTML=`<div class="library-topline"><span class="breadcrumb">${icon('folder')}<span>${esc(project.name)}</span>${icon('chevron')}<span class="muted">Media</span></span></div><label class="search-field">${icon('search')}<input id="asset-search" placeholder="Search your media" aria-label="Search media" value="${esc(searchText)}"><kbd>⌕</kbd></label><div class="asset-grid ${assetView==='list'?'list':''}">${filtered.map(a=>`<div class="asset-card ${selectedAsset===a.id?'selected':''}" data-asset="${a.id}" draggable="true" role="button" tabindex="0" aria-label="${esc(a.name)}; double-click to preview" title="${esc(a.name)} · Drag to timeline or double-click to preview"><div class="asset-thumb">${a.thumb?`<img src="${esc(a.thumb)}" alt="">`:`<div class="audio-thumb">${(a.peaks||[]).filter((_,i)=>i%3===0).map(p=>`<i style="height:${4+p*34}px"></i>`).join('')}</div>`}<span class="asset-kind">${icon(assetIcon(a))}</span><span class="asset-duration">${a.type==='image'?'STILL':timecode(a.duration,project.fps).slice(3)}</span></div><div class="asset-name">${esc(a.name)}</div><div class="asset-sub">${a.type==='audio'?'Audio':`${a.width} × ${a.height}`} <span>· ${a.type==='image'?'Image':a.type==='video'?'Video':a.name.split('.').pop().toUpperCase()}</span></div></div>`).join('')||'<div class="empty-media">No media found</div>'}</div><button class="import-zone" data-action="import">${icon('import')}<span>Import media<small>or drop files here</small></span></button>`;
  }else if(libraryTab==='effects'){
    content.innerHTML=`<div class="library-topline"><span>Make it look like your vision</span>${icon('sparkles')}</div><label class="search-field">${icon('search')}<input id="effect-search" placeholder="Find an effect" aria-label="Search effects" value="${esc(searchText)}"></label>${['Color','Stylize','Transitions'].map(category=>`<h3 class="effect-category">${category}</h3><div class="effect-grid">${EFFECT_PRESETS.filter(p=>p.category===category&&p.name.toLowerCase().includes(searchText.toLowerCase())).map(p=>`<button class="effect-card" data-preset="${esc(p.name)}" draggable="true" title="Apply to selected clip, or drag onto a clip"><span class="effect-swatch" style="--swatch:${p.color}"></span><strong>${p.name}</strong><small>${p.description}</small></button>`).join('')}</div>`).join('')}<p class="library-hint">Click a preset to apply it to selected clips, or drag it onto a timeline clip. Refine every setting in Effect controls.</p>`;
  }else{
    content.innerHTML=`<div class="library-topline"><span>Give your story a voice</span>${icon('type')}</div><button class="title-card" data-title="hero"><b>THE GREAT OUTDOORS</b><small>Cinematic title</small></button><button class="title-card" data-title="minimal"><b style="font-size:23px;letter-spacing:-1px">Less is more.</b><small>Minimal title</small></button><button class="title-card" data-title="lower"><b style="font-size:14px;letter-spacing:1px;align-self:flex-start;margin-left:18px">YOUR NAME</b><small>Lower third</small></button><button class="title-card" data-title="credits"><b style="font-size:13px;letter-spacing:2px">A FILM BY YOU</b><small>End credits</small></button><p class="library-hint">Add a template at the playhead, then customize its text, typography, motion, and color in Effect controls.</p><button class="import-zone" data-action="add-color">${icon('color')}Color matte</button>`;
  }
}
function renderTimeline(){
  const total=duration(project),width=Math.max($('#timeline-scroll').clientWidth-1,(Math.max(total+6,30))*zoom);
  $('#timeline-content').style.width=`${width}px`;$('#timeline-content').style.setProperty('--grid-size',`${zoom}px`);
  const interval=zoom<15?10:zoom<30?5:zoom<65?2:1;
  let ticks='';for(let t=0;t<width/zoom;t+=interval){ticks+=`<span class="ruler-tick" style="left:${t*zoom}px">${timecode(t,project.fps).slice(0,8)}</span>`;for(let j=1;j<4;j++)ticks+=`<span class="ruler-tick minor" style="left:${(t+interval*j/4)*zoom}px"></span>`;}
  ticks+=project.markers.map(m=>`<button class="timeline-marker" data-marker="${m.id}" style="left:${m.time*zoom}px" title="${esc(m.name)} · ${timecode(m.time,project.fps)}">◆</button>`).join('');$('#ruler').innerHTML=ticks;
  let vn=project.tracks.filter(t=>t.type==='video').length,an=0;
  $('#track-labels').innerHTML='<div class="label-ruler"><button data-action="mark-in" title="Mark In (I)">IN</button><button data-action="mark-out" title="Mark Out (O)">OUT</button><button data-action="clear-range" title="Clear In/Out">CLEAR</button></div>'+project.tracks.map(t=>`<div class="track-label ${t.type}" data-track-label="${t.id}" style="--track-height:${trackZoom}px"><span class="track-code">${t.type==='video'?'V'+vn--:'A'+(++an)}</span><div class="track-details"><span>${esc(t.name)}</span><div class="track-buttons"><button data-track-toggle="lock" data-track="${t.id}" class="${t.locked?'active':''}" title="${t.locked?'Unlock':'Lock'} ${esc(t.name)}">${icon(t.locked?'lock':'unlock')}</button>${t.type==='video'?`<button data-track-toggle="visibility" data-track="${t.id}" class="${t.hidden?'active':''}" title="${t.hidden?'Show':'Hide'} ${esc(t.name)}">${icon(t.hidden?'eyeOff':'eye')}</button>`:''}<button data-track-toggle="mute" data-track="${t.id}" class="${t.muted?'active':''}" title="${t.muted?'Unmute':'Mute'} ${esc(t.name)}">M</button><button data-track-toggle="solo" data-track="${t.id}" class="${t.solo?'active':''}" title="Solo ${esc(t.name)}">S</button></div></div></div>`).join('');
  $('#tracks').innerHTML=project.tracks.map(t=>`<div class="timeline-track ${t.type} ${t.locked?'locked':''}" data-track="${t.id}" style="--track-height:${trackZoom}px">${project.clips.filter(c=>c.track===t.id).map(clipMarkup).join('')}</div>`).join('');
  clipElements=new Map($$('.timeline-clip').map(el=>[el.dataset.clip,el]));
  for(const c of project.clips){const el=clipElements.get(c.id);if(el)el.dataset.waveTiming=`${c.sourceIn}:${c.duration}:${c.speed}`;}
  // Keep track controls and clips together inside one vertical viewport.
  const trackHeight=30+project.tracks.length*trackZoom;
  $('#timeline-scroll').style.height=`${trackHeight+8}px`;
  $('#track-labels').style.minHeight=`${trackHeight+8}px`;
  const range=$('#range-overlay');range.hidden=project.inPoint===null&&project.outPoint===null;
  range.style.left=`${(project.inPoint||0)*zoom}px`;range.style.width=`${Math.max(0,(project.outPoint??total)-(project.inPoint||0))*zoom}px`;
  updateTime();
}
function updateClipGeometry(){
  for(const c of project.clips){const el=clipElements.get(c.id);if(!el)continue;
    if(el.parentElement.dataset.track!==c.track)$(`.timeline-track[data-track="${c.track}"]`).append(el);
    const left=`${c.start*zoom}px`,width=`${Math.max(1,c.duration*zoom)}px`;
    if(el.style.left!==left)el.style.left=left;
    if(el.style.width!==width)el.style.width=width;
    const path=el.querySelector('.clip-waveform path');
    const signature=`${c.sourceIn}:${c.duration}:${c.speed}`;
    if(path&&el.dataset.waveTiming!==signature){path.setAttribute('d',waveformPath(assets.get(c.assetId),c,c.duration*zoom));el.dataset.waveTiming=signature;}
  }
}
function clipMarkup(c){
  const a=assets.get(c.assetId),w=Math.max(1,c.duration*zoom),isAudio=c.type==='audio',hasEffects=Object.keys(DEFAULT_EFFECTS).some(k=>c.effects[k]!==DEFAULT_EFFECTS[k])||Object.values(c.keyframes).some(k=>k.length);
  const peaks=a?.peaks;
  let body='';
  if(isAudio){
    body=peaks?`<svg class="clip-waveform" viewBox="0 0 1000 100" preserveAspectRatio="none" aria-label="Source audio waveform"><path d="${waveformPath(a,c,w)}"/></svg>`:'<span class="clip-title-preview" style="font-size:9px">Audio ? waveform unavailable</span>';
  }else if(c.type==='title')body=`<div class="clip-title-preview">${esc(c.title?.text||c.name)}</div>`;
  else if(a?.thumb)body=`<div class="clip-filmstrip" style="background-image:url('${esc(a.thumb)}')"></div>`;
  else if(c.type==='color')body=`<div class="clip-filmstrip" style="background:${esc(c.color)}"></div>`;
  return `<div class="timeline-clip ${c.type} ${selected.has(c.id)?'selected':''}" data-clip="${c.id}" style="left:${c.start*zoom}px;width:${w}px" title="${esc(c.name)} · ${timecode(c.duration,project.fps)}${trackLocked(c)?' · Locked':''}" role="button" tabindex="0" aria-label="${esc(c.name)}, starts ${timecode(c.start,project.fps)}"><span class="clip-label">${icon(assetIcon(c))}<span>${esc(c.name)}</span>${c.linkId?'<span class="clip-link" title="Linked audio/video">?</span>':''}${hasEffects?'<span class="clip-fx">fx</span>':''}${c.speed!==1?`<span>${c.speed}×</span>`:''}</span>${body}${c.effects.fadeIn?`<div class="clip-fade" style="width:${Math.min(c.effects.fadeIn,c.duration)*zoom}px"></div>`:''}${c.effects.fadeOut?`<div class="clip-fade out" style="width:${Math.min(c.effects.fadeOut,c.duration)*zoom}px"></div>`:''}<div class="trim-handle left" data-edge="left" title="Trim start"></div><div class="trim-handle right" data-edge="right" title="Trim end"></div></div>`;
}

function effectControl(c,prop,label,min,max,step=1,unit=''){
  const value=animatedValue(c,prop,playhead),hasKeys=!!c.keyframes[prop]?.length;
  return `<div class="control-row"><label for="effect-${prop}"><input class="effect-enable" type="checkbox" data-effect-enable="${prop}" ${c.effectBypass?.includes(prop)?'': 'checked'} aria-label="Enable ${label}">${label}</label><input type="range" data-effect="${prop}" min="${min}" max="${max}" step="${step}" value="${value}" aria-label="${label}"><input type="number" id="effect-${prop}" data-effect="${prop}" min="${min}" max="${max}" step="${step}" value="${Number(value.toFixed(2))}" title="${label}${unit?' ('+unit+')':''}" aria-label="${label} value"><button class="keyframe-button ${hasKeys?'active':''}" data-keyframe="${prop}" title="Add/update ${label.toLowerCase()} keyframe at playhead; Alt-click to clear animation">◇</button><button class="effect-reset" data-effect-reset="${prop}" title="Reset ${label} and remove its animation" aria-label="Reset ${label}">&#8634;</button></div>`;
}
function section(title,content,open=true,badge=''){return `<details class="effect-section" ${open?'open':''}><summary>${title}${badge?`<span>${badge}</span>`:''}</summary><div class="effect-section-content">${content}</div></details>`;}
function automationControls(c){
  const props=Object.keys(c.keyframes).filter(prop=>c.keyframes[prop]?.length);
  if(!props.length)return '';
  if(!props.includes(automationProperty))automationProperty=props[0];
  const keys=c.keyframes[automationProperty],key=keys[automationIndex];
  return section('Keyframes',`<div id="automation-controls"><label>Property <select id="automation-property" aria-label="Animated property">${props.map(prop=>`<option ${prop===automationProperty?'selected':''}>${prop}</option>`).join('')}</select></label><div class="automation-strip" aria-label="Clip keyframes">${keys.map((k,i)=>{const local=keyframeTime(c,k)-c.start;return local<0||local>c.duration?'':`<button data-key-select="${i}" class="${i===automationIndex?'selected':''}" style="left:${local/c.duration*100}%" title="${timecode(keyframeTime(c,k),project.fps)}" aria-label="Select keyframe ${i+1}">&#9670;</button>`;}).join('')}</div><div class="automation-actions"><button data-key-nav="-1" title="Previous keyframe">Previous</button><button data-key-nav="1" title="Next keyframe">Next</button></div>${key?`<label>Sequence time (s)<input type="number" id="keyframe-time" aria-label="Keyframe time" min="${c.start}" max="${endTime(c,project.fps)}" step="${1/project.fps}" value="${keyframeTime(c,key).toFixed(6)}"></label><label>Outgoing interpolation<select id="keyframe-interpolation" aria-label="Keyframe interpolation">${[['linear','Linear'],['ease-in','Ease In'],['ease-out','Ease Out'],['ease-in-out','Ease In/Out']].map(([value,label])=>`<option value="${value}" ${(key.interpolation||'linear')===value?'selected':''}>${label}</option>`).join('')}</select></label><button data-action="delete-keyframe">Delete keyframe</button>`:'<p>Select a point to change its time or interpolation.</p>'}</div>`);
}
function renderInspector(){
  const c=primaryClip(),container=$('#inspector-content'),scroll=container.scrollTop;
  const closed=new Set($$('details:not([open])',container).map(e=>e.querySelector('summary').firstChild.textContent));
  $$('[data-inspector]').forEach(b=>b.classList.toggle('active',b.dataset.inspector===inspectorTab));
  if(!c){container.innerHTML=`<div class="inspector-empty">${icon('sliders')}<strong>A little detail. A big difference.</strong><p>Select a clip in the timeline to adjust motion, color, audio, and effects.</p></div>`;return;}
  const ctl=(...args)=>effectControl(c,...args),audioOnly=inspectorTab==='audio'||c.type==='audio';
  container.innerHTML=`<div class="inspector-selected"><span class="clip-icon">${icon(assetIcon(c))}</span><div><strong>${esc(c.name)}</strong><small>${timecode(c.duration,project.fps)} · ${c.type==='title'?'Graphic':c.type==='color'?'Color matte':c.type.charAt(0).toUpperCase()+c.type.slice(1)}${trackLocked(c)?' · Locked':''}</small></div><button class="icon-button" data-action="rename-clip" title="Rename clip">${icon('edit')}</button></div>`+
    (c.type==='title'&&!audioOnly?section('Text',`<textarea class="text-control" data-title-prop="text" aria-label="Title text">${esc(c.title.text)}</textarea><div class="control-row"><label>Font</label><select data-title-prop="font" aria-label="Title font">${['Arial','Georgia','Verdana','Impact','Courier New'].map(f=>`<option ${c.title.font===f?'selected':''}>${f}</option>`).join('')}</select></div><div class="control-row"><label>Size</label><input type="number" data-title-prop="fontSize" min="12" max="400" value="${c.title.fontSize}"><label style="width:30px;margin-left:8px">Color</label><input class="color-control" type="color" data-title-prop="color" value="${c.title.color}"></div><div class="control-row"><label>Style</label><select data-title-prop="weight"><option value="400" ${c.title.weight===400?'selected':''}>Regular</option><option value="600" ${c.title.weight===600?'selected':''}>Semibold</option><option value="800" ${c.title.weight===800?'selected':''}>Bold</option></select><select data-title-prop="align"><option ${c.title.align==='center'?'selected':''} value="center">Center</option><option ${c.title.align==='left'?'selected':''} value="left">Left</option><option ${c.title.align==='right'?'selected':''} value="right">Right</option></select></div><div class="control-row"><label>Shadow</label><input type="checkbox" data-title-prop="shadow" ${c.title.shadow!==false?'checked':''}></div>`):'')+
    (c.type==='color'&&!audioOnly?section('Color matte',`<div class="control-row"><label>Fill</label><input type="color" id="matte-color" value="${esc(c.color)}"></div>`):'')+
    (!audioOnly?section('Motion',ctl('x','Position X',-100,100,.1,'%')+ctl('y','Position Y',-100,100,.1,'%')+ctl('scale','Scale',1,400,.1,'%')+ctl('rotation','Rotation',-180,180,.1,'°')+`<div class="control-row"><label>Frame fit</label><select id="clip-fit"><option value="cover" ${c.fit!=='contain'?'selected':''}>Fill frame</option><option value="contain" ${c.fit==='contain'?'selected':''}>Fit inside</option></select></div>`+`<p class="keyframe-help">◇ Animate a property at the playhead.</p>`,true,'fx')+section('Opacity & transitions',ctl('opacity','Opacity',0,100,1,'%')+ctl('fadeIn','Fade in',0,Math.min(10,c.duration),.1,'s')+ctl('fadeOut','Fade out',0,Math.min(10,c.duration),.1,'s'),true,'fx')+section('Color correction',ctl('exposure','Exposure',-3,3,.05)+ctl('contrast','Contrast',0,200)+ctl('saturation','Saturation',0,200)+ctl('temperature','Temperature',-100,100)+ctl('grayscale','Monochrome',0,100)+(c.preset?`<span class="preset-badge">${esc(c.preset)}</span>`:''),true,'fx')+section('Lens & crop',ctl('blur','Blur',0,30,.1)+ctl('vignette','Vignette',0,100)+ctl('cropTop','Crop top',0,49)+ctl('cropBottom','Crop bottom',0,49)+ctl('cropLeft','Crop left',0,49)+ctl('cropRight','Crop right',0,49),false):'')+
    (['audio','video'].includes(c.type)?section('Audio',ctl('volume','Volume',0,200,1,'%')+ctl('audioFadeIn','Fade in',0,Math.min(10,c.duration),.1,'s')+ctl('audioFadeOut','Fade out',0,Math.min(10,c.duration),.1,'s'),audioOnly,'fx'):'')+
    automationControls(c)+section('Timing',`<div class="control-row"><label>Start (s)</label><input type="number" data-timing="start" min="0" step="${1/project.fps}" value="${c.start.toFixed(3)}"></div><div class="control-row"><label>Duration (s)</label><input type="number" data-timing="duration" min="${1/project.fps}" step="${1/project.fps}" value="${c.duration.toFixed(3)}"></div>${['audio','video'].includes(c.type)?`<div class="control-row"><label>Speed</label><select id="clip-speed">${[.25,.5,.75,1,1.25,1.5,2,4].map(n=>`<option value="${n}" ${c.speed===n?'selected':''}>${n}×${n===1?' · Normal':''}</option>`).join('')}</select></div><p class="inline-note">Changing speed preserves the source range and adjusts the clip duration.</p>`:''}`,false)+`<div class="clip-actions"><button class="button" data-action="duplicate">${icon('copy')}Duplicate</button><button class="button" data-action="split">${icon('razor')}Split</button><button class="button" data-action="delete">${icon('trash')}Delete</button></div>`;
  $$('details',container).forEach(el=>{if(closed.has(el.querySelector('summary').firstChild.textContent))el.open=false;});
  if(trackLocked(c))$$('input,textarea,select,button',container).forEach(el=>el.disabled=true);
  container.scrollTop=scroll;
}

async function importFiles(files,{targetTrack=null,start=null}={}){
  if(exporting)return;status('Importing media…');const added=[];
  for(const file of files){
    try{
      const asset=await readAsset(file);
      // Restore references when a project was opened without its media.
      const offline=project.clips.find(c=>!assets.has(c.assetId)&&(project.mediaReferences?.[c.assetId]?.name===asset.name||c.name===asset.name));
      if(offline)asset.id=offline.assetId;
      assets.set(asset.id,asset);added.push(asset);selectedAsset=asset.id;await storeAsset(asset);
      if(asset.type==='audio'||asset.type==='video'){
        await waveform(asset,new OfflineAudioContext(1,1,22050));await storeAsset(asset);
      }
      renderLibrary();
    }catch(e){toast(e.message,true);}
  }
  if(targetTrack&&added.length){snapshot();let cursor=start??playhead;for(const a of added){const c=insertAsset(a,{track:targetTrack,start:cursor,quiet:true});if(c)cursor+=c.duration;}changed();}
  queueSave();engine.sync(playhead,playing);status(`${added.length} file${added.length===1?'':'s'} imported`);if(added.length)toast(`${added.length} file${added.length===1?'':'s'} ready. Drag media onto the timeline.`);
}
function compatibleTrack(asset,track){return asset.type==='audio'?track.type==='audio':track.type==='video';}
function insertAsset(asset,{track=null,start=playhead,quiet=false,sourceIn=0,sourceOut=null,mode='place'}={}){
  if(!asset)return;
  let target=project.tracks.find(t=>t.id===track);
  if(!target||!compatibleTrack(asset,target))target=project.tracks.find(t=>t.type===(asset.type==='audio'?'audio':'video')&&!t.locked&&(asset.type==='audio'||t.id==='v1'))||project.tracks.find(t=>compatibleTrack(asset,t)&&!t.locked);
  if(!target||target.locked){toast('Choose an unlocked, compatible track.',true);return;}
  const audioTrack=asset.type==='video'&&asset.hasAudio===true?project.tracks.find(t=>t.type==='audio'&&!t.locked):null;
  if(asset.type==='video'&&asset.hasAudio===true&&!audioTrack){toast('Unlock an audio track to place this linked video/audio asset.',true);return;}
  if(!quiet)snapshot();
  const c=createClip(asset,target.id,Math.max(0,start));c.sourceIn=sourceIn;
  c.start=quantize(c.start,project.fps);
  c.duration=Math.max(1,floorFrames(sourceOut!==null?sourceOut-sourceIn:c.duration,project.fps))/project.fps;
  if(mode==='insert')insertGap(project,c.start,c.duration);
  if(mode==='overwrite'){overwriteRange(project,target.id,c.start,c.start+c.duration);if(audioTrack)overwriteRange(project,audioTrack.id,c.start,c.start+c.duration);}
  project.clips.push(c);selected=new Set([c.id]);focusedClipId=c.id;
  if(audioTrack){c.linkId=uid();const audio=audioCompanion(c,audioTrack.id);project.clips.push(audio);selected.add(audio.id);}else if(asset.type==='video'&&asset.hasAudio===false)c.audioRole='video-only';
  if(!quiet){changed();toast('Clip added to timeline');}return c;
}
function addTitle(template='minimal'){
  const target=project.tracks.find(t=>t.type==='video'&&!t.locked);if(!target){toast('Unlock a video track to add a title.',true);return;}
  const styles={hero:{text:'THE GREAT\nOUTDOORS',fontSize:118,weight:800},minimal:{text:'Your story starts here.',fontSize:85,weight:600},lower:{text:'YOUR NAME\nFilmmaker & explorer',fontSize:54,weight:600,align:'left',background:'#171b26'},credits:{text:'A FILM BY YOU\n\nThanks for watching',fontSize:62,weight:400}};
  edit(()=>{const c=createClip({id:null,name:'Title · '+template,type:'title',duration:5},target.id,playhead,{title:{font:'Arial',color:'#ffffff',align:'center',shadow:true,...styles[template]}});if(template==='lower'){c.effects.y=31;c.effects.x=3;}c.effects.fadeIn=.5;c.effects.fadeOut=.5;project.clips.push(c);selected=new Set([c.id]);inspectorTab='video';});
  $('.editor').classList.add('inspect-mode');toast('Title added. Edit its text in Effect controls.');
}
function detachAudio(){
  const videos=project.clips.filter(c=>selected.has(c.id)&&c.type==='video');
  if(!videos.length){toast('Select a video clip first.');return;}
  edit(()=>{const ids=separateAudio(project,videos.map(c=>c.id),project.tracks.find(t=>t.type==='audio'&&!t.locked)?.id);if(ids.length){selected=new Set(ids);focusedClipId=ids[0];}else toast('No audio can be separated. Check track locks or existing separation.');});
}
async function importCaptions(file){
  if(!file)return;const cues=parseSrt(await file.text());
  if(!cues.length){toast('No valid subtitles found in this SRT file.',true);return;}
  if(project.tracks.length>=30){toast('This project has reached the 30-track limit.',true);return;}
  edit(()=>{
    const track={id:uid(),name:'Captions',type:'video',muted:false,hidden:false,locked:false};project.tracks.unshift(track);selected.clear();
    for(const cue of cues){const clip=createClip({id:null,type:'title',name:cue.text.replace(/\n/g,' ').slice(0,50),duration:cue.end-cue.start},track.id,cue.start,{caption:true,title:{text:cue.text,fontSize:52,weight:600,font:'Arial',color:'#ffffff',background:'#15151b',align:'center',shadow:true}});clip.start=quantize(cue.start,project.fps);clip.duration=Math.max(1,toFrame(cue.end,project.fps)-toFrame(cue.start,project.fps))/project.fps;clip.effects.y=38;project.clips.push(clip);selected.add(clip.id);}
  });toast(`${cues.length} captions imported. Edit and trim them like titles.`);
}
function exportCaptions(){const text=serializeSrt(project.clips);if(!text){toast('Import an SRT file to create a caption track first.');return;}download(new Blob([text],{type:'text/plain;charset=utf-8'}),safeFilename(project.name)+'.srt');toast('Captions saved as SRT');}
function applyPreset(name,ids=[...selected]){
  const preset=EFFECT_PRESETS.find(p=>p.name===name);if(!preset)return;
  const clips=project.clips.filter(c=>ids.includes(c.id)&&!trackLocked(c));if(!clips.length){toast('Select an unlocked clip to apply an effect.');return;}
  edit(()=>{for(const c of clips){Object.assign(c.effects,preset.values);for(const prop of Object.keys(preset.values))delete c.keyframes[prop];c.effectBypass=c.effectBypass?.filter(prop=>!(prop in preset.values));c.preset=name;}});toast(`${name} applied`);
}
function performSplit(){const ids=selected.size?[...selected]:project.clips.filter(c=>playhead>c.start&&playhead<endTime(c,project.fps)).map(c=>c.id);if(!ids.length)return;edit(()=>{const rights=cutClips(project,ids,playhead);if(rights.length){selected=new Set(rights);focusedClipId=rights[0];}else toast('Place the playhead inside an unlocked clip.');});}
function removeSelected(ripple=false){if(![...selected].some(id=>{const c=project.clips.find(c=>c.id===id);return c&&!trackLocked(c);})){toast('Select an unlocked clip first.');return;}edit(()=>{deleteClips(project,[...selected],ripple);selected.clear();});}
function copySelected(){clipboard=clone(project.clips.filter(c=>selected.has(c.id)));if(clipboard.length)toast(`${clipboard.length} clip${clipboard.length===1?'':'s'} copied`);}
function pasteClips(duplicate=false){const copies=duplicate?clone(project.clips.filter(c=>linkedIds(project,[...selected]).includes(c.id))):clone(clipboard);if(!copies.length)return;edit(()=>{const earliest=Math.min(...copies.map(c=>c.start)),offset=duplicate?Math.max(...copies.map(c=>c.start+c.duration))-earliest:playhead-earliest;selected.clear();const groups=new Map();for(const c of copies){if(trackLocked(c))continue;if(c.linkId){if(!groups.has(c.linkId))groups.set(c.linkId,uid());c.linkId=groups.get(c.linkId);}c.id=uid();c.start=quantize(c.start+offset,project.fps);project.clips.push(c);selected.add(c.id);}});}

function showModal(title,body,footer='',submit=null){
  if($('#modal').open)$('#modal').close();
  $('#modal-title').textContent=title;$('#modal-body').innerHTML=body;$('#modal-footer').innerHTML=footer;modalSubmit=submit;hydrateIcons($('#modal'));$('#modal').showModal();
}
const cancelButton='<button class="button" value="cancel">Cancel</button>';
const submitButton=(label)=>`<button class="button primary" value="submit">${label}</button>`;
function promptText(title,label,value,callback){showModal(title,`<div class="form-row"><label for="prompt-text">${label}</label><input id="prompt-text" required maxlength="150" value="${esc(value)}" autofocus></div>`,cancelButton+submitButton('Save'),()=>{const val=$('#prompt-text').value.trim();if(val){callback(val);$('#modal').close();}});}
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
const safeFilename=name=>name.replace(/[<>:"/\\|?*\x00-\x1F]/g,'_').slice(0,100)||'Cutline project';
const blobData=blob=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob);});
async function saveProject(portable=true){
  status('Preparing project file…');
  try{
    const projectCopy=clone(project),media=[];
    for(const asset of activeAssets()){const {blob,url,...meta}=asset;media.push({...meta,data:portable&&blob?await blobData(blob):null});}
    for(const [id,meta] of Object.entries(project.mediaReferences||{}))if(!assets.has(id))media.push({...meta,id,data:null});
    download(new Blob([JSON.stringify({application:'Cutline Studio',version:1,project:projectCopy,assets:media})],{type:'application/json'}),safeFilename(projectCopy.name)+'.cutline');
    await saveSession();toast(portable?'Portable project saved with its media.':'Project saved. Reimport original media after reopening.');status('Project file saved');
  }catch(e){toast(`Could not save project: ${e.message}`,true);}
}
function saveProjectDialog(){
  const size=activeAssets().reduce((s,a)=>s+(a.size||0),0);
  showModal('Save your project',`<p>Keep an editable copy of your timeline, effects, and sequence settings.</p><div class="form-row"><label for="save-mode">Project media</label><select id="save-mode"><option value="portable">Include media · portable project</option><option value="light">Timeline only · relink media when opened</option></select></div><div class="export-summary"><span>${activeAssets().length} media files</span><span>${(size/1024/1024).toFixed(1)} MB of source media</span></div><p>Portable projects embed your source files. The resulting file can be larger than the original media. Large projects may be better saved as timeline only.</p>`,cancelButton+submitButton('Save project'),()=>{const portable=$('#save-mode').value==='portable';$('#modal').close();saveProject(portable);});
}
async function openProjectFile(file){
  if(!file)return;pause();status('Opening project…');
  try{
    const data=JSON.parse(await file.text()),incoming=validateProject(data),incomingAssets=new Map();
    if(data.assets&&!Array.isArray(data.assets))throw new Error('Invalid media list.');
    incoming.mediaReferences={};
    for(const meta of data.assets||[]){
      if(typeof meta.id!=='string'||typeof meta.name!=='string'||!['image','audio','video'].includes(meta.type))throw new Error('Invalid media metadata.');
      incoming.mediaReferences[meta.id]={id:meta.id,name:meta.name,type:meta.type,size:meta.size};
      if(meta.data){
        if(typeof meta.data!=='string'||!/^data:(?:image|audio|video|application\/octet-stream)[^,]*;base64,/.test(meta.data))throw new Error('Invalid embedded media.');
        const blob=await(await fetch(meta.data)).blob();const a=await readAsset(new File([blob],meta.name,{type:blob.type}));a.id=meta.id;a.peaks=Array.isArray(meta.peaks)?meta.peaks.filter(Number.isFinite):undefined;incomingAssets.set(a.id,a);
      }else{
        const cached=[...assets.values()].find(a=>a.id===meta.id||a.name===meta.name&&a.size===meta.size);
        if(cached)incomingAssets.set(meta.id,{...cached,id:meta.id});
      }
    }
    snapshot();engine.reset();for(const a of assets.values())if(![...incomingAssets.values()].some(b=>b.url===a.url))URL.revokeObjectURL(a.url);
    assets.clear();for(const [id,a]of incomingAssets){assets.set(id,a);await storeAsset(a);}project=incoming;history=new History();selected.clear();playhead=0;sourceRange=null;
    applyPreviewSize();renderLibrary();changed();await engine.prepare();engine.sync(0,false);
    const missing=project.clips.filter(c=>c.assetId&&!assets.has(c.assetId)).length;
    toast(missing?`Project opened. ${missing} clips need their original media; reimport files with matching names.`:'Project opened');status('Project ready');
  }catch(e){toast(`Could not open project: ${e.message}`,true);status('Open failed');}
}
function newProjectDialog(){
  showModal('A new story',`<p>Your current project is saved in this browser until it is replaced. Download it first if you want to keep a separate copy.</p><div class="form-row"><label for="new-name">Project name</label><input id="new-name" value="Untitled project" required maxlength="150"></div><div class="form-row"><label for="new-ratio">Sequence format</label><select id="new-ratio"><option value="1920,1080">Landscape · 1920 × 1080</option><option value="1080,1920">Portrait · 1080 × 1920</option><option value="1080,1080">Square · 1080 × 1080</option></select></div>`,cancelButton+submitButton('Create project'),()=>{
    pause();const name=$('#new-name').value.trim()||'Untitled project',[w,h]=$('#new-ratio').value.split(',').map(Number);
    engine.reset();project=createProject();project.name=name;project.width=w;project.height=h;selected.clear();selectedAsset=null;history=new History();playhead=0;
    for(const a of assets.values())URL.revokeObjectURL(a.url);assets.clear();$('#modal').close();applyPreviewSize();renderLibrary();changed();toast('New project created. Import your media to begin.');
  });
}
function sequenceSettings(){showModal('Sequence settings',`<div class="form-row"><label for="sequence-name">Sequence name</label><input id="sequence-name" value="${esc(project.sequence)}" maxlength="120" required></div><div class="form-row"><label for="sequence-format">Frame size</label><select id="sequence-format">${[[1920,1080],[1280,720],[3840,2160],[1080,1920],[1080,1080],[1080,1350]].map(([w,h])=>`<option value="${w},${h}" ${project.width===w&&project.height===h?'selected':''}>${w} × ${h}${w===h?' · Square':w<h?' · Portrait':' · Landscape'}</option>`).join('')}</select></div><div class="form-row"><label for="sequence-fps">Frame rate</label><select id="sequence-fps">${[24,25,30,60].map(n=>`<option value="${n}" ${project.fps===n?'selected':''}>${n} fps</option>`).join('')}</select></div><p>Transforms and text scale with the sequence. Source media remains at its original resolution.</p>`,cancelButton+submitButton('Apply settings'),()=>{edit(()=>{project.sequence=$('#sequence-name').value;[project.width,project.height]=$('#sequence-format').value.split(',').map(Number);project.fps=Number($('#sequence-fps').value);project.clips.forEach(c=>normalizeTiming(c,project.fps));project.markers.forEach(m=>m.time=quantize(m.time,project.fps));});$('#modal').close();applyPreviewSize();});}
function shortcuts(){
  const groups={Playback:[['Play / pause','Space'],['Shuttle backward','J'],['Stop','K'],['Shuttle forward','L'],['Previous / next frame','← / →'],['Jump 1 second','Shift + ← / →'],['Previous / next edit','↑ / ↓'],['Start / end','Home / End']],Editing:[['Selection tool','V'],['Razor tool','C'],['Ripple trim tool','B'],['Slip tool','Y'],['Hand tool','H'],['Add text','T'],['Split at playhead','Ctrl + K'],['Select all clips','Ctrl + A'],['Delete selection','Delete'],['Ripple delete','Shift + Delete'],['Duplicate','Ctrl + D'],['Undo / redo','Ctrl + Z / ⇧ Z'],['Copy / cut / paste','Ctrl + C / X / V']],Timeline:[['Mark In / Out','I / O'],['Clear In and Out','Ctrl + Shift + X'],['Add marker','M'],['Toggle snapping','S'],['Zoom timeline','+ / −'],['Fit sequence','\\'],['Trim start to playhead','Q'],['Trim end to playhead','W'],['Toggle inspector','Shift + 5']],Project:[['Import media','Ctrl + I'],['Save project','Ctrl + S'],['Open project','Ctrl + O'],['Export sequence','Ctrl + M'],['Keyboard shortcuts','?']]};
  showModal('A familiar way to edit',`<p>Premiere-style shortcuts, built for the browser. Use ⌘ instead of Ctrl on macOS. Shortcuts are paused while typing in a field.</p>${Object.entries(groups).map(([title,items])=>`<h3 class="help-section">${title}</h3><div class="shortcut-grid">${items.map(([label,key])=>`<div class="shortcut-row"><span>${label}</span><kbd>${esc(key)}</kbd></div>`).join('')}</div>`).join('')}<p style="margin-top:18px">Drag clips to move them between compatible tracks. Drag the edges to trim. Shift-click to select multiple clips. Double-click media to preview it and set a source range. Alt-click a keyframe diamond to clear that property's animation.</p>`,submitButton('Got it'),()=>$('#modal').close());
}
function showAssetPreview(id){
  const a=assets.get(id);if(!a)return;selectedAsset=id;pause();renderLibrary();sourceRange={id,in:0,out:a.type==='image'?5:a.duration};
  const media=a.type==='image'?`<img src="${esc(a.url)}" alt="${esc(a.name)}" style="width:100%;max-height:260px;object-fit:contain;border-radius:5px">`:`<${a.type} id="source-player" controls src="${esc(a.url)}" style="width:100%;max-height:260px;background:#121319;border-radius:5px"></${a.type}>`;
  showModal(a.name,`${media}<div class="export-summary" style="margin-top:15px"><span>${a.type==='audio'?'Audio':`${a.width} × ${a.height}`}</span><span>${timecode(a.duration,project.fps)}</span></div><div class="form-columns"><div class="form-row"><label for="source-in">Source In (seconds)</label><input id="source-in" type="number" value="0" min="0" max="${a.duration}" step=".001"></div><div class="form-row"><label for="source-out">${a.type==='image'?'Still duration':'Source Out'} (seconds)</label><input id="source-out" type="number" value="${sourceRange.out.toFixed(3)}" min=".034" ${a.type!=='image'?`max="${a.duration}"`:''} step=".001"></div></div><p>Add the selected source range to the timeline at ${timecode(playhead,project.fps)}.</p>`,cancelButton+submitButton('Add to timeline'),()=>{
    const start=Number($('#source-in').value),end=Number($('#source-out').value);
    if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end-start<1/project.fps||(a.type!=='image'&&end>a.duration)){toast('Choose a valid source range of at least one frame.',true);return;}
    $('#source-player')?.pause();$('#modal').close();insertAsset(a,{sourceIn:start,sourceOut:end});
  });
}
function addTrackDialog(){showModal('Add a track',`<div class="form-row"><label for="track-name">Track name</label><input id="track-name" value="New track" maxlength="40" required></div><div class="form-row"><label for="track-type">Track type</label><select id="track-type"><option value="video">Video · footage, images, and titles</option><option value="audio">Audio · dialogue, music, and sound</option></select></div>`,cancelButton+submitButton('Add track'),()=>{if(project.tracks.length>=30){toast('This project has reached the 30-track limit.',true);return;}edit(()=>{const type=$('#track-type').value,t={id:uid(),name:$('#track-name').value,type,muted:false,hidden:false,locked:false};type==='video'?project.tracks.unshift(t):project.tracks.push(t);});$('#modal').close();});}
function markersDialog(){showModal('Sequence markers',project.markers.length?project.markers.map(m=>`<div class="marker-item"><button type="button" data-goto-marker="${m.id}">${timecode(m.time,project.fps)}</button><input data-marker-name="${m.id}" aria-label="Marker name" value="${esc(m.name)}" maxlength="80"><button type="button" data-delete-marker="${m.id}" aria-label="Delete marker">${icon('trash')}</button></div>`).join(''):'<p>No markers yet. Press M to add one at the playhead.</p>',submitButton('Done'),()=>$('#modal').close());}

const exportFormats=()=>{
  if(!window.MediaRecorder)return [];
  return [{label:'WebM · VP9 / Opus',mime:'video/webm;codecs=vp9,opus',ext:'webm'},{label:'WebM · VP8 / Opus',mime:'video/webm;codecs=vp8,opus',ext:'webm'},{label:'MP4 · H.264 / AAC',mime:'video/mp4;codecs=avc1.42001E,mp4a.40.2',ext:'mp4'},{label:'MP4 · browser encoder',mime:'video/mp4',ext:'mp4'}].filter(f=>MediaRecorder.isTypeSupported(f.mime));
};
function exportDialog(){
  if(!duration(project)){toast('Add media to your timeline before exporting.');return;}
  pause();const formats=exportFormats();if(!formats.length){toast('Video export is not available in this browser. Open the editor in a current version of Chrome or Edge.',true);return;}
  const hasRange=project.inPoint!==null||project.outPoint!==null;
  showModal('Export your story',`<p>Your sequence, ready to go beyond the timeline.</p><div class="form-row"><label for="export-name">File name</label><input id="export-name" value="${esc(project.name)}" required maxlength="100"></div><div class="form-columns"><div class="form-row"><label for="export-format">Format</label><select id="export-format">${formats.map((f,i)=>`<option value="${i}">${f.label}</option>`).join('')}</select></div><div class="form-row"><label for="export-resolution">Resolution</label><select id="export-resolution"><option value="1">Sequence · ${project.width} × ${project.height}</option><option value=".6666667">⅔ size · ${Math.round(project.width*2/3)} × ${Math.round(project.height*2/3)}</option><option value=".5">½ size · ${Math.round(project.width/2)} × ${Math.round(project.height/2)}</option></select></div></div><div class="form-columns"><div class="form-row"><label for="export-quality">Bitrate</label><select id="export-quality"><option value="12000000">High · 12 Mbps</option><option value="6000000" selected>Balanced · 6 Mbps</option><option value="2500000">Compact · 2.5 Mbps</option></select></div><div class="form-row"><label for="export-range">Source range</label><select id="export-range"><option value="all">Entire sequence</option>${hasRange?'<option value="range">Sequence In / Out</option>':''}</select></div></div><div class="export-summary"><span>${project.fps} frames / second</span><span>${timecode(duration(project),project.fps)} total duration</span></div><div class="export-note">${icon('info')}<span>Export runs in real time with the browser's available codecs. Keep this tab visible until it finishes. Your clip effects, titles, and mixed audio are included.</span></div>`,cancelButton+submitButton('Export video'),()=>{
    const range=$('#export-range').value==='range',scale=Number($('#export-resolution').value);
    const options={name:$('#export-name').value,format:formats[Number($('#export-format').value)],width:Math.round(project.width*scale/2)*2,height:Math.round(project.height*scale/2)*2,bitrate:Number($('#export-quality').value),start:range?(project.inPoint||0):0,end:range?(project.outPoint??duration(project)):duration(project)};
    if(options.end-options.start<1/project.fps){toast('The export range must contain at least one frame.',true);return;}
    runExport(options);
  });
}
async function runExport(options){
  const previousTime=playhead,previousVolume=engine.masterVolume;let recorder,stream,timer,cancelled=false,abortReason='',recorderStopped;
  exporting=true;playing=false;engine.pause();
  showModal('Exporting your story',`<p id="export-stage">Preparing media and audio…</p><div class="progress-track"><div id="export-progress"></div></div><div class="export-progress-label"><span id="export-elapsed">00:00:00:00</span><span id="export-percent">0%</span></div><p style="margin-top:20px">Keep this browser tab visible while your video is rendered. Export includes clip volume and track mute settings.</p>`,`<button type="button" class="button" id="cancel-export">Cancel export</button>`);
  const abort=(reason='')=>{cancelled=true;abortReason=reason;if(recorder?.state==='recording')recorder.stop();};stopExport=abort;$('#cancel-export').onclick=()=>abort();
  const visibility=()=>{if(document.hidden)abort('Export stopped because the tab was hidden. Keep it visible while exporting.');};document.addEventListener('visibilitychange',visibility);
  try{
    await engine.audioInit();await engine.prepare(options.start);
    if(cancelled)return;
    const missing=project.clips.some(c=>c.assetId&&!assets.has(c.assetId));if(missing)throw new Error('Some source media is offline. Reimport the missing media before exporting.');
    engine.setVolume(1);engine.playbackMultiplier=1;$('#preview').width=options.width;$('#preview').height=options.height;engine.sync(options.start,false);
    await Promise.all([...engine.nodes.values()].filter(n=>n.el.seeking).map(n=>new Promise(resolve=>{const timeout=setTimeout(resolve,3000);n.el.addEventListener('seeked',()=>{clearTimeout(timeout);resolve();},{once:true});})));
    engine.render();
    if(cancelled)return;
    stream=$('#preview').captureStream(project.fps);stream.addTrack(engine.destination.stream.getAudioTracks()[0]);
    const chunks=[];recorder=new MediaRecorder(stream,{mimeType:options.format.mime,videoBitsPerSecond:options.bitrate,audioBitsPerSecond:192000});
    recorderStopped=new Promise((resolve,reject)=>{recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};recorder.onstop=resolve;recorder.onerror=e=>reject(e.error||new Error('The browser encoder failed.'));});
    recorder.start(250);const start=performance.now();$('#export-stage').textContent=`Rendering ${options.width} × ${options.height} · ${project.fps} fps`;
    engine.sync(options.start,true);
    timer=setInterval(()=>{
      if(cancelled)return;
      const elapsed=(performance.now()-start)/1000,t=quantize(options.start+elapsed,project.fps);
      if(t>=options.end){engine.pause();clearInterval(timer);if(recorder.state==='recording')recorder.stop();return;}
      playhead=t;engine.sync(t,true);updateTime();
      const percent=Math.min(100,elapsed/(options.end-options.start)*100);$('#export-progress').style.width=`${percent}%`;$('#export-percent').textContent=`${Math.round(percent)}%`;$('#export-elapsed').textContent=timecode(elapsed,project.fps);
    },1000/Math.max(project.fps,30));
    await recorderStopped;
    if(!cancelled){let blob=new Blob(chunks,{type:recorder.mimeType});if(blob.size<100)throw new Error('The encoder returned an empty file.');if(options.format.ext==='webm')blob=await finalizeWebm(blob,options.end-options.start);download(blob,`${safeFilename(options.name)}.${options.format.ext}`);toast(`Export complete · ${(blob.size/1024/1024).toFixed(1)} MB`);status('Video exported');}
  }catch(e){cancelled=true;abortReason=e.message;}
  finally{
    clearInterval(timer);if(recorder?.state==='recording'){recorder.stop();recorderStopped?.catch(()=>{});}stream?.getVideoTracks().forEach(t=>t.stop());engine.pause();engine.setVolume(previousVolume);exporting=false;stopExport=null;document.removeEventListener('visibilitychange',visibility);$('#modal').close();applyPreviewSize();seek(previousTime);$('#play-button').innerHTML=icon('play');
    if(cancelled){toast(abortReason||'Export cancelled',!!abortReason);status('Export cancelled');}
  }
}

async function snapshotFrame(){
  const canvas=$('#preview'),w=canvas.width,h=canvas.height;
  canvas.width=project.width;canvas.height=project.height;engine.render();
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));canvas.width=w;canvas.height=h;engine.render();
  if(blob){download(blob,`${safeFilename(project.name)}-${timecode(playhead,project.fps).replaceAll(':','-')}.png`);toast('Frame saved as PNG');}
}

const menus={
  media:[['Remove from Project','remove-project-asset','Delete']],
  file:[['New project','new','Ctrl+Alt+N'],['Open project…','open','Ctrl+O'],['Save project…','save','Ctrl+S'],null,['Import media…','import','Ctrl+I'],['Import captions (SRT)…','import-captions',''],['Export video…','export','Ctrl+M'],['Export frame','snapshot',''],['Export captions (SRT)','export-captions',''],null,['Load sample project','demo','']],
  edit:[['Undo','undo','Ctrl+Z'],['Redo','redo','Ctrl+Shift+Z'],null,['Cut','cut','Ctrl+X'],['Copy','copy','Ctrl+C'],['Paste','paste','Ctrl+V'],['Duplicate','duplicate','Ctrl+D'],['Delete','delete','Del'],['Ripple delete','ripple-delete','Shift+Del'],null,['Select all clips','select-all','Ctrl+A']],
  sequence:[['Sequence settings…','sequence-settings',''],['Add track…','add-track',''],['Add title','add-title','T'],['Add color matte','add-color',''],null,['Insert selected media','insert-source',','],['Overwrite selected media','overwrite-source','.'],['Separate video audio','detach-audio',''],['Link selected clips','link',''],['Unlink selected clips','unlink',''],['Split at playhead','split','Ctrl+K'],['Add marker','marker','M'],['Manage markers…','markers',''],['Mark In','mark-in','I'],['Mark Out','mark-out','O'],['Clear In / Out','clear-range','Ctrl+Shift+X']],
  view:[['Fit timeline','timeline-fit','\\'],['Zoom in','zoom-in','+'],['Zoom out','zoom-out','−'],['Toggle safe margins','safe-guides',''],['Fullscreen preview','fullscreen',''],['Toggle inspector','toggle-inspector','Shift+5'],null,['Keyboard shortcuts','shortcuts','?']]
};
function showMenu(name,element,coords=null){const menu=$('#menu-popover');menu.innerHTML=menus[name].map(item=>item?`<button data-action="${item[1]}"><span>${item[0]}</span><small>${item[2]}</small></button>`:'<hr>').join('');const r=element?.getBoundingClientRect();menu.hidden=false;menu.style.left=`${Math.min(coords?.x??r.left,innerWidth-245)}px`;menu.style.top=`${Math.min(coords?.y??r.bottom+4,innerHeight-menu.offsetHeight-10)}px`;}
function selectClips(ids){focusedClipId=ids[0];selected=new Set(linkedIds(project,ids));renderTimeline();renderInspector();renderHeader();}
function setTool(next){tool=next;$$('[data-tool]').forEach(b=>b.classList.toggle('active',b.dataset.tool===tool));$('#tool-status').textContent=({select:'Selection tool',razor:'Razor · click a clip to cut',ripple:'Ripple trim · drag a clip edge',slip:'Slip · drag inside a clip',hand:'Hand · drag to scroll'})[tool];$('#timeline-content').dataset.tool=tool;$('#timeline-content').style.cursor=tool==='razor'?'crosshair':tool==='hand'?'grab':'';$('#razor-guide').hidden=true;}
function fitTimeline(){zoom=clamp(($('#timeline-scroll').clientWidth-35)/Math.max(duration(project)+1,6),8,180);$('#timeline-zoom').value=zoom;$('#timeline-scroll').scrollLeft=0;renderTimeline();}
function jumpEdit(direction){const points=[0,duration(project),...project.clips.flatMap(c=>[c.start,c.start+c.duration])].sort((a,b)=>a-b);const target=direction>0?points.find(t=>t>playhead+.01):points.reverse().find(t=>t<playhead-.01);seek(target??(direction>0?duration(project):0),{refreshInspector:true});}
function trimToPlayhead(edge){const c=primaryClip();if(!c||trackLocked(c)||playhead<=c.start||playhead>=c.start+c.duration){toast('Select a clip and put the playhead inside it.');return;}edit(()=>{trimLinked(project,c.id,edge,edge==='left'?playhead-c.start:playhead-endTime(c,project.fps),assets);});}
const actions={
  'delete-keyframe':()=>{const c=primaryClip();if(!c||trackLocked(c))return;edit(()=>{const value=animatedValue(c,automationProperty,playhead);if(changeKeyframe(project,c.id,automationProperty,automationIndex,{remove:true}))c.effects[automationProperty]=value;automationIndex=-1;});},
  'remove-project-asset':()=>{
    if(!selectedAsset||!assets.has(selectedAsset))return;
    if(project.clips.some(c=>c.assetId===selectedAsset)){toast('This media is used by timeline clips. Remove those clips before using Remove from Project.',true);return;}
    edit(()=>removeProjectAsset(project,selectedAsset));selectedAsset=null;sourceRange=null;renderLibrary();toast('Removed from Project. Your original file is unchanged.');
  },
  import:()=>$('#file-input').click(),open:()=>$('#project-input').click(),save:saveProjectDialog,new:newProjectDialog,export:exportDialog,shortcuts,play:togglePlay,
  link:()=>edit(()=>{if(!linkClips(project,[...selected]))toast('Select at least two unlocked clips to link.');}),unlink:()=>edit(()=>unlinkClips(project,[...selected])),
  'import-captions':()=>$('#captions-input').click(),'export-captions':exportCaptions,'detach-audio':detachAudio,
  'insert-source':()=>insertAsset(assets.get(selectedAsset),{mode:'insert'}),'overwrite-source':()=>insertAsset(assets.get(selectedAsset),{mode:'overwrite'}),
  rename:()=>promptText('Rename project','Project name',project.name,value=>{edit(()=>project.name=value);renderLibrary();}),
  'rename-clip':()=>{const c=primaryClip();if(c&&!trackLocked(c))promptText('Rename clip','Clip name',c.name,value=>edit(()=>c.name=value));},
  undo:()=>{if(!history.past.length)return;pause();project=history.undo(project);selected=new Set([...selected].filter(id=>project.clips.some(c=>c.id===id)));applyPreviewSize();changed();renderLibrary();},
  redo:()=>{if(!history.future.length)return;pause();project=history.redo(project);applyPreviewSize();changed();renderLibrary();},
  split:performSplit,delete:()=>removeSelected(), 'ripple-delete':()=>removeSelected(true),copy:copySelected,cut:()=>{copySelected();removeSelected();},paste:()=>pasteClips(),duplicate:()=>pasteClips(true),'select-all':()=>selectClips(project.clips.map(c=>c.id)),
  'add-title':()=>addTitle(), 'add-track':addTrackDialog,'sequence-settings':sequenceSettings,
  'add-color':()=>{const t=project.tracks.find(t=>t.type==='video'&&!t.locked);if(!t)return toast('Unlock a video track first.');edit(()=>{const c=createClip({id:null,type:'color',name:'Color matte',duration:5},t.id,playhead,{color:'#29334d'});project.clips.push(c);selected=new Set([c.id]);});},
  'reset-effects':()=>{if(!primaryClip())return;edit(()=>{for(const c of project.clips.filter(c=>selected.has(c.id)&&!trackLocked(c))){c.effects={...DEFAULT_EFFECTS};c.keyframes={};delete c.effectBypass;delete c.preset;}});},
  'mark-in':()=>{edit(()=>{project.inPoint=playhead;if(project.outPoint!==null&&project.outPoint<=playhead)project.outPoint=null;},{inspector:false});toast(`In point · ${timecode(playhead,project.fps)}`);},
  'mark-out':()=>{edit(()=>{project.outPoint=playhead;if(project.inPoint!==null&&project.inPoint>=playhead)project.inPoint=null;},{inspector:false});toast(`Out point · ${timecode(playhead,project.fps)}`);},
  'clear-range':()=>edit(()=>{project.inPoint=null;project.outPoint=null;},{inspector:false}),
  marker:()=>{edit(()=>project.markers.push({id:uid(),time:playhead,name:`Marker ${project.markers.length+1}`}),{inspector:false});toast('Marker added. Double-click it to rename.');},markers:markersDialog,
  'frame-back':()=>{pause();seek(playhead-1/project.fps,{refreshInspector:true});},'frame-forward':()=>{pause();seek(playhead+1/project.fps,{refreshInspector:true});},
  'previous-edit':()=>jumpEdit(-1),'next-edit':()=>jumpEdit(1),
  loop:()=>{loop=!loop;$('[data-action="loop"]').classList.toggle('active',loop);toast(loop?'Loop playback enabled':'Loop playback disabled');},
  snapping:()=>{snapping=!snapping;$('[data-action="snapping"]').classList.toggle('active',snapping);toast(`Snapping ${snapping?'on':'off'}`);},
  'safe-guides':()=>{$('#safe-guides').hidden=!$('#safe-guides').hidden;$('[data-action="safe-guides"]').classList.toggle('active',!$('#safe-guides').hidden);},
  fullscreen:async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await $('#canvas-wrap').requestFullscreen();}catch{toast('Fullscreen is not available.');}},
  'mute-master':()=>{engine.setVolume(engine.masterVolume?0:.8);$('[data-action="mute-master"]').innerHTML=icon(engine.masterVolume?'volume':'muted');},
  snapshot:snapshotFrame,'timeline-fit':fitTimeline,'zoom-in':()=>{zoom=clamp(zoom*1.25,8,180);$('#timeline-zoom').value=zoom;renderTimeline();},'zoom-out':()=>{zoom=clamp(zoom/1.25,8,180);$('#timeline-zoom').value=zoom;renderTimeline();},
  'view-grid':()=>{assetView='grid';renderLibrary();},'view-list':()=>{assetView='list';renderLibrary();},'toggle-inspector':()=>$('.editor').classList.toggle('inspect-mode'),
  demo:()=>showModal('Open the sample project',`<p>This replaces the current timeline with a 24-second landscape sequence, animated titles, and music. Save a project file first to keep your current edit.</p>`,cancelButton+submitButton('Load sample'),()=>{$('#modal').close();loadDemo();})
};

document.addEventListener('click',e=>{
  const button=e.target.closest('button');
  if(!e.target.closest('#menu-popover')&&!e.target.closest('[data-menu]'))$('#menu-popover').hidden=true;
  if(button?.dataset.menu){if(exporting)return;showMenu(button.dataset.menu,button);return;}
  if(button?.dataset.action){e.preventDefault();if(exporting)return;$('#menu-popover').hidden=true;actions[button.dataset.action]?.();return;}
  if(exporting)return;
  if(button?.dataset.effectReset){const c=primaryClip(),prop=button.dataset.effectReset;if(c&&!trackLocked(c))edit(()=>{c.effects[prop]=DEFAULT_EFFECTS[prop];delete c.keyframes[prop];c.effectBypass=c.effectBypass?.filter(p=>p!==prop);});return;}
  if(button?.dataset.keySelect!==undefined||button?.dataset.keyNav){
    const c=primaryClip();if(!c)return;const keys=c.keyframes[automationProperty]||[];
    if(button.dataset.keySelect!==undefined)automationIndex=Number(button.dataset.keySelect);
    else {const direction=Number(button.dataset.keyNav),eligible=keys.map((key,index)=>({time:keyframeTime(c,key),index})).filter(k=>k.time>=c.start&&k.time<=endTime(c,project.fps));const next=direction>0?eligible.find(k=>toFrame(k.time,project.fps)>toFrame(playhead,project.fps)):eligible.reverse().find(k=>toFrame(k.time,project.fps)<toFrame(playhead,project.fps));if(!next)return;automationIndex=next.index;}
    if(keys[automationIndex]){pause();seek(keyframeTime(c,keys[automationIndex]),{refreshInspector:true});}return;
  }
  if(button?.dataset.library){libraryTab=button.dataset.library;searchText='';renderLibrary();return;}
  if(button?.dataset.workspace){
    const workspace=button.dataset.workspace;$$('[data-workspace]').forEach(b=>b.classList.toggle('active',b===button));
    libraryTab=workspace==='color'?'effects':workspace==='titles'?'titles':'media';inspectorTab=workspace==='audio'?'audio':'video';searchText='';renderLibrary();renderInspector();$('.editor').classList.toggle('inspect-mode',workspace!=='edit');
    if(workspace==='color'){$$('details',$('#inspector-content')).forEach(el=>{el.open=el.querySelector('summary').textContent.startsWith('Color');});}
  }
  if(button?.dataset.inspector){inspectorTab=button.dataset.inspector;renderInspector();}
  if(button?.dataset.tool)setTool(button.dataset.tool);
  if(button?.dataset.preset)applyPreset(button.dataset.preset);
  if(button?.dataset.title)addTitle(button.dataset.title);
  const assetEl=e.target.closest('[data-asset]');if(assetEl){selectedAsset=assetEl.dataset.asset;$$('[data-asset]').forEach(el=>el.classList.toggle('selected',el===assetEl));}
  if(button?.dataset.keyframe){const c=primaryClip();if(!c||trackLocked(c))return;const prop=button.dataset.keyframe;edit(()=>{if(e.altKey){c.effects[prop]=animatedValue(c,prop,playhead);delete c.keyframes[prop];}else setKeyframe(c,prop,playhead,animatedValue(c,prop,playhead),project.fps);});toast(e.altKey?'Property animation removed':'Keyframe set at playhead');}
  if(button?.dataset.trackToggle){
    const t=project.tracks.find(t=>t.id===button.dataset.track);if(!t)return;
    edit(()=>{const action=button.dataset.trackToggle;if(action==='lock')t.locked=!t.locked;else if(action==='visibility')t.hidden=!t.hidden;else if(action==='mute')t.muted=!t.muted;else if(action==='solo'){
      t.solo=!t.solo;
    }},{inspector:false});
  }
  if(button?.dataset.marker){const marker=project.markers.find(m=>m.id===button.dataset.marker);if(marker)seek(marker.time,{refreshInspector:true});}
  if(button?.dataset.gotoMarker){const marker=project.markers.find(m=>m.id===button.dataset.gotoMarker);if(marker){$('#modal').close();seek(marker.time);}}
  if(button?.dataset.deleteMarker){edit(()=>project.markers=project.markers.filter(m=>m.id!==button.dataset.deleteMarker));markersDialog();}
});
document.addEventListener('dblclick',e=>{
  if(exporting)return;const asset=e.target.closest('[data-asset]');if(asset)showAssetPreview(asset.dataset.asset);
  const clipEl=e.target.closest('[data-clip]');if(clipEl){focusedClipId=clipEl.dataset.clip;selected=new Set(linkedIds(project,[clipEl.dataset.clip]));renderInspector();$('.editor').classList.add('inspect-mode');}
  const marker=e.target.closest('[data-marker]');if(marker){const m=project.markers.find(m=>m.id===marker.dataset.marker);if(m)promptText('Rename marker','Marker name',m.name,value=>edit(()=>m.name=value));}
});
$('#modal-form').addEventListener('submit',e=>{e.preventDefault();if(e.submitter?.value==='cancel'){if(exporting)stopExport?.();else $('#modal').close();}else modalSubmit?.();});
$('#modal').addEventListener('cancel',e=>{if(exporting){e.preventDefault();stopExport?.();}});
$('#modal').addEventListener('close',()=>{$('#source-player')?.pause();});
$('#file-input').addEventListener('change',e=>{importFiles([...e.target.files]);e.target.value='';});
$('#project-input').addEventListener('change',e=>{openProjectFile(e.target.files[0]);e.target.value='';});
$('#captions-input').addEventListener('change',e=>{importCaptions(e.target.files[0]).catch(error=>toast(error.message,true));e.target.value='';});
$('#preview-quality').addEventListener('change',()=>{if(!exporting)applyPreviewSize();});
$('#monitor-seek').addEventListener('input',e=>{if(playing)pause();seek(Number(e.target.value));});
$('#monitor-seek').addEventListener('change',()=>renderInspector());
$('#timeline-zoom').addEventListener('input',e=>{zoom=Number(e.target.value);renderTimeline();});
$('#track-zoom').addEventListener('input',e=>{trackZoom=clamp(Number(e.target.value),44,180);renderTimeline();queueSave();});
document.addEventListener('input',e=>{
  const el=e.target;
  if(el.id==='asset-search'||el.id==='effect-search'){
    const pos=el.selectionStart;searchText=el.value;renderLibrary();const fresh=$('#'+el.id);fresh.focus();fresh.setSelectionRange(pos,pos);return;
  }
  if(exporting)return;
  const c=primaryClip();if(!c||trackLocked(c))return;
  if(el.dataset.effect){
    const value=Number(el.value);if(!Number.isFinite(value))return;
    if(!inputSnapshot){snapshot();inputSnapshot=true;}
    const prop=el.dataset.effect,v=clamp(value,Number(el.min),Number(el.max));
    c.effects[prop]=v;if(c.keyframes[prop]?.length)setKeyframe(c,prop,playhead,v,project.fps);
    $$(`[data-effect="${prop}"]`).forEach(other=>{if(other!==el)other.value=v;});engine.sync(playhead,playing);queueSave();
  }
  if(el.dataset.titleProp){
    if(!inputSnapshot){snapshot();inputSnapshot=true;}const prop=el.dataset.titleProp;
    c.title[prop]=el.type==='checkbox'?el.checked:['fontSize','weight'].includes(prop)?clamp(Number(el.value)||12,12,800):el.value;engine.sync(playhead,playing);queueSave();
  }
  if(el.id==='matte-color'){if(!inputSnapshot){snapshot();inputSnapshot=true;}c.color=el.value;engine.render();queueSave();}
});
document.addEventListener('change',e=>{
  const el=e.target;if(exporting)return;
  if(el.dataset.effect||el.dataset.titleProp||el.id==='matte-color'){inputSnapshot=false;changed({inspector:false});return;}
  if(el.dataset.markerName){const m=project.markers.find(m=>m.id===el.dataset.markerName);if(m)edit(()=>m.name=el.value,{inspector:false});return;}
  const c=primaryClip();if(!c||trackLocked(c))return;
  if(el.dataset.effectEnable){const prop=el.dataset.effectEnable;edit(()=>{c.effectBypass=(c.effectBypass||[]).filter(p=>p!==prop);if(!el.checked)c.effectBypass.push(prop);});return;}
  if(el.id==='automation-property'){automationProperty=el.value;automationIndex=-1;renderInspector();return;}
  if(el.id==='keyframe-time'||el.id==='keyframe-interpolation'){
    const key=c.keyframes[automationProperty]?.[automationIndex];
    edit(()=>{if(!changeKeyframe(project,c.id,automationProperty,automationIndex,el.id==='keyframe-time'?{time:Number(el.value)}:{interpolation:el.value}))toast('A keyframe already occupies that frame, or the edit is invalid.');automationIndex=c.keyframes[automationProperty]?.indexOf(key)??-1;});return;
  }
  if(el.dataset.timing){
    const value=Number(el.value);if(!Number.isFinite(value)){renderInspector();return;}
    edit(()=>{if(el.dataset.timing==='start')moveClips(project,[c.id],value-c.start);else trimLinked(project,c.id,'right',value-c.duration,assets);});
  }
  if(el.id==='clip-speed')edit(()=>changeSpeed(project,c.id,Number(el.value)));
  if(el.id==='clip-fit')edit(()=>c.fit=el.value);
});
document.addEventListener('focusout',e=>{if(e.target.dataset?.effect||e.target.dataset?.titleProp)inputSnapshot=false;});

function showSnap(result){const el=$('#snap-guide');el.hidden=result.point===null;el.style.left=`${(result.point||0)*zoom}px`;el.querySelector('span').textContent=result.kind||'';}
$('#timeline-content').addEventListener('pointermove',e=>{if(tool!=='razor'||exporting)return;const c=project.clips.find(c=>c.id===e.target.closest('[data-clip]')?.dataset.clip);const guide=$('#razor-guide');const t=quantize(timelineX(e.clientX),project.fps);guide.hidden=!c||trackLocked(c)||t<=c.start||t>=endTime(c,project.fps);guide.style.left=`${t*zoom}px`;guide.querySelector('span').textContent=timecode(t,project.fps);});
$('#timeline-content').addEventListener('pointerleave',()=>$('#razor-guide').hidden=true);
function timelineX(clientX){const r=$('#timeline-content').getBoundingClientRect();return Math.max(0,(clientX-r.left)/zoom);}
$('#timeline-content').addEventListener('pointerdown',e=>{
  if(e.button!==0||exporting||e.target.closest('[data-marker]'))return;
  e.currentTarget.tabIndex=-1;e.currentTarget.focus({preventScroll:true});
  const clipEl=e.target.closest('[data-clip]'),edge=e.target.dataset.edge;
  if(tool==='hand'){
    e.preventDefault();const x=e.clientX,scroll=$('#timeline-scroll').scrollLeft;const move=ev=>$('#timeline-scroll').scrollLeft=scroll-(ev.clientX-x);const up=()=>{document.removeEventListener('pointermove',move);document.removeEventListener('pointerup',up);};document.addEventListener('pointermove',move);document.addEventListener('pointerup',up);return;
  }
  if(!clipEl){
    if(playing)pause();
    if(!e.target.closest('#ruler')&&!e.target.closest('#playhead')&&!e.shiftKey){selected.clear();renderInspector();renderHeader();$$('.timeline-clip.selected').forEach(el=>el.classList.remove('selected'));}
    seek(timelineX(e.clientX));e.preventDefault();let lastX=null,scrubFrame=0;const move=ev=>{lastX=ev.clientX;if(!scrubFrame)scrubFrame=requestAnimationFrame(()=>{scrubFrame=0;if(lastX!==null)seek(timelineX(lastX));});};const up=()=>{cancelAnimationFrame(scrubFrame);if(lastX!==null)seek(timelineX(lastX));document.removeEventListener('pointermove',move);document.removeEventListener('pointerup',up);renderInspector();};document.addEventListener('pointermove',move);document.addEventListener('pointerup',up);return;
  }
  const id=clipEl.dataset.clip,c=project.clips.find(c=>c.id===id);if(!c)return;
  if(!editableIds(project,[id]).includes(id)){toast('This clip or a linked track is locked. Unlock it to keep the edit in sync.');return;}
  e.preventDefault();if(playing)pause();
  if(tool==='razor'){
    const time=quantize(timelineX(e.clientX),project.fps);
    if(toFrame(time,project.fps)>toFrame(c.start,project.fps)&&toFrame(time,project.fps)<toFrame(c.start+c.duration,project.fps))edit(()=>{const rights=cutClips(project,[id],time);selected=new Set(rights.length?rights:[id]);focusedClipId=rights[0];});return;
  }
  focusedClipId=id;const members=linkedIds(project,[id]);if(e.shiftKey){const remove=selected.has(id);members.forEach(member=>remove?selected.delete(member):selected.add(member));}else if(!selected.has(id))selected=new Set(members);
  renderHeader();renderInspector();$$('.timeline-clip').forEach(el=>el.classList.toggle('selected',selected.has(el.dataset.clip)));
  const x=e.clientX,originalProject=clone(project),original=clone(c),ids=[...selected],initialScroll=$('#timeline-scroll').scrollLeft;let moved=false,pending=null,dragFrame=0;
  const timingFields=['start','duration','sourceIn','track','automationOffset','envelopeOffset'];
  const originals=new Map(originalProject.clips.map(c=>[c.id,c]));
  const performMove=ev=>{
    if(Math.abs(ev.clientX-x)<3&&!moved)return;
    if(!moved){history.push(originalProject);moved=true;}
    const delta=(ev.clientX-x+$('#timeline-scroll').scrollLeft-initialScroll)/zoom;
    for(const item of project.clips){const base=originals.get(item.id);for(const prop of timingFields){if(base[prop]===undefined)delete item[prop];else item[prop]=base[prop];}}
    const current=project.clips.find(c=>c.id===id);
    const sourceDuration=['audio','video'].includes(current.type)?assets.get(current.assetId)?.duration||Infinity:Infinity;
    if(edge){
      let amount=quantize(delta,project.fps);
      const base=edge==='left'?original.start:endTime(original,project.fps),bounds=trimBounds(project,id,edge,assets);
      if(!bounds||bounds.min>bounds.max){showSnap({point:null});return;}
      const snap=resolveSnap(project,{time:base+amount,exclude:linkedIds(project,[id]),playhead,zoom,enabled:snapping,bypass:ev.altKey,min:base+bounds.min,max:base+bounds.max});amount=snap.time-base;showSnap(snap);
      if(!trimLinked(project,id,edge,amount,assets,tool==='ripple'))showSnap({point:null});
    }else if(tool==='slip'){
      if(['audio','video'].includes(current.type))slipLinked(project,id,delta,assets);
    }else{
      let newStart=Math.max(0,quantize(original.start+delta,project.fps));
      const earliestStart=Math.min(...project.clips.filter(c=>ids.includes(c.id)).map(c=>c.start));
      const snap=resolveSnap(project,{time:newStart,offsets:[0,current.duration],exclude:ids,playhead,zoom,enabled:snapping,bypass:ev.altKey,min:original.start-earliestStart});newStart=snap.time;showSnap(snap);
      let shift=newStart-original.start;const group=project.clips.filter(c=>ids.includes(c.id)&&!trackLocked(c));shift=Math.max(shift,-Math.min(...group.map(c=>c.start),0));
      // Clamp against the earliest member without changing positive moves.
      const earliest=Math.min(...group.map(c=>c.start));if(Number.isFinite(earliest))shift=Math.max(newStart-original.start,-earliest);
      moveClips(project,ids,shift);
      const targetEl=document.elementFromPoint(ev.clientX,ev.clientY)?.closest('.timeline-track'),target=project.tracks.find(t=>t.id===targetEl?.dataset.track);
      if(group.filter(c=>c.type===current.type).length===1&&target&&!target.locked&&compatibleTrack(current,target))current.track=target.id;
    }
    updateClipGeometry();engine.sync(playhead,false);status(`${edge?'Trimming':tool==='slip'?'Slipping':'Moving'} ${current.name} · ${timecode(current.duration,project.fps)}`);
  };
  const move=ev=>{pending={clientX:ev.clientX,clientY:ev.clientY,altKey:ev.altKey};if(!dragFrame)dragFrame=requestAnimationFrame(()=>{dragFrame=0;if(pending){performMove(pending);pending=null;}});};
  const up=()=>{cancelAnimationFrame(dragFrame);if(pending)performMove(pending);document.removeEventListener('pointermove',move);document.removeEventListener('pointerup',up);showSnap({point:null});if(moved)changed();else renderTimeline();status('Ready when you are');};
  document.addEventListener('pointermove',move);document.addEventListener('pointerup',up);
});
$('#timeline-content').addEventListener('contextmenu',e=>{e.preventDefault();if(exporting)return;const clip=e.target.closest('[data-clip]');if(clip){selectClips([clip.dataset.clip]);showMenu('edit',null,{x:e.clientX,y:e.clientY});}});
$('#vertical-resizer').addEventListener('pointerdown',e=>{e.preventDefault();const bounds=$('.editor').getBoundingClientRect();const move=ev=>document.documentElement.style.setProperty('--upper',`${clamp((ev.clientY-bounds.top)/bounds.height*100,35,68)}%`);const up=()=>{document.removeEventListener('pointermove',move);document.removeEventListener('pointerup',up);};document.addEventListener('pointermove',move);document.addEventListener('pointerup',up);});

document.addEventListener('dragstart',e=>{
  const asset=e.target.closest('[data-asset]'),preset=e.target.closest('[data-preset]');
  if(asset){e.dataTransfer.setData('application/x-cutline-asset',asset.dataset.asset);e.dataTransfer.effectAllowed='copy';}
  else if(preset){e.dataTransfer.setData('application/x-cutline-effect',preset.dataset.preset);e.dataTransfer.effectAllowed='copy';}
});
document.addEventListener('dragenter',e=>{if(e.dataTransfer.types.includes('Files')&&!exporting){dragDepth++;$('#drop-overlay').hidden=false;}});
document.addEventListener('dragleave',e=>{if(e.dataTransfer.types.includes('Files')){dragDepth--;if(dragDepth<=0)$('#drop-overlay').hidden=true;}e.target.closest?.('.timeline-track')?.classList.remove('drag-over');});
document.addEventListener('dragover',e=>{e.preventDefault();e.dataTransfer.dropEffect='copy';const track=e.target.closest('.timeline-track');if(track)track.classList.add('drag-over');});
document.addEventListener('drop',e=>{
  e.preventDefault();dragDepth=0;$('#drop-overlay').hidden=true;$$('.drag-over').forEach(el=>el.classList.remove('drag-over'));if(exporting)return;
  const track=e.target.closest('.timeline-track'),clip=e.target.closest('[data-clip]');
  const asset=e.dataTransfer.getData('application/x-cutline-asset'),preset=e.dataTransfer.getData('application/x-cutline-effect');
  if(asset&&track){const time=timelineX(e.clientX);insertAsset(assets.get(asset),{track:track.dataset.track,start:resolveSnap(project,{time,playhead,zoom,enabled:snapping,bypass:e.altKey}).time});}
  if(preset&&clip)applyPreset(preset,[clip.dataset.clip]);
  if(e.dataTransfer.files.length){
    const files=[...e.dataTransfer.files];if(files.length===1&&/\.(cutline|json)$/i.test(files[0].name)){openProjectFile(files[0]);return;}
    importFiles(files,{targetTrack:track?.dataset.track,start:track?timelineX(e.clientX):null});
  }
});
document.addEventListener('pointerdown',e=>{if(e.target.closest('#library-content'))editingContext='project';else if(e.target.closest('.timeline-panel'))editingContext='timeline';});
$('#library-content').addEventListener('contextmenu',e=>{const card=e.target.closest('[data-asset]');if(!card||exporting)return;e.preventDefault();selectedAsset=card.dataset.asset;editingContext='project';renderLibrary();showMenu('media',null,{x:e.clientX,y:e.clientY});});
document.addEventListener('keydown',e=>{
  const formControl=e.target.closest('input,textarea,select,[contenteditable="true"]');
  if(formControl||$('#modal').open||exporting)return;
  const ctrl=e.ctrlKey||e.metaKey,key=e.key.toLowerCase();let fn;
  if(!ctrl&&['delete','backspace'].includes(key)&&editingContext==='project'){e.preventDefault();actions['remove-project-asset']();return;}
  if(ctrl){
    if(key==='z')fn=e.shiftKey?actions.redo:actions.undo;
    else if(key==='y')fn=actions.redo;else if(key==='k')fn=performSplit;else if(key==='s')fn=saveProjectDialog;else if(key==='i')fn=actions.import;else if(key==='o')fn=actions.open;else if(key==='m')fn=exportDialog;else if(key==='a')fn=actions['select-all'];else if(key==='c')fn=copySelected;else if(key==='v')fn=actions.paste;else if(key==='x')fn=e.shiftKey?actions['clear-range']:actions.cut;else if(key==='d')fn=actions.duplicate;else if(key==='n'&&e.altKey)fn=newProjectDialog;
  }else{
    const bindings={' ':togglePlay,v:()=>setTool('select'),c:()=>setTool('razor'),b:()=>setTool('ripple'),y:()=>setTool('slip'),h:()=>setTool('hand'),t:()=>addTitle(),s:actions.snapping,i:actions['mark-in'],o:actions['mark-out'],m:actions.marker,'?':shortcuts,'\\':fitTimeline,'=':actions['zoom-in'],'+':actions['zoom-in'],'-':actions['zoom-out'],delete:()=>removeSelected(e.shiftKey),backspace:()=>removeSelected(e.shiftKey),home:()=>seek(0,{refreshInspector:true}),end:()=>seek(duration(project),{refreshInspector:true}),arrowup:()=>jumpEdit(-1),arrowdown:()=>jumpEdit(1),arrowleft:()=>{pause();seek(playhead-(e.shiftKey?1:1/project.fps),{refreshInspector:true});},arrowright:()=>{pause();seek(playhead+(e.shiftKey?1:1/project.fps),{refreshInspector:true});},j:()=>play(playing&&playbackRate<0?Math.max(-4,playbackRate*2):-1),k:pause,l:()=>play(playing&&playbackRate>0?Math.min(4,playbackRate*2):1),q:()=>trimToPlayhead('left'),w:()=>trimToPlayhead('right'),escape:()=>{selected.clear();$('#menu-popover').hidden=true;renderTimeline();renderInspector();renderHeader();}};
    fn=bindings[key];if(key===',')fn=actions['insert-source'];if(key==='.')fn=actions['overwrite-source'];if(e.shiftKey&&(key==='5'||key==='%'))fn=actions['toggle-inspector'];
  }
  if(fn){e.preventDefault();if(e.repeat&&[' ','t','m'].includes(key))return;fn();}
});
$('#library-content').addEventListener('keydown',e=>{if(e.key==='Enter'){const asset=e.target.closest('[data-asset]');if(asset)showAssetPreview(asset.dataset.asset);}});
$('#timeline-scroll').addEventListener('wheel',e=>{if(e.ctrlKey||e.metaKey){e.preventDefault();const old=zoom,x=e.clientX-$('#timeline-scroll').getBoundingClientRect().left,point=($('#timeline-scroll').scrollLeft+x)/old;zoom=clamp(zoom*(e.deltaY<0?1.1:1/1.1),8,180);$('#timeline-zoom').value=zoom;renderTimeline();$('#timeline-scroll').scrollLeft=point*zoom-x;}},{passive:false});
$('#track-viewport').addEventListener('scroll',e=>{e.currentTarget.style.setProperty('--track-scroll',`${e.currentTarget.scrollTop}px`);},{passive:true});
window.addEventListener('resize',()=>{renderTimeline();});
new ResizeObserver(()=>{const r=$('#preview').getBoundingClientRect(),parent=$('#canvas-wrap').getBoundingClientRect(),guides=$('#safe-guides');guides.style.inset='auto';guides.style.left=`${r.left-parent.left+r.width*.1}px`;guides.style.top=`${r.top-parent.top+r.height*.1}px`;guides.style.width=`${r.width*.8}px`;guides.style.height=`${r.height*.8}px`;}).observe($('#preview'));
window.addEventListener('beforeunload',e=>{if(exporting||saving||$('#save-status').textContent==='Saving…'){e.preventDefault();e.returnValue='';}});

async function loadDemo(){
  pause();status('Preparing sample project…');engine.reset();
  for(const asset of assets.values())URL.revokeObjectURL(asset.url);assets.clear();project=createProject();project.name='The great outdoors';project.sequence='Outdoors · Main sequence';history=new History();
  const examples=[['alpine.jpg','Alpine peaks.jpg'],['lake.jpg','Morning stillness.jpg'],['forest.jpg','Into the forest.jpg']];
  for(const [path,name]of examples){try{const blob=await(await fetch(`assets/${path}`)).blob();const a=await readAsset(new File([blob],name,{type:'image/jpeg'}));assets.set(a.id,a);await storeAsset(a);}catch(e){toast(`Sample media unavailable: ${name}`,true);}}
  const pictures=[...assets.values()];pictures.forEach((a,i)=>{
    const c=createClip(a,'v1',i*8,{duration:8,name:a.name});
    c.effects.contrast=108;c.effects.saturation=85;c.effects.temperature=-7;c.effects.vignette=15;
    c.keyframes.scale=[{time:0,value:100},{time:8,value:112}];if(i===0)c.effects.fadeIn=.8;if(i===2)c.effects.fadeOut=1;project.clips.push(c);
  });
  const title=createClip({id:null,type:'title',name:'The great outdoors',duration:6},'v3',1,{title:{text:'THE GREAT\nOUTDOORS',fontSize:128,weight:800,font:'Arial',color:'#ffffff',align:'center',shadow:true}});title.effects.fadeIn=.9;title.effects.fadeOut=.7;title.effects.y=3;title.keyframes.y=[{time:0,value:7},{time:1.2,value:3}];project.clips.push(title);
  const subtitle=createClip({id:null,type:'title',name:'A little further from ordinary',duration:6},'v2',1,{title:{text:'A  L I T T L E  F U R T H E R  F R O M  O R D I N A R Y',fontSize:22,weight:400,font:'Arial',color:'#e0e3e5',align:'center',shadow:true}});subtitle.effects.y=24;subtitle.effects.fadeIn=1.3;subtitle.effects.fadeOut=.7;project.clips.push(subtitle);
  const endTitle=createClip({id:null,type:'title',name:'Find your own path.',duration:6},'v3',17,{title:{text:'Find your own path.',fontSize:90,weight:600,font:'Georgia',color:'#f1eee5',align:'center',shadow:true}});endTitle.effects.fadeIn=1;endTitle.effects.fadeOut=1;project.clips.push(endTitle);
  try{const a=await readAsset(makeDemoAudio(24));assets.set(a.id,a);const c=createClip(a,'a2',0);c.effects.volume=65;c.effects.audioFadeIn=2;c.effects.audioFadeOut=2;project.clips.push(c);await waveform(a,new OfflineAudioContext(1,1,22050));await storeAsset(a);}catch(e){toast('Demo audio could not be prepared.',true);}
  project.markers=[{id:uid(),time:0,name:'Opening'},{id:uid(),time:8,name:'Stillness'},{id:uid(),time:16,name:'Into the forest'}];playhead=3.5;selected=new Set(pictures.length?[project.clips[0].id]:[title.id]);selectedAsset=pictures[0]?.id;libraryTab='media';searchText='';inspectorTab='video';
  applyPreviewSize();renderLibrary();changed();await engine.prepare();engine.sync(playhead,false);fitTimeline();status('Sample project · make it your own');queueSave();
}
async function init(){
  hydrateIcons();renderHeader();renderLibrary();renderInspector();renderTimeline();requestAnimationFrame(tick);
  try{db=await openDatabase();const session=await dbRead(db,'session','current');
    if(session){
      project=validateProject(session.project);const saved=await dbAll(db,'assets');
      for(const a of saved)if(session.assetIds.includes(a.id)&&a.blob)assets.set(a.id,{...a,url:URL.createObjectURL(a.blob)});
      trackZoom=clamp(session.view?.trackZoom||60,44,180);$('#track-zoom').value=trackZoom;playhead=clamp(quantize(session.playhead||0,project.fps),0,duration(project));selected=new Set(project.clips.length?[project.clips[0].id]:[]);
      applyPreviewSize();renderLibrary();changed();await engine.prepare();engine.sync(playhead,false);fitTimeline();status('Your previous session is restored');return;
    }
  }catch(e){toast('Local restore is unavailable. You can still save and open project files.',true);}
  await loadDemo();
}
init().catch(e=>{console.error(e);toast(`Could not initialize the editor: ${e.message}`,true);});
