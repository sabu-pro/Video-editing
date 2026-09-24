import test from 'node:test';
import assert from 'node:assert/strict';
import {NoiseRemoverDSP,DEFAULT_NOISE_REMOVAL} from '../src/noise-removal.js';
import {createClip,createProject,validateProject,History} from '../src/core.js';
import {separateAudio} from '../src/editing.js';
import {EFFECT_CATALOG,EFFECT_GROUPS,matchingEffects} from '../src/effects-catalog.js';

const rate=48000;
const tone=(frequency,level=.1,seconds=2)=>Float32Array.from({length:rate*seconds},(_,i)=>level*Math.sin(2*Math.PI*frequency*i/rate));
const rms=(a,start=rate)=>Math.sqrt(a.subarray(start).reduce((sum,x)=>sum+x*x,0)/(a.length-start));
const noise=(level=.12,seconds=3)=>{let seed=123;return Float32Array.from({length:rate*seconds},()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return (seed/2147483648-1)*level;});};
function process(input,settings,dsp=new NoiseRemoverDSP(rate)){
  const output=input.map(a=>new Float32Array(a.length));dsp.process(input,output,settings);return output;
}

test('low-level background attenuates while speech-band foreground remains',()=>{
  const quiet=tone(900,.002),voice=tone(900,.3);
  assert.ok(rms(process([quiet],{amount:100})[0])/rms(quiet)<.12);
  assert.ok(rms(process([voice],{amount:100,mode:1})[0])/rms(voice)>.95);
  const halfway=rms(process([quiet],{amount:50})[0]);assert.ok(halfway<rms(quiet)*.6&&halfway>rms(quiet)*.45);
});
test('continuous broadband noise is reduced even above the fixed gate threshold',()=>{
  for(const level of [.002,.04,.12,.4])for(const mode of [0,1]){
    const input=noise(level),output=process([input],{amount:100,mode})[0];
    const attenuation=20*Math.log10(rms(input)/rms(output));
    assert.ok(attenuation>8,`mode ${mode}, noise peak ${level}: only ${attenuation.toFixed(2)} dB attenuation`);
    assert.deepEqual(process([input],{amount:0,mode})[0],input);
    assert.deepEqual(process([input],{amount:100,mode,bypass:true})[0],input);
  }
});
test('Voice reduces hiss under voiced harmonics without merely turning the whole signal down',()=>{
  const hiss=noise(.06),frequencies=[220,440,880],amplitudes=[.2,.08,.04];
  const input=Float32Array.from(hiss,(n,i)=>n+frequencies.reduce((sum,f,j)=>sum+amplitudes[j]*Math.sin(2*Math.PI*f*i/rate),0));
  const output=process([input],{amount:100,mode:1})[0];
  const components=data=>{
    let signalPower=0;
    for(const frequency of frequencies){let real=0,imaginary=0;for(let i=rate;i<data.length;i++){real+=data[i]*Math.cos(2*Math.PI*frequency*i/rate);imaginary+=data[i]*Math.sin(2*Math.PI*frequency*i/rate);}signalPower+=2*(real*real+imaginary*imaginary)/(data.length-rate)**2;}
    return {signal:Math.sqrt(signalPower),noise:Math.sqrt(Math.max(0,rms(data)**2-signalPower))};
  };
  const before=components(input),after=components(output);
  assert.ok(after.signal/before.signal>.85,'preserve voiced content');
  assert.ok(after.noise/before.noise<.65,'reduce noise during voiced content');
  assert.ok((after.signal/after.noise)/(before.signal/before.noise)>1.4,'improve SNR, not just volume');
});
test('worklet-sized blocks, mode and amount changes stay finite and smoothly reach dry',()=>{
  const input=noise(.12,3),dsp=new NoiseRemoverDSP(rate),output=new Float32Array(input.length);
  for(let i=0;i<input.length;i+=128){const end=Math.min(i+128,input.length);dsp.process([input.subarray(i,end)],[output.subarray(i,end)],{amount:i<rate?100:0,mode:i<rate/2?0:1});}
  assert.ok(output.every(Number.isFinite));assert.deepEqual(output.subarray(rate*2),input.subarray(rate*2));
  const toneInput=tone(1000,.3,3),continuous=new NoiseRemoverDSP(rate),toneOutput=new Float32Array(toneInput.length);
  for(let i=0;i<toneInput.length;i+=128){const end=Math.min(i+128,toneInput.length);continuous.process([toneInput.subarray(i,end)],[toneOutput.subarray(i,end)],{amount:i<rate?100:0,mode:i<rate/2?0:1});}
  let maxJump=0;for(let i=1;i<toneOutput.length;i++)maxJump=Math.max(maxJump,Math.abs(toneOutput[i]-toneOutput[i-1]));
  assert.ok(maxJump<.05,`no discontinuities on parameter changes: ${maxJump}`);
});
test('both hum modes reject the fundamental and harmonic while retaining speech',()=>{
  for(const [mode,frequency] of [[2,50],[3,60]]){
    for(const f of [frequency,frequency*2]){const input=tone(f);assert.ok(rms(process([input],{amount:100,mode})[0])/rms(input)<.02);}
    const voice=tone(1000);assert.ok(rms(process([voice],{amount:100,mode})[0])/rms(voice)>.95);
  }
});
test('high-pass suppresses rumble and stereo keeps separate L/R with linked gain',()=>{
  const rumble=tone(10);assert.ok(rms(process([rumble],{amount:100,mode:1})[0])/rms(rumble)<.13);
  const left=tone(700,.2),right=Float32Array.from(left,x=>-x*.2),[l,r]=process([left,right],{amount:100});
  for(let i=rate;i<l.length;i+=31)assert.ok(Math.abs(r[i]+l[i]*.2)<1e-7);
  const silent=new Float32Array(left.length),isolated=process([left,silent],{amount:100,mode:2});assert.equal(rms(isolated[1]),0);
});
test('zero amount and settled bypass are exact dry, with smooth transitions and finite silence',()=>{
  const input=tone(60),dsp=new NoiseRemoverDSP(rate);
  assert.deepEqual(process([input],{amount:0},dsp)[0],input);
  process([input],{amount:100,mode:3},dsp);
  const bypass=process([input],{amount:100,mode:3,bypass:true},dsp)[0];
  assert.deepEqual(bypass.subarray(rate),input.subarray(rate));
  let jump=0;for(let i=1;i<rate/4;i++)jump=Math.max(jump,Math.abs(bypass[i]-bypass[i-1]));assert.ok(jump<.002);
  const silence=process([new Float32Array(rate*2)],{amount:100},dsp)[0];assert.ok(silence.every(Number.isFinite));assert.ok(rms(silence)<1e-6);
});
test('noise settings survive project serialization, history, and detaching embedded audio',()=>{
  const p=createProject(),clip=createClip({id:'source',type:'video',name:'Embedded',duration:2},'v1');p.clips=[clip];
  const history=new History();history.push(p);clip.noiseRemoval={...DEFAULT_NOISE_REMOVAL,amount:78,mode:'60 Hz Hum',bypass:true};
  const restored=validateProject(JSON.parse(JSON.stringify(p)));assert.deepEqual(restored.clips[0].noiseRemoval,clip.noiseRemoval);
  const before=history.undo(p);assert.equal(before.clips[0].noiseRemoval,undefined);assert.deepEqual(history.redo(before).clips[0].noiseRemoval,clip.noiseRemoval);
  separateAudio(p,[clip.id],'a1');const detached=p.clips.find(c=>c.type==='audio');assert.deepEqual(detached.noiseRemoval,clip.noiseRemoval);assert.notEqual(detached.noiseRemoval,clip.noiseRemoval);
  for(const bad of [{amount:101},{amount:NaN},{mode:'AI'},{bypass:1}]){const invalid=structuredClone(p);Object.assign(invalid.clips[0].noiseRemoval,bad);assert.throws(()=>validateProject(invalid),/noise removal/);}
  delete clip.noiseRemoval;assert.equal(validateProject(p).clips[0].noiseRemoval,undefined);
});
test('catalog only lists implemented effects, preserves existing IDs and searches folders',()=>{
  assert.equal(new Set(EFFECT_CATALOG.map(e=>e.name)).size,EFFECT_CATALOG.length);
  assert.ok(EFFECT_CATALOG.every(e=>e.values||e.processor==='noiseRemoval'));
  assert.equal(EFFECT_GROUPS.length,6);
  assert.ok(matchingEffects(['Presets'],'cinematic').some(e=>e.name==='Cinematic'));
  assert.equal(matchingEffects(['Video Effects','Keying']).length,0);
  assert.deepEqual(matchingEffects(['Audio Effects'],'restoration').map(e=>e.name),['Background Noise Remover']);
  assert.equal(matchingEffects(['Favorites'],'',['Background Noise Remover']).length,1);
});
