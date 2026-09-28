import {initSync,df_create,df_get_frame_length,df_process_frame} from '../assets/voice-isolation/df.js';
import {VOICE_DELAY,voiceWave} from './voice-isolation-config.js';

// Each job has its own WASM instance/state. Termination releases all Rust memory;
// the upstream raw-pointer API does not export a safe df_destroy function.
self.onmessage=({data})=>{
  try{
    initSync({module:data.module});
    const wet=[],dry=[],{channels,skip,length,model}=data;
    for(let ch=0;ch<channels.length;ch++){
      const input=channels[ch],handle=df_create(new Uint8Array(model),100),hop=df_get_frame_length(handle);
      if(hop!==480)throw new Error('Unexpected Voice Isolation model frame size.');
      const output=new Float32Array(length),frame=new Float32Array(hop),end=input.length+VOICE_DELAY;
      for(let offset=0;offset<end;offset+=hop){
        frame.fill(0);frame.set(input.subarray(offset,offset+hop));
        const processed=df_process_frame(handle,frame);
        for(let i=0;i<hop;i++){
          const index=offset+i-VOICE_DELAY-skip;
          if(index>=0&&index<length){if(!Number.isFinite(processed[i]))throw new Error('Model returned invalid audio.');output[index]=processed[i];}
        }
        if(offset%(hop*50)===0)self.postMessage({type:'progress',value:(ch+offset/end)/channels.length});
      }
      wet.push(output);dry.push(input.subarray(skip,skip+length));
    }
    const buffer=voiceWave(dry,wet);self.postMessage({type:'done',buffer},[buffer]);
  }catch(error){self.postMessage({type:'error',message:error.message||'Speech enhancement failed.'});}
};
