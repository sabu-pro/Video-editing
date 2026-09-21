import { clamp, effectValue as animatedValue } from './core.js';
import { samplePeak } from './audio-meter.js';
import { prepareAudioEffects, ClipAudioEffects } from './audio-effects.js';
export { analyzeMedia as readAsset } from './media-info.js';

export class MediaEngine {
  constructor(canvas, assets, getProject, onError=()=>{}) {
    this.canvas=canvas; this.ctx=canvas.getContext('2d',{alpha:false}); this.assets=assets; this.getProject=getProject;
    this.nodes=new Map();this.images=new Map();this.time=0;this.playing=false;this.masterVolume=0.8;this.onError=onError;this.reportedErrors=new Set();
  }
  report(asset,message){const key=`${asset?.id}:${message}`;if(this.reportedErrors.has(key))return;this.reportedErrors.add(key);this.onError(`${asset?.name||'Media'}: ${message}`);}
  async audioInit() {
    if(!this.audio) {
      this.audio=new AudioContext(); this.master=this.audio.createGain();this.master.gain.value=this.masterVolume;
      this.splitter=this.audio.createChannelSplitter(2);
      this.analysers=[0,1].map(i=>{const a=this.audio.createAnalyser();a.fftSize=2048;this.splitter.connect(a,i);return a;});
      this.meterBuffers=this.analysers.map(a=>new Float32Array(a.fftSize));
      this.destination=this.audio.createMediaStreamDestination();
      this.master.connect(this.splitter);this.master.connect(this.audio.destination);this.master.connect(this.destination);
    }
    this.audioEffectsReady??=prepareAudioEffects(this.audio).then(()=>{this.effectsReady=true;for(const node of this.nodes.values())this.connectAudio(node);}).catch(error=>{this.audioEffectsReady=null;throw error;});
    await this.audioEffectsReady;
    if(this.audio.state==='suspended') await this.audio.resume();
  }
  connectAudio(node) {
    if(node.source||!this.effectsReady) return;
    node.source=this.audio.createMediaElementSource(node.el);node.gain=this.audio.createGain();
    node.audioEffects=new ClipAudioEffects(this.audio);
    node.audioEffects.node.onprocessorerror=()=>{node.failed=true;node.gain.gain.value=0;this.onError('Audio effects processor failed. Reload the project before playing or exporting.');};
    node.source.connect(node.audioEffects.node);node.audioEffects.node.connect(node.gain);node.gain.connect(this.master);node.el.muted=false;
  }
  setVolume(value){this.masterVolume=value;if(this.master)this.master.gain.value=value;}
  getNode(clip) {
    const asset=this.assets.get(clip.assetId);
    if(!asset?.url) return null;
    if(clip.type==='image') {
      if(!this.images.has(asset.id)) {const img=new Image();img.onload=()=>this.render();img.onerror=()=>this.report(asset,'Image could not be decoded. Reimport the source file.');img.src=asset.url;this.images.set(asset.id,img);}
      return this.images.get(asset.id);
    }
    if(!['video','audio'].includes(clip.type)) return null;
    if(!this.nodes.has(clip.id)) {
      const el=document.createElement(clip.type==='audio'?'audio':'video');
      el.src=asset.url;el.preload='auto';el.playsInline=true;el.muted=true;
      el.addEventListener('seeked',()=>{const node=this.nodes.get(clip.id);const target=node?.pendingSeek;if(node)delete node.pendingSeek;if(target!==undefined&&Math.abs(el.currentTime-target)>.001){el.currentTime=target;return;}if(!this.playing)this.render();});
      el.addEventListener('error',()=>{const node=this.nodes.get(clip.id);if(node){node.failed=true;node.el.pause();if(node.gain)node.gain.gain.value=0;}this.report(asset,'Playback source is unavailable or its codec cannot be decoded. Reimport the source file.');});
      el.addEventListener('loadeddata',()=>{if(!this.playing)this.render();});
      const node={el,lastUsed:performance.now()};this.nodes.set(clip.id,node);this.connectAudio(node);
    }
    return this.nodes.get(clip.id);
  }
  async prepare(time=this.time) {
    await Promise.all(this.getProject().clips.filter(c=>c.start<=time+1&&c.start+c.duration>time).map(async clip=>{
      const node=this.getNode(clip);
      if(node instanceof HTMLImageElement) {try {await node.decode();}catch{}}
      else if(node?.el && node.el.readyState<2) await new Promise(resolve=>{
        const done=()=>{clearTimeout(timer);node.el.removeEventListener('loadeddata',done);node.el.removeEventListener('error',done);resolve();};
        const timer=setTimeout(done,5000);node.el.addEventListener('loadeddata',done,{once:true});node.el.addEventListener('error',done,{once:true});
      });
    }));
  }
  sync(time,playing) {
    this.time=time;this.playing=playing;
    const project=this.getProject();const used=new Set(),now=performance.now();
    const trackMap=new Map(project.tracks.map(t=>[t.id,t])),soloed=project.tracks.some(t=>t.solo);
    for(const clip of project.clips) {
      if(!['audio','video'].includes(clip.type)) continue;
      used.add(clip.id);
      const near=time>=clip.start-1&&time<clip.start+clip.duration;
      const node=near?this.getNode(clip):this.nodes.get(clip.id);if(!node||node.failed)continue;
      const track=trackMap.get(clip.track);
      const active=time>=clip.start&&time<clip.start+clip.duration;
      node.audioEffects?.update(clip.noiseRemoval);
      if(active) {
        const target=clip.sourceIn+(time-clip.start)*clip.speed;
        node.lastUsed=now;
        const tolerance=playing?Math.max(1.5/project.fps,.04):.001;
        if(Number.isFinite(node.el.duration)){const seek=clamp(target,0,Math.max(0,node.el.duration-.001));if(node.el.seeking)node.pendingSeek=seek;else {delete node.pendingSeek;if(Math.abs(node.el.currentTime-target)>tolerance)node.el.currentTime=seek;}}
        node.el.playbackRate=clamp(clip.speed*(this.playbackMultiplier||1),.0625,16);node.el.preservesPitch=true;
        const e=clip.effects,local=time-clip.start+(clip.envelopeOffset||0),span=clip.envelopeDuration??clip.duration;
        let gain=animatedValue(clip,'volume',time)/100;
        const fadeIn=animatedValue(clip,'audioFadeIn',time),fadeOut=animatedValue(clip,'audioFadeOut',time);
        if(fadeIn)gain*=clamp(local/fadeIn,0,1);
        if(fadeOut)gain*=clamp((span-local)/fadeOut,0,1);
        const muted=track?.muted||(soloed&&!track?.solo)||clip.audioRole==='video-only';
        if(node.gain)node.gain.gain.setTargetAtTime(muted?0:gain,this.audio.currentTime,0.005);
        if(playing&&node.el.paused&&!node.playPending&&!node.playFailed){node.playPending=true;node.el.play().catch(error=>{if(error.name!=='AbortError'){node.playFailed=true;this.report(this.assets.get(clip.assetId),`Playback failed: ${error.message}`);}}).finally(()=>node.playPending=false);}
        if(!playing)node.playFailed=false;
        if(!playing&&!node.el.paused)node.el.pause();
      } else {node.el.pause();if(node.gain)node.gain.gain.value=0;}
    }
    for(const [id,node] of this.nodes)if(!used.has(id)||(this.nodes.size>12&&node.el.paused&&now-node.lastUsed>5000)){node.el.pause();node.el.removeAttribute('src');node.el.load();node.source?.disconnect();node.audioEffects?.disconnect();node.gain?.disconnect();this.nodes.delete(id);}
    this.render();
  }
  pause(){this.playing=false;for(const n of this.nodes.values())n.el.pause();}
  render() {
    const p=this.getProject(),ctx=this.ctx,w=this.canvas.width,h=this.canvas.height;
    ctx.fillStyle='#07090c';ctx.fillRect(0,0,w,h);
    const trackOrder=p.tracks.filter(t=>t.type==='video').slice().reverse();
    for(const track of trackOrder) {
      if(track.hidden)continue;
      for(const c of p.clips.filter(c=>c.track===track.id&&this.time>=c.start&&this.time<c.start+c.duration)) this.drawClip(c,ctx,w,h);
    }
  }
  drawClip(c,ctx,w,h) {
    if(c.type!=='title'&&(animatedValue(c,'temperature',this.time)||animatedValue(c,'vignette',this.time))){
      this.effectLayer??=document.createElement('canvas');
      const layer=this.effectLayer;if(layer.width!==w||layer.height!==h){layer.width=w;layer.height=h;}
      const local=layer.getContext('2d');local.clearRect(0,0,w,h);this.drawClipContent(c,local,w,h,true);
      const offset=this.time-c.start+(c.envelopeOffset||0),span=c.envelopeDuration??c.duration;
      let alpha=clamp(animatedValue(c,'opacity',this.time)/100,0,1);
      const fadeIn=animatedValue(c,'fadeIn',this.time),fadeOut=animatedValue(c,'fadeOut',this.time);
      if(fadeIn)alpha*=clamp(offset/fadeIn,0,1);if(fadeOut)alpha*=clamp((span-offset)/fadeOut,0,1);
      ctx.save();ctx.globalAlpha=alpha;ctx.drawImage(layer,0,0);ctx.restore();return;
    }
    this.drawClipContent(c,ctx,w,h);
  }
  drawClipContent(c,ctx,w,h,isolated=false) {
    const v=prop=>animatedValue(c,prop,this.time), e=c.effects, local=this.time-c.start+(c.envelopeOffset||0),span=c.envelopeDuration??c.duration;
    let alpha=clamp(v('opacity')/100,0,1);
    if(v('fadeIn'))alpha*=clamp(local/v('fadeIn'),0,1);
    if(v('fadeOut'))alpha*=clamp((span-local)/v('fadeOut'),0,1);
    ctx.save();ctx.globalAlpha=isolated?1:alpha;
    ctx.translate(w/2+v('x')*w/100,h/2+v('y')*h/100);ctx.rotate(v('rotation')*Math.PI/180);ctx.scale(v('scale')/100,v('scale')/100);
    const cropL=v('cropLeft')/100*w,cropR=v('cropRight')/100*w,cropT=v('cropTop')/100*h,cropB=v('cropBottom')/100*h;
    ctx.beginPath();ctx.rect(-w/2+cropL,-h/2+cropT,Math.max(0,w-cropL-cropR),Math.max(0,h-cropT-cropB));ctx.clip();
    ctx.filter=`brightness(${2**v('exposure')}) contrast(${v('contrast')}%) saturate(${v('saturation')}%) grayscale(${v('grayscale')}%) blur(${v('blur')*w/1920}px)`;
    if(c.type==='title') {
      const style=c.title||{};const size=(style.fontSize||100)*w/1920;
      ctx.font=`${style.weight||600} ${size}px ${style.font||'Arial'}`;ctx.textAlign=style.align||'center';ctx.textBaseline='middle';
      const lines=(style.text||'Your title').split('\n');const lh=size*1.25;
      const x=style.align==='left'?-w*0.4:style.align==='right'?w*0.4:0;
      if(style.background){ctx.fillStyle=style.background;const bw=Math.max(...lines.map(line=>ctx.measureText(line).width))+size*0.8;ctx.fillRect(x-(style.align==='left'?size*0.4:style.align==='right'?bw-size*0.4:bw/2),-lines.length*lh/2,bw,lines.length*lh);}
      if(style.shadow!==false){ctx.shadowColor='#0008';ctx.shadowBlur=12*w/1920;ctx.shadowOffsetY=3;}
      ctx.fillStyle=style.color||'#ffffff';lines.forEach((line,i)=>ctx.fillText(line,x,(i-(lines.length-1)/2)*lh));
    } else if(c.type==='color') {ctx.fillStyle=c.color||'#151d30';ctx.fillRect(-w/2,-h/2,w,h);}
    else {
      const media=this.getNode(c),source=c.type==='video'?media?.el:media;
      const sw=source?.videoWidth||source?.naturalWidth,sh=source?.videoHeight||source?.naturalHeight;
      if(sw&&sh) {
        const ratio=c.fit==='contain'?Math.min(w/sw,h/sh):Math.max(w/sw,h/sh);
        ctx.drawImage(source,-sw*ratio/2,-sh*ratio/2,sw*ratio,sh*ratio);
      } else if(!this.assets.has(c.assetId)) {
        ctx.filter='none';ctx.fillStyle='#19202b';ctx.fillRect(-w/2,-h/2,w,h);ctx.fillStyle='#a6a8b9';ctx.font=`${28*w/1920}px Arial`;ctx.textAlign='center';ctx.fillText('Media offline · reimport the original file',0,0);
      }
    }
    ctx.filter='none';ctx.shadowColor='transparent';ctx.shadowBlur=0;ctx.shadowOffsetY=0;
    if(c.type!=='title') {
      const temp=v('temperature');
      if(temp){ctx.globalCompositeOperation='source-atop';ctx.fillStyle=temp>0?`rgba(255,140,45,${Math.abs(temp)*0.0022})`:`rgba(35,125,255,${Math.abs(temp)*0.0022})`;ctx.fillRect(-w/2,-h/2,w,h);ctx.globalCompositeOperation='source-over';}
      if(v('vignette')){ctx.globalCompositeOperation='source-atop';const g=ctx.createRadialGradient(0,0,h*.15,0,0,w*.65);g.addColorStop(0,'transparent');g.addColorStop(1,`rgba(0,0,0,${v('vignette')/100})`);ctx.fillStyle=g;ctx.fillRect(-w/2,-h/2,w,h);}
    }
    ctx.restore();
  }
  level() {
    if(!this.analysers||!this.playing)return [0,0];
    return this.analysers.map((a,i)=>{a.getFloatTimeDomainData(this.meterBuffers[i]);return samplePeak(this.meterBuffers[i]);});
  }
  reset(){this.pause();for(const node of this.nodes.values()){node.source?.disconnect();node.audioEffects?.disconnect();node.gain?.disconnect();node.el.removeAttribute('src');node.el.load();}this.nodes.clear();this.images.clear();}
}

export async function waveform(asset,audio) {
  if(!asset.blob||asset.hasAudio===false)return;
  if(asset.blob.size>256*1024*1024){asset.waveformStatus='File exceeds waveform decode budget';return;}
  try {
    const buffer=await audio.decodeAudioData(await asset.blob.arrayBuffer());const count=Math.min(12000,Math.max(160,Math.ceil(buffer.duration*80))),block=Math.ceil(buffer.length/count);
    asset.hasAudio=true;asset.channels=buffer.numberOfChannels;
    asset.peaks=Array.from({length:count},(_,i)=>{let peak=0;for(let channel=0;channel<Math.min(2,buffer.numberOfChannels);channel++){const data=buffer.getChannelData(channel);for(let j=i*block;j<Math.min((i+1)*block,data.length);j++)peak=Math.max(peak,Math.abs(data[j]));}return peak;});
    asset.waveformStatus='ready';
  } catch { asset.waveformStatus='Waveform decoder unavailable'; }
}
export function makeDemoAudio(seconds=24) {
  const sampleRate=22050,length=sampleRate*seconds,buffer=new ArrayBuffer(44+length*2),view=new DataView(buffer);
  const str=(offset,text)=>[...text].forEach((c,i)=>view.setUint8(offset+i,c.charCodeAt(0)));
  str(0,'RIFF');view.setUint32(4,36+length*2,true);str(8,'WAVE');str(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,sampleRate,true);view.setUint32(28,sampleRate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);str(36,'data');view.setUint32(40,length*2,true);
  const chords=[[130.81,164.81,196],[110,130.81,164.81],[87.31,110,130.81],[98,123.47,146.83]];
  for(let i=0;i<length;i++) {
    const t=i/sampleRate,chord=chords[Math.floor(t/6)%4],phase=t%6,env=Math.min(1,phase/1.2,(6-phase)/1.5)*Math.min(1,t/2,(seconds-t)/2);
    let value=chord.reduce((sum,f)=>sum+Math.sin(t*f*Math.PI*2)*.055+Math.sin(t*f*2*Math.PI*2)*.018,0)*Math.max(0,env);
    const beat=t%0.75;value+=Math.sin(t*chord[Math.floor(t/.75)%3]*4*Math.PI*2)*Math.exp(-beat*8)*.025*Math.min(1,(seconds-t)/2);
    view.setInt16(44+i*2,clamp(value,-1,1)*32767,true);
  }
  return new File([buffer],'Ambient horizon.wav',{type:'audio/wav'});
}

export async function openDatabase() {
  return new Promise((resolve,reject)=>{const req=indexedDB.open('cutline-studio',1);req.onupgradeneeded=()=>{req.result.createObjectStore('session');req.result.createObjectStore('assets',{keyPath:'id'});};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
}
export function dbRead(db,store,key) {return new Promise((resolve,reject)=>{const req=db.transaction(store).objectStore(store).get(key);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
export function dbAll(db,store) {return new Promise((resolve,reject)=>{const req=db.transaction(store).objectStore(store).getAll();req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
export function dbWrite(db,store,value,key) {return new Promise((resolve,reject)=>{const tx=db.transaction(store,'readwrite');tx.objectStore(store).put(value,key);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}
