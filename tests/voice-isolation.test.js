import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createProject,createClip,validateProject,History} from '../src/core.js';
import {audioCompanion} from '../src/editing.js';
import {DEFAULT_VOICE_ISOLATION,VOICE_ASSETS,voiceMix,voiceKey,voiceWave,VOICE_DELAY} from '../src/voice-isolation-config.js';
import {EFFECT_CATALOG} from '../src/effects-catalog.js';

test('Voice Isolation settings persist, copy to detached audio and survive undo/redo',()=>{
  const p=createProject(),c=createClip({id:'asset',name:'Speech',type:'video',duration:3},'v1');p.clips=[c];const history=new History();history.push(p);
  c.voiceIsolation={...DEFAULT_VOICE_ISOLATION,strength:67,bypass:true};
  assert.deepEqual(validateProject(JSON.parse(JSON.stringify(p))).clips[0].voiceIsolation,c.voiceIsolation);
  const before=history.undo(p);assert.equal(before.clips[0].voiceIsolation,undefined);assert.equal(history.redo(before).clips[0].voiceIsolation.strength,67);
  const audio=audioCompanion(c,'a1');assert.deepEqual(audio.voiceIsolation,c.voiceIsolation);assert.notEqual(audio.voiceIsolation,c.voiceIsolation);
  for(const bad of [{strength:101},{strength:NaN},{bypass:1}]){const invalid=structuredClone(p);Object.assign(invalid.clips[0].voiceIsolation,bad);assert.throws(()=>validateProject(invalid),/Voice Isolation/);}
  assert.equal(EFFECT_CATALOG.find(e=>e.name==='Voice Isolation').processor,'voiceIsolation');
});
test('Strength and Bypass use dry/wet blend and do not invalidate the source cache',()=>{
  assert.equal(voiceMix(),0);assert.equal(voiceMix({strength:0,bypass:false}),0);assert.equal(voiceMix({strength:100,bypass:true}),0);assert.equal(voiceMix({strength:100,bypass:false}),1);assert.equal(voiceMix({strength:50,bypass:false}),.5);
  const c={assetId:'x',sourceIn:1,duration:3,speed:1};const key=voiceKey(c);c.voiceIsolation={strength:42,bypass:true};assert.equal(voiceKey(c),key);c.sourceIn=2;assert.notEqual(voiceKey(c),key);
});
test('four-channel cache keeps dry/isolated stereo samples aligned, and duplicates mono',()=>{
  const left=new Float32Array([.1,.2]),right=new Float32Array([-.3,.4]),wet=new Float32Array([.05,.1]);
  const data=new DataView(voiceWave([left,right],[wet,right]));assert.equal(data.getUint16(22,true),4);assert.equal(data.getUint32(24,true),48000);
  for(let i=0;i<2;i++)assert.deepEqual([0,1,2,3].map(ch=>data.getFloat32(44+i*16+ch*4,true)),[left[i],right[i],wet[i],right[i]]);
  const mono=new DataView(voiceWave([left],[wet]));assert.equal(mono.getFloat32(44,true),mono.getFloat32(48,true));assert.equal(VOICE_DELAY,1440);
});
test('vendored assets have pinned checksums, licenses and relocatable URLs',async()=>{
  const provenance=JSON.parse(await readFile(new URL('../assets/voice-isolation/provenance.json',import.meta.url)));
  for(const entry of provenance){const bytes=await readFile(new URL('../assets/voice-isolation/'+entry.file,import.meta.url));assert.equal(bytes.length,entry.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),entry.sha256);}
  for(const url of Object.values(VOICE_ASSETS)){assert.ok(!url.includes('localhost'));assert.ok(url.endsWith('.wasm')||url.endsWith('.tar.gz')||url.endsWith('-worker.js'));}
  assert.match(await readFile(new URL('../assets/voice-isolation/UPSTREAM-LICENSE-MIT.txt',import.meta.url),'utf8'),/Permission is hereby granted/);
});
