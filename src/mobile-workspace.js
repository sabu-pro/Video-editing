// Adaptive presentation and touch gestures only. Editing remains in app.js.
export function createMobileWorkspace(hooks){
  const $=s=>document.querySelector(s),media=matchMedia('(max-width: 900px)');
  const library=$('.library'),inspector=$('.inspector'),homes=new Map();
  for(const panel of [library,inspector]){const home=document.createComment('panel home');panel.before(home);homes.set(panel,home);}
  const button=(action,label)=>`<button data-mobile-action="${action}">${label}</button>`;
  const toolbar=document.createElement('div');toolbar.className='mobile-only mobile-editbar';toolbar.setAttribute('aria-label','Touch editing');
  toolbar.innerHTML=button('undo','Undo')+button('redo','Redo')+button('split','Split')+button('delete','Delete')+button('play','Play');$('.monitor').after(toolbar);
  const nav=document.createElement('nav');nav.className='mobile-only mobile-nav';nav.setAttribute('aria-label','Mobile workspace');nav.innerHTML=['Media','Audio','Text','Effects','More'].map(name=>`<button data-mobile-sheet="${name.toLowerCase()}" aria-expanded="false">${name}</button>`).join('');$('#app').append(nav);
  const backdrop=document.createElement('div');backdrop.id='mobile-backdrop';backdrop.className='mobile-only';backdrop.hidden=true;document.body.append(backdrop);
  const sheet=document.createElement('section');sheet.id='mobile-sheet';sheet.className='mobile-only';sheet.hidden=true;sheet.setAttribute('role','dialog');sheet.setAttribute('aria-modal','true');sheet.setAttribute('aria-labelledby','mobile-sheet-title');
  sheet.innerHTML='<header><h2 id="mobile-sheet-title"></h2><button data-mobile-add>Add effect</button><button data-mobile-close aria-label="Close workspace sheet">Close</button></header><div id="mobile-sheet-body"></div>';document.body.append(sheet);
  const body=$('#mobile-sheet-body');let current=null,focusBefore=null;
  const api={get active(){return media.matches;},get audioOnly(){return current==='audio';},shows(kind){return !media.matches||(kind==='library'?['media','audio','text','catalog'].includes(current):current==='effects');},open,close,update};
  function restore(){for(const [panel,home]of homes)home.after(panel);body.replaceChildren();}
  function close(focus=true){restore();current=null;sheet.hidden=backdrop.hidden=true;$('.editor').inert=false;$('.topbar').inert=false;nav.inert=false;for(const b of nav.querySelectorAll('button'))b.setAttribute('aria-expanded','false');if(focus&&focusBefore?.isConnected)focusBefore.focus({preventScroll:true});}
  function open(name){
    if(!media.matches)return;
    if(!current)focusBefore=document.activeElement;
    restore();current=name;sheet.hidden=backdrop.hidden=false;
    $('#mobile-sheet-title').textContent=({catalog:'Add effects',effects:'Effect Controls',audio:'Audio',text:'Text',media:'Media',more:'More'})[name];
    $('[data-mobile-add]').hidden=name!=='effects';
    if(name==='effects'){body.append(inspector);hooks.inspector();}
    else if(name==='more')body.innerHTML='<div class="mobile-more">'+[['import','Import media'],['new','New project'],['open','Open project'],['save','Save project'],['export','Export video'],['timeline-fit','Fit timeline'],['snapping','Toggle snapping'],['mobile-pan','Pan / select tool'],['add-track','Add track'],['sequence-settings','Sequence settings'],['detach-audio','Detach audio']].map(([a,l])=>button(a,l)).join('')+'</div><p class="mobile-help">Drag clips to move; drag edges to trim. Swipe empty lanes to scroll, or use Pan over clips. Pinch the timeline to zoom. Export stays at your chosen quality; keep this tab visible. Audio processing requires HTTPS or forwarded localhost. Codec support and available memory vary by browser.</p>';
    else {body.append(library);hooks.library(name==='catalog'?'effects':name==='text'?'titles':'media');}
    $('.editor').inert=true;$('.topbar').inert=true;nav.inert=true;
    for(const b of nav.querySelectorAll('button'))b.setAttribute('aria-expanded',String(b.dataset.mobileSheet===name));
    $('[data-mobile-close]').focus({preventScroll:true});
  }
  function update(state){
    toolbar.querySelector('[data-mobile-action="undo"]').disabled=!state.undo;
    toolbar.querySelector('[data-mobile-action="redo"]').disabled=!state.redo;
    toolbar.querySelector('[data-mobile-action="play"]').textContent=state.playing?'Pause':'Play';
    toolbar.querySelector('[data-mobile-action="play"]').setAttribute('aria-pressed',String(state.playing));
  }
  backdrop.addEventListener('click',()=>close());
  document.addEventListener('click',async e=>{
    if(!media.matches)return;
    const b=e.target.closest('button');
    if(b?.dataset.mobileSheet){open(b.dataset.mobileSheet);return;}
    if(b?.hasAttribute('data-mobile-close')){close();return;}
    if(b?.hasAttribute('data-mobile-add')){open('catalog');return;}
    if(b?.dataset.mobileAction){const action=b.dataset.mobileAction;if(current)close(false);await hooks.action(action);return;}
    const asset=e.target.closest('[data-asset]');if(asset){close(false);hooks.previewAsset(asset.dataset.asset);}
    else if(b?.dataset.preset||b?.dataset.title){open('effects');}
  });
  document.addEventListener('keydown',e=>{
    if(!current)return;
    if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();close();}
    if(e.key==='Tab'){const nodes=[...sheet.querySelectorAll('button,input,select,textarea,[tabindex="0"],summary')].filter(el=>!el.disabled&&el.getClientRects().length);const first=nodes[0],last=nodes.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}
  },true);

  const content=$('#timeline-content'),scroller=$('#timeline-scroll'),viewport=$('#track-viewport'),points=new Map();
  let gesture=null,hold=null,suppressUntil=0,pinchFrame=0;
  const clearHold=()=>{clearTimeout(hold);hold=null;};
  const distance=()=>{const [a,b]=[...points.values()];return Math.hypot(a.x-b.x,a.y-b.y);};
  content.addEventListener('pointerdown',e=>{
    if(!media.matches||e.pointerType!=='touch'||hooks.busy())return;
    points.set(e.pointerId,{x:e.clientX,y:e.clientY});scroller.setPointerCapture(e.pointerId);
    if(points.size>=2){
      clearHold();hooks.cancelGesture();e.preventDefault();e.stopImmediatePropagation();
      const middle=[...points.values()].reduce((s,p)=>s+p.x,0)/points.size-scroller.getBoundingClientRect().left;
      gesture={kind:'pinch',distance:distance(),zoom:Number($('#timeline-zoom').value),middle,point:(scroller.scrollLeft+middle)/Number($('#timeline-zoom').value)};return;
    }
    const clip=e.target.closest('[data-clip]'),seek=e.target.closest('#ruler,#playhead,[data-marker]');
    gesture={kind:clip?'clip':seek?'seek':'scroll',x:e.clientX,y:e.clientY,left:scroller.scrollLeft,top:viewport.scrollTop,moved:false};
    if(gesture.kind==='scroll') {e.preventDefault();e.stopImmediatePropagation();}
    if(clip&&!e.target.closest('[data-edge]'))hold=setTimeout(()=>{hooks.cancelGesture();hooks.context(clip.dataset.clip,e.clientX,e.clientY);gesture=null;suppressUntil=Date.now()+700;},550);
  },true);
  document.addEventListener('pointermove',e=>{
    if(!points.has(e.pointerId)||!gesture)return;points.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(gesture.kind==='pinch'){
      e.preventDefault();e.stopImmediatePropagation();if(points.size<2)return;
      if(!pinchFrame)pinchFrame=requestAnimationFrame(()=>{pinchFrame=0;if(gesture?.kind==='pinch'&&points.size>=2){hooks.zoom(gesture.zoom*distance()/Math.max(1,gesture.distance));scroller.scrollLeft=gesture.point*Number($('#timeline-zoom').value)-gesture.middle;}});return;
    }
    if(Math.hypot(e.clientX-gesture.x,e.clientY-gesture.y)>8){gesture.moved=true;clearHold();}
    if(gesture.kind==='scroll'){e.preventDefault();e.stopImmediatePropagation();scroller.scrollLeft=gesture.left-(e.clientX-gesture.x);viewport.scrollTop=gesture.top-(e.clientY-gesture.y);}
  },{capture:true,passive:false});
  function end(e){
    if(!points.has(e.pointerId))return;points.delete(e.pointerId);clearHold();
    if(e.type==='pointercancel')hooks.cancelGesture();
    if(gesture?.kind==='scroll'){if(!gesture.moved&&e.type!=='pointercancel')hooks.seek(e.clientX);e.stopImmediatePropagation();}
    if(gesture?.kind==='pinch'){e.stopImmediatePropagation();suppressUntil=Date.now()+500;}
    if(!points.size){gesture=null;cancelAnimationFrame(pinchFrame);pinchFrame=0;}
  }
  document.addEventListener('pointerup',end,true);document.addEventListener('pointercancel',end,true);
  document.addEventListener('click',e=>{if(media.matches&&Date.now()<suppressUntil){e.preventDefault();e.stopImmediatePropagation();}},true);
  function resize(){clearHold();hooks.cancelGesture();points.clear();gesture=null;close(false);document.documentElement.classList.toggle('mobile-workspace',media.matches);hooks.refresh();}
  media.addEventListener('change',resize);document.documentElement.classList.toggle('mobile-workspace',media.matches);
  return api;
}
