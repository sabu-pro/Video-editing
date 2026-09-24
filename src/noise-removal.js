// Serializable settings and a DSP-only processor, independent of Web Audio/UI.
// The worklet adapter can later host another denoiser without changing clip routing.
export const NOISE_MODES = ['General','Voice','50 Hz Hum','60 Hz Hum'];
export const DEFAULT_NOISE_REMOVAL = Object.freeze({amount:50,mode:'General',bypass:false});
export function validateNoiseRemoval(value){
  if(!value||!Number.isFinite(value.amount)||value.amount<0||value.amount>100||!NOISE_MODES.includes(value.mode)||typeof value.bypass!=='boolean')throw new Error('Invalid noise removal settings.');
  return {amount:value.amount,mode:value.mode,bypass:value.bypass};
}

class Notch {
  constructor(rate,frequency){
    const w=2*Math.PI*frequency/rate,a=Math.sin(w)/(2*8),d=1+a;
    this.b0=1/d;this.b1=-2*Math.cos(w)/d;this.b2=1/d;this.a1=this.b1;this.a2=(1-a)/d;
    this.z1=0;this.z2=0;
  }
  sample(x){const y=this.b0*x+this.z1;this.z1=this.b1*x-this.a1*y+this.z2;this.z2=this.b2*x-this.a2*y;return y;}
}

// A short adaptive predictor separates correlated waveform content from broadband
// noise. Unlike the level gate, it still works when steady hiss holds the gate open.
// Fit to INPUT history (never feedback output); regularize and smooth the fit.
class NoisePredictor {
  constructor(rate){
    this.average=1-Math.exp(-1/(rate*.05));this.smooth=1-Math.exp(-1/(rate*.025));
    this.moments=new Float64Array(5);this.previous=0;this.older=0;this.a=0;this.b=0;this.targetA=0;this.targetB=0;this.count=0;
  }
  sample(x,residual){
    const p=this.previous,q=this.older,m=this.moments,k=this.average;
    m[0]+=(p*p-m[0])*k;m[1]+=(q*q-m[1])*k;m[2]+=(p*q-m[2])*k;
    m[3]+=(x*p-m[3])*k;m[4]+=(x*q-m[4])*k;
    if(++this.count%64===0){
      const regularizer=(m[0]+m[1])*1e-6+1e-20,d0=m[0]+regularizer,d1=m[1]+regularizer,det=d0*d1-m[2]*m[2];
      this.targetA=Math.max(-2,Math.min(2,(m[3]*d1-m[4]*m[2])/det));
      this.targetB=Math.max(-1,Math.min(1,(m[4]*d0-m[3]*m[2])/det));
    }
    this.a+=(this.targetA-this.a)*this.smooth;this.b+=(this.targetB-this.b)*this.smooth;
    const predicted=this.a*p+this.b*q;
    this.older=p;this.previous=x;
    // Retain some unpredictable content, particularly unvoiced consonants in Voice.
    return predicted+(x-predicted)*residual;
  }
}

export class NoiseRemoverDSP {
  constructor(rate){
    this.rate=rate;this.smooth=1-Math.exp(-1/(rate*.025));
    this.attack=1-Math.exp(-1/(rate*.002));this.release=1-Math.exp(-1/(rate*.180));
    this.open=1-Math.exp(-1/(rate*.003));this.close=1-Math.exp(-1/(rate*.150));
    this.mix=0;this.voice=0;this.hum50=0;this.hum60=0;this.envelope=0;this.gain=1;
    this.channels=Array.from({length:2},()=>({low:0,notches:[50,100,60,120].map(f=>new Notch(rate,f)),predictor:new NoisePredictor(rate)}));
    this.wet=new Float64Array(2);
  }
  // Shared detector/gain retains stereo position; filters retain separate L/R state.
  // A soft knee, finite reduction floor and slow close avoid hard gate clicks/chatter.
  process(input,output,{amount=50,mode=0,bypass=0}={}){
    const targetAmount=Math.max(0,Math.min(100,amount))/100,targetMix=bypass?0:targetAmount;
    if(targetMix===0&&this.mix===0){
      for(let ch=0;ch<output.length;ch++){const dry=input[ch]||input[0];if(dry)output[ch].set(dry);else output[ch].fill(0);}
      return;
    }
    for(let i=0;i<output[0].length;i++){
      this.mix+=(targetMix-this.mix)*this.smooth;
      if(Math.abs(this.mix-targetMix)<1e-7)this.mix=targetMix;
      this.voice+=((mode===1?1:0)-this.voice)*this.smooth;
      this.hum50+=((mode===2?1:0)-this.hum50)*this.smooth;this.hum60+=((mode===3?1:0)-this.hum60)*this.smooth;
      const hp=1-Math.exp(-2*Math.PI*(35+50*this.voice)/this.rate);
      let peak=0;
      for(let ch=0;ch<output.length;ch++){
        const state=this.channels[ch],x=input[ch]?.[i]??input[0]?.[i]??0;
        state.low+=hp*(x-state.low);const high=x-state.low;
        const n=state.notches,h50=n[1].sample(n[0].sample(high)),h60=n[3].sample(n[2].sample(high));
        const wet=high+(h50-high)*this.hum50+(h60-high)*this.hum60;
        this.wet[ch]=state.predictor.sample(wet,.2+.1*this.voice);peak=Math.max(peak,Math.abs(wet));
      }
      this.envelope+=(peak-this.envelope)*(peak>this.envelope?this.attack:this.release);
      const level=20*Math.log10(Math.max(1e-9,this.envelope)),threshold=-38+6*this.voice;
      const below=threshold-level,knee=6;
      const reduction=below<=-knee/2?0:below>=knee/2?below:(below+knee/2)**2/(2*knee);
      const targetGain=10**(-Math.min(24,reduction*1.5)/20);
      this.gain+=(targetGain-this.gain)*(targetGain>this.gain?this.open:this.close);
      for(let ch=0;ch<output.length;ch++){
        const dry=input[ch]?.[i]??input[0]?.[i]??0;
        output[ch][i]=dry+this.mix*(this.wet[ch]*this.gain-dry);
      }
    }
  }
}
