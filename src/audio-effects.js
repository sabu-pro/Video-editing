import {DEFAULT_NOISE_REMOVAL,NOISE_MODES} from './noise-removal.js';

export async function prepareAudioEffects(context){
  await context.audioWorklet.addModule(new URL('./noise-worklet.js',import.meta.url));
}
export class ClipAudioEffects {
  constructor(context){
    this.context=context;
    // Explicit stereo output duplicates mono to both speakers, never folds stereo down.
    this.node=new AudioWorkletNode(context,'cutline-noise-removal',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2],channelCount:2,channelCountMode:'clamped-max',channelInterpretation:'speakers'});
    this.last={};
  }
  update(settings){
    const s=settings||DEFAULT_NOISE_REMOVAL;
    const values={amount:s.amount,mode:NOISE_MODES.indexOf(s.mode),bypass:!settings||s.bypass?1:0};
    for(const [key,value] of Object.entries(values))if(this.last[key]!==value){
      // Smoothing happens per sample inside the processor, including mode crossfades.
      this.node.parameters.get(key).setValueAtTime(value,this.context.currentTime);this.last[key]=value;
    }
  }
  disconnect(){this.node.port.postMessage('dispose');this.node.disconnect();this.node.port.close();}
}
