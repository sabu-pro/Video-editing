import { clone, uid, clamp, DEFAULT_EFFECTS, splitClip, trimClip } from './core.js';
import { linkedIds, editableIds, unlinkClips } from './links.js';
import { quantize, toFrame, floorFrames } from './timing.js';

export function cutClips(project, ids, time){
  const frame=toFrame(time,project.fps),editable=editableIds(project,ids),rights=[],groups=new Map();
  for(const id of editable){
    const c=project.clips.find(c=>c.id===id);
    if(frame<=toFrame(c.start,project.fps)||frame>=toFrame(c.start+c.duration,project.fps))continue;
    const right=splitClip(project,id,frame/project.fps);
    if(right){if(c.linkId){if(!groups.has(c.linkId))groups.set(c.linkId,uid());right.linkId=groups.get(c.linkId);}rights.push(right.id);}
  }
  return rights;
}
export function moveClips(project,ids,delta){
  const selected=new Set(editableIds(project,ids)),clips=project.clips.filter(c=>selected.has(c.id));
  if(!clips.length)return false;
  delta=Math.max(quantize(delta,project.fps),-Math.min(...clips.map(c=>c.start)));
  for(const c of clips)c.start=quantize(c.start+delta,project.fps);
  return true;
}
export function trimLinked(project,id,edge,delta,assets,ripple=false){
  const ids=editableIds(project,[id]);if(!ids.includes(id))return false;
  const group=project.clips.filter(c=>ids.includes(c.id)),fps=project.fps;
  let min=-Infinity,max=Infinity;
  for(const c of group){
    const source=['audio','video'].includes(c.type)?assets.get(c.assetId)?.duration??Infinity:Infinity;
    if(edge==='left'){min=Math.max(min,-c.start,-c.sourceIn/c.speed);max=Math.min(max,c.duration-1/fps);}
    else {min=Math.max(min,1/fps-c.duration);max=Math.min(max,(source-c.sourceIn)/c.speed-c.duration);}
  }
  delta=clamp(quantize(delta,fps),Math.ceil(min*fps-1e-7)/fps,Math.floor(max*fps+1e-7)/fps);
  const tails=new Set();
  if(ripple){
    for(const c of group)for(const tail of project.clips)if(!ids.includes(tail.id)&&tail.track===c.track&&toFrame(tail.start,fps)>=toFrame(c.start+c.duration,fps))tails.add(tail.id);
    const all=linkedIds(project,[...tails]);if(editableIds(project,all).length!==all.length)return false;
    all.forEach(id=>tails.add(id));
  }
  for(const c of group){
    const oldStart=c.start;trimClip(c,edge,delta,Infinity,1/fps);
    if(ripple&&edge==='left')c.start=oldStart;
  }
  if(ripple)moveClips(project,[...tails],edge==='left'?-delta:delta);
  return true;
}
export function slipLinked(project,id,delta,assets){
  const ids=editableIds(project,[id]),clips=project.clips.filter(c=>ids.includes(c.id));if(!ids.includes(id))return false;
  const min=Math.max(...clips.map(c=>-c.sourceIn/c.speed));
  const max=Math.min(...clips.map(c=>((assets.get(c.assetId)?.duration??Infinity)-c.sourceIn)/c.speed-c.duration));
  delta=clamp(quantize(delta,project.fps),min,max);for(const c of clips)c.sourceIn=Math.max(0,c.sourceIn+delta*c.speed);return true;
}
export function changeSpeed(project,id,speed){
  const ids=editableIds(project,[id]);if(!ids.includes(id))return false;
  for(const c of project.clips.filter(c=>ids.includes(c.id))){
    const ratio=c.speed/speed;c.duration=Math.max(1,floorFrames(c.duration*ratio,project.fps))/project.fps;
    for(const prop of ['automationOffset','envelopeOffset','envelopeDuration'])if(c[prop]!==undefined)c[prop]*=ratio;
    for(const keys of Object.values(c.keyframes))for(const k of keys)k.time*=ratio;c.speed=speed;
  }
  return true;
}
export function audioCompanion(video,track){
  const audio={...clone(video),id:uid(),type:'audio',track,name:video.name+' · audio',effects:{...DEFAULT_EFFECTS},keyframes:{},audioRole:'source'};
  for(const prop of ['volume','audioFadeIn','audioFadeOut']){audio.effects[prop]=video.effects[prop];if(video.keyframes[prop])audio.keyframes[prop]=clone(video.keyframes[prop]);}
  video.audioRole='video-only';video.effects.volume=0;delete video.keyframes.volume;
  return audio;
}
export function separateAudio(project,ids,track){
  const eligible=new Set(editableIds(project,ids)),result=[];
  for(const video of project.clips.filter(c=>ids.includes(c.id)&&c.type==='video'&&eligible.has(c.id))){
    const linked=project.clips.find(c=>video.linkId&&c.linkId===video.linkId&&c.type==='audio');
    if(linked){unlinkClips(project,[video.id]);result.push(linked.id);}
    else if(video.audioRole!=='video-only'&&track&&!project.tracks.find(t=>t.id===track)?.locked){const audio=audioCompanion(video,track);delete audio.linkId;project.clips.push(audio);result.push(audio.id);}
  }
  return result;
}
