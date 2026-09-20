export const amplitudeToDb = amplitude => amplitude>0?Math.max(-60,20*Math.log10(amplitude)):-60;
export const dbToPercent = db => Math.max(0,Math.min(100,(db+60)/60*100));
export function samplePeak(samples){let peak=0;for(let i=0;i<samples.length;i++)peak=Math.max(peak,Math.abs(samples[i]));return peak;}
export function channelPeaks(channels){
  const peaks=channels.slice(0,2).map(samplePeak);
  if(peaks.length===1)return [peaks[0],peaks[0]];
  return [peaks[0]||0,peaks[1]||0];
}
export class MeterBallistics {
  constructor(){this.channels=[0,1].map(()=>({db:-60,hold:-60,holdUntil:0,clipUntil:0}));this.last=null;}
  update(peaks,now){
    peaks=channelPeaks(peaks.map(value=>[value]));
    const dt=this.last===null?0:Math.max(0,now-this.last);this.last=now;
    for(let i=0;i<2;i++){
      const c=this.channels[i],raw=amplitudeToDb(peaks[i]||0);
      c.db=Math.max(raw,c.db-24*dt);
      if(raw>=c.hold){c.hold=raw;c.holdUntil=now+1.5;}else if(now>c.holdUntil)c.hold=Math.max(raw,c.hold-12*dt);
      if((peaks[i]||0)>=.999)c.clipUntil=now+2;
      c.clipping=now<c.clipUntil;
    }
    return this.channels;
  }
}
