import {VOICE_ASSETS,VOICE_SAMPLE_RATE,MAX_VOICE_SECONDS,voiceKey,voiceRange,voiceMix} from './voice-isolation-config.js';

let modelPromise;
export function loadVoiceModel(){
  if(!globalThis.isSecureContext||typeof Worker==='undefined'||typeof WebAssembly==='undefined')return Promise.reject(new Error('Voice Isolation needs a secure browser with WebAssembly and Workers.'));
  return modelPromise??=Promise.all([VOICE_ASSETS.wasm,VOICE_ASSETS.model].map(async url=>{
    const response=await fetch(url,{signal:AbortSignal.timeout(60000)});
    if(!response.ok)throw new Error(`Voice Isolation model download failed (${response.status}).`);
    return response.arrayBuffer();
  })).then(async([wasm,model])=>({module:await WebAssembly.compile(wasm),model})).catch(error=>{modelPromise=null;throw error;});
}

export class VoiceIsolationCache {
  constructor(notify=()=>{}){this.entries=new Map();this.notify=notify;this.queue=Promise.resolve();this.generation=0;this.worker=null;}
  status(clip){return this.entries.get(voiceKey(clip))?.status||'Not processed';}
  get(clip,asset){const entry=this.entries.get(voiceKey(clip));return entry?.blob===asset?.blob?entry:undefined;}
  ensure(clip,asset){
    const key=voiceKey(clip),existing=this.get(clip,asset);if(existing)return existing.promise;
    const entry={blob:asset?.blob,status:'Loading model…',refs:0};this.entries.set(key,entry);this.notify();
    const generation=this.generation,range=voiceRange(clip);
    const run=async()=>{
      if(generation!==this.generation||entry.retired)throw new Error('Voice Isolation cancelled.');
      if(!asset?.blob)throw new Error('Source media is unavailable. Reimport it to use Voice Isolation.');
      if(range.length/VOICE_SAMPLE_RATE>MAX_VOICE_SECONDS)throw new Error(`Voice Isolation supports up to ${MAX_VOICE_SECONDS/60} source minutes per clip. Split or trim this clip first.`);
      if((asset.duration||0)*VOICE_SAMPLE_RATE*8>192*1024*1024)throw new Error('Source media exceeds the browser decoding memory limit. Use a shorter source file.');
      const model=await loadVoiceModel();if(generation!==this.generation||entry.retired)throw new Error('Voice Isolation cancelled.');entry.status='Decoding audio…';this.notify();
      const decoder=new OfflineAudioContext(2,1,VOICE_SAMPLE_RATE);let decoded=await decoder.decodeAudioData(await asset.blob.arrayBuffer());
      if(decoded.numberOfChannels>2)throw new Error('Voice Isolation supports mono and stereo sources.');
      if(decoded.length*decoded.numberOfChannels*4>192*1024*1024)throw new Error('Decoded audio exceeds the Voice Isolation memory limit.');
      const start=Math.max(0,range.start-12000),skip=range.start-start;
      const channels=Array.from({length:decoded.numberOfChannels},(_,ch)=>{const a=new Float32Array(skip+range.length);a.set(decoded.getChannelData(ch).subarray(start,start+a.length));return a;});
      decoded=null;
      if(generation!==this.generation||entry.retired)throw new Error('Voice Isolation cancelled.');
      entry.status='Processing 0%';this.notify();
      const buffer=await new Promise((resolve,reject)=>{
        const worker=new Worker(VOICE_ASSETS.worker,{type:'module'});this.worker=worker;
        const timer=setTimeout(()=>finish(new Error('Voice Isolation timed out. Try a shorter clip.')),300000);
        const finish=(error,value)=>{clearTimeout(timer);worker.terminate();this.worker=null;this.cancelJob=null;entry.cancel=null;error?reject(error):resolve(value);};
        entry.cancel=this.cancelJob=()=>finish(new Error('Voice Isolation cancelled.'));
        worker.onerror=()=>finish(new Error('Voice Isolation Worker failed. Check browser support or available memory.'));
        worker.onmessage=({data})=>{if(data.type==='progress'){entry.status=`Processing ${Math.round(data.value*100)}%`;this.notify();}else if(data.type==='done')finish(null,data.buffer);else if(data.type==='error')finish(new Error(data.message));};
        try{worker.postMessage({...model,channels,skip,length:range.length},channels.map(c=>c.buffer));}catch(error){finish(error);}
      });
      if(generation!==this.generation||entry.retired)throw new Error('Voice Isolation cancelled.');
      entry.url=URL.createObjectURL(new Blob([buffer],{type:'audio/wav'}));entry.bytes=buffer.byteLength;entry.start=range.start/VOICE_SAMPLE_RATE;entry.status='Ready';this.notify();this.evict(key);return entry;
    };
    entry.promise=this.queue.then(run).catch(error=>{entry.status=`Error: ${error.message}`;entry.error=error;this.notify();throw error;});
    this.queue=entry.promise.catch(()=>{});return entry.promise;
  }
  evict(keep){let bytes=[...this.entries.values()].reduce((n,e)=>n+(e.bytes||0),0);for(const [key,e]of this.entries)if(bytes>160*1024*1024&&key!==keep&&!e.refs&&e.url){URL.revokeObjectURL(e.url);bytes-=e.bytes;this.entries.delete(key);}}
  retain(clips){
    const keep=new Set(clips.filter(c=>c.voiceIsolation&&c.audioRole!=='video-only').map(voiceKey));
    for(const [key,entry]of this.entries)if(!keep.has(key)){
      entry.retired=true;entry.cancel?.();if(entry.url&&!entry.refs)URL.revokeObjectURL(entry.url);this.entries.delete(key);
    }
  }
  retry(clip){const key=voiceKey(clip),entry=this.entries.get(key);if(entry?.error){entry.retired=true;if(entry.url&&!entry.refs)URL.revokeObjectURL(entry.url);this.entries.delete(key);}}
  clear(){this.generation++;this.cancelJob?.();for(const e of this.entries.values())if(e.url)URL.revokeObjectURL(e.url);this.entries.clear();this.queue=Promise.resolve();this.notify();}
}

export class VoiceIsolationPlayback {
  constructor(context,entry,output,onError){
    this.context=context;this.entry=entry;entry.refs++;
    this.el=document.createElement('audio');this.el.preload='auto';this.el.src=entry.url;this.el.preservesPitch=true;
    this.source=context.createMediaElementSource(this.el);this.split=context.createChannelSplitter(4);
    this.dry=context.createGain();this.wet=context.createGain();this.dry.gain.value=1;this.wet.gain.value=0;
    this.mergers=[context.createChannelMerger(2),context.createChannelMerger(2)];
    this.source.connect(this.split);
    for(let i=0;i<4;i++)this.split.connect(this.mergers[Math.floor(i/2)],i,i%2);
    this.mergers[0].connect(this.dry);this.mergers[1].connect(this.wet);this.dry.connect(output);this.wet.connect(output);
    this.el.onerror=()=>{this.error=new Error('Voice Isolation audio could not be decoded. Bypass or remove the effect.');onError(this.error.message);};
  }
  update(settings){const mix=voiceMix(settings);if(mix===this.mix)return;this.mix=mix;this.dry.gain.setTargetAtTime(1-mix,this.context.currentTime,.015);this.wet.gain.setTargetAtTime(mix,this.context.currentTime,.015);}
  sync(target,rate,playing){
    const el=this.el,position=Math.max(0,target-this.entry.start);
    if(!el.seeking&&Math.abs(el.currentTime-position)>(playing?.06:.001))el.currentTime=Math.min(position,Number.isFinite(el.duration)?Math.max(0,el.duration-.001):position);
    el.playbackRate=rate;
    if(playing&&el.paused&&!this.pending){this.pending=true;el.play().catch(error=>{if(error.name!=='AbortError')this.error=error;}).finally(()=>this.pending=false);}
    if(!playing)el.pause();
  }
  ready(){return this.el.readyState>=2?Promise.resolve():new Promise((resolve,reject)=>{const timer=setTimeout(()=>done(new Error('Voice Isolation audio loading timed out.')),10000);const done=error=>{clearTimeout(timer);this.el.removeEventListener('loadeddata',loaded);this.el.removeEventListener('error',failed);error?reject(error):resolve();};const loaded=()=>done(),failed=()=>done(new Error('Voice Isolation audio format is unsupported.'));this.el.addEventListener('loadeddata',loaded,{once:true});this.el.addEventListener('error',failed,{once:true});});}
  disconnect(){this.el.pause();this.el.onerror=null;this.el.removeAttribute('src');this.el.load();for(const n of [this.source,this.split,this.dry,this.wet,...this.mergers])n.disconnect();this.entry.refs--;if(this.entry.retired&&!this.entry.refs)URL.revokeObjectURL(this.entry.url);}
}
