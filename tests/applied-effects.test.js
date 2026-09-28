import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject,createClip,History,DEFAULT_EFFECTS,APPLIED_EFFECTS,appliedEffects,markAppliedEffects,manageAppliedEffect,effectValue,validateProject} from '../src/core.js';
import {VoiceIsolationCache} from '../src/voice-isolation.js';
import {voiceKey} from '../src/voice-isolation-config.js';
import {audioCompanion} from '../src/editing.js';

test('every standard parameter belongs to exactly one independently removable group',()=>{
  const props=APPLIED_EFFECTS.flatMap(e=>e.props);assert.equal(new Set(props).size,props.length);assert.deepEqual(props.sort(),Object.keys(DEFAULT_EFFECTS).sort());
  for(const group of APPLIED_EFFECTS){
    const p=createProject(),c=createClip({id:'x',type:'video',duration:3},'v1');p.clips=[c];
    for(const prop of Object.keys(c.effects)){c.effects[prop]++;c.keyframes[prop]=[{time:0,value:c.effects[prop]}];}
    c.voiceIsolation={strength:42,bypass:true};c.noiseRemoval={amount:30,mode:'General',bypass:false};
    const before=structuredClone(c),history=new History();history.push(p);
    manageAppliedEffect(c,group.id,'bypass');
    for(const prop of group.props){assert.equal(effectValue(c,prop,0),DEFAULT_EFFECTS[prop]);assert.deepEqual(c.keyframes[prop],before.keyframes[prop]);}
    manageAppliedEffect(c,group.id,'remove');assert.ok(!appliedEffects(c).some(e=>e.id===group.id));
    for(const prop of Object.keys(c.effects))if(!group.props.includes(prop)){assert.equal(c.effects[prop],before.effects[prop]);assert.deepEqual(c.keyframes[prop],before.keyframes[prop]);}
    assert.deepEqual(c.voiceIsolation,before.voiceIsolation);assert.deepEqual(c.noiseRemoval,before.noiseRemoval);
    const restored=history.undo(p);assert.deepEqual(restored.clips[0],before);assert.ok(!appliedEffects(history.redo(restored).clips[0]).some(e=>e.id===group.id));
  }
});
test('default-valued applied effects and reset persist, and legacy values/keys are inferred',()=>{
  const p=createProject(),c=createClip({id:'x',type:'audio',duration:2},'a1');p.clips=[c];
  assert.equal(appliedEffects(c).length,0);markAppliedEffects(c,['volume']);c.effects.volume=35;c.keyframes.volume=[{time:0,value:35}];
  manageAppliedEffect(c,'volume','reset');assert.equal(c.effects.volume,100);assert.equal(c.keyframes.volume,undefined);
  assert.deepEqual(appliedEffects(validateProject(JSON.parse(JSON.stringify(p))).clips[0]).map(e=>e.id),['volume']);
  delete c.appliedEffects;c.keyframes.volume=[{time:0,value:100}];assert.deepEqual(appliedEffects(c).map(e=>e.id),['volume']);
  c.appliedEffects=['fake'];assert.throws(()=>validateProject(p),/applied effects/);
});
test('linked video and detached audio list only the effects their stream processes',()=>{
  const video=createClip({id:'v',type:'video',duration:2},'v1');markAppliedEffects(video,['blur','volume']);
  video.effects.blur=4;video.effects.volume=45;const audio=audioCompanion(video,'a1');
  assert.deepEqual(appliedEffects(video).map(e=>e.id),['blur']);assert.deepEqual(appliedEffects(audio).map(e=>e.id),['volume']);
});
test('Voice Isolation cleanup retains shared/bypassed results, cancels orphan work and revokes unreferenced URLs',async()=>{
  const cache=new VoiceIsolationCache(),clip={assetId:'x',sourceIn:0,duration:1,speed:1,voiceIsolation:{strength:0,bypass:true}},key=voiceKey(clip);
  const url=URL.createObjectURL(new Blob(['audio']));let cancelled=false;const entry={url,refs:0,cancel:()=>cancelled=true};cache.entries.set(key,entry);
  cache.retain([{...clip,id:'other'}]);assert.equal(cache.entries.get(key),entry);assert.equal(await(await fetch(url)).text(),'audio');
  cache.retain([]);assert.equal(cache.entries.size,0);assert.equal(entry.retired,true);assert.equal(cancelled,true);await assert.rejects(fetch(url));
});
