export const DEFAULT_VOICE_ISOLATION=Object.freeze({strength:100,bypass:false});
export const VOICE_SAMPLE_RATE=48000;
export const VOICE_DELAY=1440; // (960 FFT - 480 hop) + 2 lookahead hops, DF3 config.
export const MAX_VOICE_SECONDS=180;
export const VOICE_ASSETS=Object.freeze({
  wasm:new URL('../assets/voice-isolation/df_bg.wasm',import.meta.url).href,
  model:new URL('../assets/voice-isolation/DeepFilterNet3_onnx.tar.gz',import.meta.url).href,
  worker:new URL('./voice-isolation-worker.js',import.meta.url).href
});
export function validateVoiceIsolation(value){
  if(!value||!Number.isFinite(value.strength)||value.strength<0||value.strength>100||typeof value.bypass!=='boolean')throw new Error('Invalid Voice Isolation settings.');
  return {strength:value.strength,bypass:value.bypass};
}
export const voiceMix=settings=>settings&&!settings.bypass?Math.max(0,Math.min(100,settings.strength))/100:0;
export function voiceRange(clip){return {start:Math.round(clip.sourceIn*VOICE_SAMPLE_RATE),length:Math.max(1,Math.round(clip.duration*clip.speed*VOICE_SAMPLE_RATE))};}
export function voiceKey(clip){const r=voiceRange(clip);return `${clip.assetId}:${r.start}:${r.length}`;}

// One four-channel stream carries dry L/R and aligned isolated L/R. Both sides
// share the same media clock and pitch-preserving speed changes, avoiding combing
// from independently scheduled media elements at intermediate Strength values.
export function voiceWave(dry,wet){
  const frames=dry[0].length,buffer=new ArrayBuffer(44+frames*16),view=new DataView(buffer);
  const text=(offset,s)=>[...s].forEach((c,i)=>view.setUint8(offset+i,c.charCodeAt(0)));
  text(0,'RIFF');view.setUint32(4,buffer.byteLength-8,true);text(8,'WAVEfmt ');view.setUint32(16,16,true);
  view.setUint16(20,3,true);view.setUint16(22,4,true);view.setUint32(24,VOICE_SAMPLE_RATE,true);view.setUint32(28,VOICE_SAMPLE_RATE*16,true);
  view.setUint16(32,16,true);view.setUint16(34,32,true);text(36,'data');view.setUint32(40,frames*16,true);
  const channels=[dry[0],dry[1]||dry[0],wet[0],wet[1]||wet[0]];
  for(let i=0;i<frames;i++)for(let ch=0;ch<4;ch++)view.setFloat32(44+i*16+ch*4,channels[ch][i],true);
  return buffer;
}
