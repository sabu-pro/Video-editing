import { quantize, toFrame, fromFrame, endFrame, normalizeTiming, floorFrames } from './timing.js';
import { linkedIds, editableIds } from './links.js';
export const uid = () => globalThis.crypto.randomUUID();
export const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
export const clone = (o) => structuredClone(o);
export const DEFAULT_EFFECTS = { x:0, y:0, scale:100, rotation:0, opacity:100, exposure:0, contrast:100, saturation:100, temperature:0, blur:0, vignette:0, grayscale:0, fadeIn:0, fadeOut:0, volume:100, audioFadeIn:0, audioFadeOut:0, cropTop:0, cropBottom:0, cropLeft:0, cropRight:0 };
export const EFFECT_PRESETS = [
  { name:'Original', category:'Color', description:'A clean starting point', color:'#a4b1be', values:{exposure:0,contrast:100,saturation:100,temperature:0,grayscale:0,vignette:0,blur:0} },
  { name:'Cinematic', category:'Color', description:'Deep shadows, muted color', color:'#dfac7b', values:{contrast:120,saturation:78,temperature:12,vignette:28} },
  { name:'Golden hour', category:'Color', description:'Warm light, soft contrast', color:'#f0b663', values:{exposure:0.15,contrast:105,saturation:110,temperature:40,vignette:12} },
  { name:'Arctic', category:'Color', description:'Cool tones, crisp detail', color:'#8ac5d2', values:{contrast:112,saturation:80,temperature:-35} },
  { name:'Noir', category:'Color', description:'Classic black and white', color:'#c4c7d3', values:{grayscale:100,contrast:135,saturation:0,vignette:30} },
  { name:'Faded film', category:'Color', description:'A softer, nostalgic look', color:'#b6b595', values:{exposure:0.15,contrast:80,saturation:65,temperature:15} },
  { name:'Dream blur', category:'Stylize', description:'Soft focus and gentle light', color:'#b6a2e8', values:{blur:5,exposure:0.2,saturation:85} },
  { name:'Vignette', category:'Stylize', description:'Bring the focus to the center', color:'#8c99b9', values:{vignette:65} },
  { name:'Dissolve in', category:'Transitions', description:'Fade in over one second', color:'#98acfa', values:{fadeIn:1} },
  { name:'Dissolve out', category:'Transitions', description:'Fade out over one second', color:'#ad9cf8', values:{fadeOut:1} },
  { name:'Audio fade', category:'Transitions', description:'Smooth the beginning and end', color:'#83c4ac', values:{audioFadeIn:1,audioFadeOut:1} }
];
export function createProject() {
  return { version:1, name:'Untitled project', sequence:'Sequence 01', width:1920, height:1080, fps:30, clips:[], markers:[], inPoint:null, outPoint:null, tracks:[
    {id:'v3',name:'Titles',type:'video',muted:false,hidden:false,locked:false},
    {id:'v2',name:'Overlays',type:'video',muted:false,hidden:false,locked:false},
    {id:'v1',name:'Video',type:'video',muted:false,hidden:false,locked:false},
    {id:'a1',name:'Audio',type:'audio',muted:false,hidden:false,locked:false},
    {id:'a2',name:'Music',type:'audio',muted:false,hidden:false,locked:false}
  ] };
}
export function createClip(asset, track, start=0, options={}) {
  return { id:uid(), assetId:asset.id, name:asset.name, type:asset.type, track, start, duration:asset.type==='image'?5:asset.duration||5, sourceIn:0, speed:1, effects:{...DEFAULT_EFFECTS}, keyframes:{}, ...options };
}
export function duration(project) { return project.clips.reduce((max,c)=>Math.max(max,endFrame(c,project.fps)),0)/project.fps; }
export function timecode(time,fps=30) {
  const f = Math.max(0,Math.round(time*fps));
  return [Math.floor(f/(fps*3600)),Math.floor(f/(fps*60))%60,Math.floor(f/fps)%60,f%fps].map(n=>String(n).padStart(2,'0')).join(':');
}
export function splitClip(project,id,time) {
  time=quantize(time,project.fps);
  const clip = project.clips.find(c=>c.id===id);
  if(!clip || project.tracks.find(t=>t.id===clip.track)?.locked || time<clip.start+1/project.fps-1e-7 || time>clip.start+clip.duration-1/project.fps+1e-7) return null;
  const leftDuration=(toFrame(time,project.fps)-toFrame(clip.start,project.fps))/project.fps;
  const right={...clone(clip),id:uid(),start:time,duration:quantize(clip.duration-leftDuration,project.fps),sourceIn:clip.sourceIn+leftDuration*clip.speed};
  if(clip.linkId)right.linkId=clip.linkId+':'+toFrame(time,project.fps);
  // Keep the original automation domain: slicing a curve must not change it.
  right.automationOffset=(clip.automationOffset||0)+leftDuration;
  clip.envelopeDuration ??= clip.duration;
  right.envelopeDuration=clip.envelopeDuration;
  right.envelopeOffset=(clip.envelopeOffset||0)+leftDuration;
  clip.duration=leftDuration;
  project.clips.push(right); return right;
}
export function trimClip(clip,edge,delta,sourceDuration=Infinity,min=1/30) {
  const fps=Math.round(1/min);delta=quantize(delta,fps);
  if(edge==='left') {
    const minimum=Math.ceil(Math.max(-clip.start,-clip.sourceIn/clip.speed)*fps-1e-7)/fps;
    const amount=clamp(delta,minimum,quantize(clip.duration-min,fps));
    clip.automationOffset=(clip.automationOffset||0)+amount;
    if(clip.envelopeDuration!==undefined)clip.envelopeOffset=(clip.envelopeOffset||0)+amount;
    clip.start=quantize(clip.start+amount,fps);clip.sourceIn=Math.max(0,clip.sourceIn+amount*clip.speed);clip.duration=quantize(clip.duration-amount,fps);
  } else clip.duration=clamp(quantize(clip.duration+delta,fps),min,Math.max(min,floorFrames((sourceDuration-clip.sourceIn)/clip.speed,fps)/fps));
  return clip;
}
export function deleteClips(project,ids,ripple=false) {
  ids=editableIds(project,ids);const removable=project.clips.filter(c=>ids.includes(c.id));
  if(ripple){
    const ranges=new Map();
    for(const c of removable){if(!ranges.has(c.track))ranges.set(c.track,[]);ranges.get(c.track).push([toFrame(c.start,project.fps),endFrame(c,project.fps)]);}
    for(const [track,intervals]of ranges){const merged=[];for(const interval of intervals.sort((a,b)=>a[0]-b[0])){const last=merged.at(-1);if(last&&last[1]>=interval[0])last[1]=Math.max(last[1],interval[1]);else merged.push([...interval]);}ranges.set(track,merged);}
    const shifts=new Map();
    for(const c of project.clips){if(ids.includes(c.id))continue;const amount=(ranges.get(c.track)||[]).reduce((sum,[a,b])=>sum+(b<=toFrame(c.start,project.fps)?b-a:0),0);if(amount){for(const member of linkedIds(project,[c.id]))if(!ids.includes(member))shifts.set(member,Math.max(shifts.get(member)||0,amount));}}
    if(editableIds(project,[...shifts.keys()]).length!==shifts.size)return false;
    for(const c of project.clips)if(shifts.has(c.id))c.start=Math.max(0,(toFrame(c.start,project.fps)-shifts.get(c.id))/project.fps);
  }
  project.clips=project.clips.filter(c=>!ids.includes(c.id));return true;
}
export function animatedValue(clip,property,time) {
  const keys=clip.keyframes?.[property];
  if(!keys?.length) return clip.effects[property]??DEFAULT_EFFECTS[property]??0;
  const local=time-clip.start+(clip.automationOffset||0);
  const sorted=keys;
  if(local<=sorted[0].time) return sorted[0].value;
  for(let i=1;i<sorted.length;i++) if(local<=sorted[i].time) {
    const a=sorted[i-1], b=sorted[i], ratio=(local-a.time)/(b.time-a.time||1);
    return a.value+(b.value-a.value)*ratio;
  }
  return sorted.at(-1).value;
}
export function setKeyframe(clip,property,time,value,fps=30) {
  const local=quantize(clamp(time-clip.start,0,clip.duration)+(clip.automationOffset||0),fps);
  const keys=clip.keyframes[property]||[];
  const existing=keys.find(k=>Math.abs(k.time-local)<0.5/fps);
  if(existing) existing.value=value; else keys.push({time:local,value});
  clip.keyframes[property]=keys.sort((a,b)=>a.time-b.time);
}
export function snapTime(project,time,exclude=[],threshold=0.15) {
  const points=[0,...project.markers.map(m=>m.time)];
  for(const c of project.clips) if(!exclude.includes(c.id)) points.push(c.start,c.start+c.duration);
  let best=time,dist=threshold;
  for(const point of points) if(Math.abs(point-time)<dist) {dist=Math.abs(point-time);best=point;}
  return best;
}
export function insertGap(project,time,length){
  const editable=new Set(editableIds(project,project.clips.map(c=>c.id)));
  time=quantize(time,project.fps);length=quantize(length,project.fps);
  for(const c of [...project.clips]){
    if(!editable.has(c.id))continue;
    if(c.start>=time-.00001)c.start=quantize(c.start+length,project.fps);
    else if(c.start+c.duration>time+.00001){const right=splitClip(project,c.id,time);if(right)right.start+=length;}
  }
}
export function overwriteRange(project,track,start,end){
  if(project.tracks.find(t=>t.id===track)?.locked)return;
  const min=1/project.fps;
  for(const c of [...project.clips].filter(c=>c.track===track&&c.start<end&&c.start+c.duration>start)){
    const cEnd=c.start+c.duration;
    if(c.start>=start&&cEnd<=end){project.clips=project.clips.filter(item=>item.id!==c.id);continue;}
    if(c.start<start&&cEnd>end){
      const right=splitClip(project,c.id,start);
      if(right){trimClip(right,'left',end-start,Infinity,min);}continue;
    }
    if(c.start<start)trimClip(c,'right',start-cEnd,Infinity,min);
    else trimClip(c,'left',end-c.start,Infinity,min);
  }
}
export function parseSrt(text){
  const stamp=string=>{const m=string.trim().match(/^(\d+):(\d{2}):(\d{2})[,.](\d{3})/);return m?Number(m[1])*3600+Number(m[2])*60+Number(m[3])+Number(m[4])/1000:NaN;};
  const cues=[];
  for(const block of text.replace(/^\uFEFF/,'').replace(/\r/g,'').trim().split(/\n\s*\n/)){
    const lines=block.split('\n'),index=lines.findIndex(line=>line.includes('-->'));if(index<0)continue;
    const [a,b]=lines[index].split('-->'),start=stamp(a),end=stamp(b),content=lines.slice(index+1).join('\n').replace(/<[^>]*>/g,'').trim();
    if(Number.isFinite(start)&&Number.isFinite(end)&&end>start&&content)cues.push({start,end,text:content});
  }
  return cues.sort((a,b)=>a.start-b.start);
}
export function serializeSrt(clips){
  const stamp=t=>{const ms=Math.round(t*1000),s=Math.floor(ms/1000);return `${[Math.floor(s/3600),Math.floor(s/60)%60,s%60].map(n=>String(n).padStart(2,'0')).join(':')},${String(ms%1000).padStart(3,'0')}`;};
  return clips.filter(c=>c.type==='title'&&c.caption).sort((a,b)=>a.start-b.start).map((c,i)=>`${i+1}\n${stamp(c.start)} --> ${stamp(c.start+c.duration)}\n${c.title.text}\n`).join('\n');
}
export function validateProject(data) {
  const p=data?.project||data;
  if(!p || p.version!==1 || !Array.isArray(p.clips) || !Array.isArray(p.tracks) || !p.tracks.length || p.tracks.length>30) throw new Error('This is not a valid Cutline project.');
  if(![24,25,30,60].includes(p.fps) || !Number.isFinite(p.width)||!Number.isFinite(p.height)||p.width<64||p.height<64||p.width>3840||p.height>3840) throw new Error('Invalid sequence settings.');
  const trackIds=new Set(); const clipIds=new Set();
  for(const t of p.tracks) { if(typeof t.id!=='string'||trackIds.has(t.id)||!['audio','video'].includes(t.type)) throw new Error('Invalid tracks.'); trackIds.add(t.id); }
  for(const c of p.clips) {
    if(typeof c.id!=='string'||clipIds.has(c.id)||!trackIds.has(c.track)||!['image','video','audio','title','color'].includes(c.type)||![c.start,c.duration,c.sourceIn,c.speed].every(Number.isFinite)||c.start<0||c.duration<=0||c.sourceIn<0||c.speed<0.1||c.speed>8) throw new Error('Invalid clip data.');
    clipIds.add(c.id); c.effects={...DEFAULT_EFFECTS,...c.effects}; c.keyframes ||= {};
    for(const [prop,val] of Object.entries(c.effects)) if(!(prop in DEFAULT_EFFECTS)||!Number.isFinite(val)) throw new Error('Invalid effect data.');
    for(const [prop,keys] of Object.entries(c.keyframes)) if(!(prop in DEFAULT_EFFECTS)||!Array.isArray(keys)||keys.some(k=>!Number.isFinite(k.time)||!Number.isFinite(k.value))) throw new Error('Invalid keyframes.');
    normalizeTiming(c,p.fps);
    for(const keys of Object.values(c.keyframes))keys.sort((a,b)=>a.time-b.time);
    for(const prop of ['automationOffset','envelopeOffset','envelopeDuration'])if(c[prop]!==undefined&&!Number.isFinite(c[prop]))throw new Error('Invalid automation timing.');
    c.name=String(c.name||'Clip');
    if(c.linkId!==undefined&&typeof c.linkId!=='string')throw new Error('Invalid clip link.');
    if(c.type==='title'){
      if(!c.title||typeof c.title.text!=='string')throw new Error('Invalid title data.');
      c.title.fontSize=clamp(Number(c.title.fontSize)||80,12,400);
      c.title.font=['Arial','Georgia','Verdana','Impact','Courier New'].includes(c.title.font)?c.title.font:'Arial';
      c.title.align=['left','center','right'].includes(c.title.align)?c.title.align:'center';
      c.title.weight=[400,600,800].includes(c.title.weight)?c.title.weight:600;
      c.title.color=/^#[0-9a-f]{6}$/i.test(c.title.color)?c.title.color:'#ffffff';
      c.title.background=/^#[0-9a-f]{6}$/i.test(c.title.background)?c.title.background:undefined;
    }
    if(c.type==='color')c.color=/^#[0-9a-f]{6}$/i.test(c.color)?c.color:'#29334d';
  }
  p.markers=Array.isArray(p.markers)?p.markers.filter(m=>Number.isFinite(m.time)&&m.time>=0):[];
  p.inPoint=Number.isFinite(p.inPoint)?Math.max(0,p.inPoint):null;
  p.outPoint=Number.isFinite(p.outPoint)?Math.max(0,p.outPoint):null;
  p.name=String(p.name||'Untitled project'); p.sequence=String(p.sequence||'Sequence 01');
  return p;
}
export class History {
  constructor(limit=80){this.past=[];this.future=[];this.limit=limit;}
  push(project){this.past.push(clone(project));if(this.past.length>this.limit)this.past.shift();this.future=[];}
  undo(project){if(!this.past.length)return project;this.future.push(clone(project));return this.past.pop();}
  redo(project){if(!this.future.length)return project;this.past.push(clone(project));return this.future.pop();}
}
