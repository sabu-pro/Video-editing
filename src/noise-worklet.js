import {NoiseRemoverDSP} from './noise-removal.js';

class NoiseRemovalProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors(){return [
    {name:'amount',defaultValue:50,minValue:0,maxValue:100,automationRate:'k-rate'},
    {name:'mode',defaultValue:0,minValue:0,maxValue:3,automationRate:'k-rate'},
    {name:'bypass',defaultValue:1,minValue:0,maxValue:1,automationRate:'k-rate'}
  ];}
  constructor(){super();this.dsp=new NoiseRemoverDSP(sampleRate);this.running=true;this.port.onmessage=event=>{if(event.data==='dispose')this.running=false;};}
  process(inputs,outputs,parameters){
    this.dsp.process(inputs[0],outputs[0],{amount:parameters.amount[0],mode:Math.round(parameters.mode[0]),bypass:parameters.bypass[0]>=.5});
    return this.running;
  }
}
registerProcessor('cutline-noise-removal',NoiseRemovalProcessor);
