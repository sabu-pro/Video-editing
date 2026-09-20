import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject,createClip,animatedValue,changeKeyframe,keyframeTime,splitClip,setKeyframe,validateProject,History} from '../src/core.js';
function setup(){const p=createProject(),c=createClip({id:'a',type:'image',name:'Image',duration:4},'v1',10);c.keyframes.opacity=[{time:0,value:0},{time:4,value:100}];p.clips.push(c);return {p,c};}
test('linear and easing interpolate and survive a split without changing the curve',()=>{
  for(const [mode,value]of [['linear',25],['ease-in',6.25],['ease-out',43.75],['ease-in-out',12.5]]){
    const {p,c}=setup();changeKeyframe(p,c.id,'opacity',0,{interpolation:mode});assert.equal(animatedValue(c,'opacity',11),value);
    const expected=animatedValue(c,'opacity',13),right=splitClip(p,c.id,12);assert.equal(animatedValue(right,'opacity',13),expected);
    assert.equal(validateProject(JSON.parse(JSON.stringify(p))).clips[0].keyframes.opacity[0].interpolation,mode);
  }
});
test('keyframe time editing quantizes, rejects collisions, protects locks, and supports history',()=>{
  const {p,c}=setup(),h=new History();h.push(p);
  assert.ok(changeKeyframe(p,c.id,'opacity',0,{time:10.11}));assert.equal(keyframeTime(c,c.keyframes.opacity[0]),10.1);
  assert.equal(changeKeyframe(p,c.id,'opacity',0,{time:14}),false);
  p.tracks.find(t=>t.id==='v1').locked=true;assert.equal(changeKeyframe(p,c.id,'opacity',0,{remove:true}),false);
  p.tracks.find(t=>t.id==='v1').locked=false;assert.ok(changeKeyframe(p,c.id,'opacity',0,{remove:true}));assert.equal(c.keyframes.opacity.length,1);
  const undo=h.undo(p);assert.equal(undo.clips[0].keyframes.opacity.length,2);assert.equal(h.redo(undo).clips[0].keyframes.opacity.length,1);
});
test('adding automation after a fractional source-domain offset stays on the sequence grid',()=>{
  const {c}=setup();c.automationOffset=.019;setKeyframe(c,'scale',10.11,150,30);
  assert.ok(Math.abs(keyframeTime(c,c.keyframes.scale[0])-10.1)<1e-10);
});
