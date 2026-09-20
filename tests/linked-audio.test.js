import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, createClip, deleteClips, History, validateProject, animatedValue } from '../src/core.js';
import { linkedIds, linkClips, unlinkClips } from '../src/links.js';
import { audioCompanion, moveClips, cutClips, trimBounds, trimLinked, slipLinked, changeSpeed, separateAudio } from '../src/editing.js';
import { resolveSnap } from '../src/snapping.js';
import { amplitudeToDb, dbToPercent, MeterBallistics, samplePeak, channelPeaks } from '../src/audio-meter.js';
function setup(){const p=createProject(),asset={id:'media',type:'video',name:'AV',duration:20,hasAudio:true};const v=createClip(asset,'v1',2,{duration:8,sourceIn:1,linkId:'link'});const a=audioCompanion(v,'a1');p.clips.push(v,a);return {p,v,a,assets:new Map([[asset.id,asset]])};}
test('linked A/V uses one asset and matches source time through move, trim, slip, and speed',()=>{const {p,v,a,assets}=setup();assert.equal(v.assetId,a.assetId);assert.equal(v.audioRole,'video-only');moveClips(p,[v.id],.13);trimLinked(p,v.id,'left',.4,assets);slipLinked(p,a.id,.5,assets);changeSpeed(p,v.id,2);for(const prop of ['start','duration','sourceIn','speed'])assert.equal(v[prop],a[prop]);});
test('razor splits both streams, preserves effects and creates independent link groups',()=>{const {p,v,a}=setup();v.effects.rotation=25;v.keyframes.opacity=[{time:0,value:0},{time:8,value:100}];const rights=cutClips(p,[v.id],4);assert.equal(rights.length,2);const [vr,ar]=rights.map(id=>p.clips.find(c=>c.id===id));assert.equal(vr.linkId,ar.linkId);assert.notEqual(vr.linkId,v.linkId);assert.equal(vr.effects.rotation,25);assert.equal(vr.sourceIn,ar.sourceIn);assert.equal(animatedValue(vr,'opacity',6),50);assert.equal(v.duration,a.duration);});
test('locked linked partner blocks all timing edits, razor, deletion, and separation',()=>{const {p,v,assets}=setup();p.tracks.find(t=>t.id==='a1').locked=true;const original=structuredClone(p);moveClips(p,[v.id],1);trimLinked(p,v.id,'right',-1,assets);cutClips(p,[v.id],5);deleteClips(p,[v.id],true);separateAudio(p,[v.id],'a2');assert.deepEqual(p,original);});
test('unlink and separate audio are idempotent and do not duplicate sound',()=>{const {p,v,a}=setup();assert.deepEqual(separateAudio(p,[v.id],'a1'),[a.id]);assert.equal(p.clips.length,2);assert.equal(v.linkId,undefined);assert.deepEqual(separateAudio(p,[v.id],'a1'),[]);moveClips(p,[a.id],1);assert.notEqual(v.start,a.start);assert.equal(linkClips(p,[v.id,a.id]),true);assert.equal(linkedIds(p,[v.id]).length,2);});
test('ripple linked trims and deletes preserve downstream links',()=>{const {p,v,a,assets}=setup();const v2={...structuredClone(v),id:'v2',start:10,linkId:'next'},a2={...structuredClone(a),id:'a2',start:10,linkId:'next'};p.clips.push(v2,a2);trimLinked(p,v.id,'right',-2,assets,true);assert.equal(v2.start,8);assert.equal(a2.start,8);deleteClips(p,[v.id],true);assert.equal(v2.start,2);assert.equal(a2.start,2);});
test('linked edits survive history and project roundtrip',()=>{const {p,v}=setup(),h=new History();h.push(p);cutClips(p,[v.id],4);const saved=validateProject(JSON.parse(JSON.stringify(p)));assert.equal(saved.clips.length,4);let undo=h.undo(saved);assert.equal(undo.clips.length,2);assert.equal(h.redo(undo).clips.length,4);});
test('meter uses true channel sample peaks and logarithmic dBFS',()=>{assert.equal(samplePeak(new Float32Array([-.5,.2])),.5);assert.ok(Math.abs(amplitudeToDb(.5)+6.0206)<.001);assert.equal(amplitudeToDb(0),-60);assert.equal(dbToPercent(-12),80);const m=new MeterBallistics();let c=m.update([1,.1],0);assert.equal(c[0].db,0);assert.ok(c[0].clipping);assert.equal(c[1].db,-20);c=m.update([0,0],.1);assert.ok(c[0].db<0&&c[0].db>-3);assert.equal(c[0].hold,0);c=m.update([0,0],3);assert.ok(!c[0].clipping);assert.ok(c[0].hold<0);});
test('meter extracts independent stereo peaks and mirrors mono without inventing a level',()=>{assert.deepEqual(channelPeaks([new Float32Array([-.5,.2]),new Float32Array([.1,-.25])]),[.5,.25]);assert.deepEqual(channelPeaks([new Float32Array([-.5,.2])]),[.5,.5]);assert.deepEqual(channelPeaks([]),[0,0]);});

test('trim snapping excludes unavailable source frames and agrees with the resulting linked edit',()=>{
  const {p,v,a,assets}=setup();assets.get('media').duration=9.019;p.markers=[{time:10.1}];
  const bounds=trimBounds(p,v.id,'right',assets),base=v.start+v.duration;
  assert.equal(bounds.max,0);
  const snap=resolveSnap(p,{time:10.1,exclude:[v.id,a.id],zoom:40,min:base+bounds.min,max:base+bounds.max});
  assert.equal(snap.point,null);assert.equal(snap.time,10);
  trimLinked(p,v.id,'right',snap.time-base,assets);
  assert.equal(v.start+v.duration,snap.time);assert.equal(a.duration,v.duration);
});
test('left trim bounds use the most restrictive linked source and protect locked partners',()=>{
  const {p,v,a,assets}=setup();a.sourceIn=.019;
  assert.equal(trimBounds(p,v.id,'left',assets).min,0);
  trimLinked(p,v.id,'left',-1,assets);assert.equal(v.start,2);assert.equal(a.sourceIn,.019);
  p.tracks.find(t=>t.id==='a1').locked=true;assert.equal(trimBounds(p,v.id,'left',assets),null);
});
test('invalid playback speeds leave linked media and automation unchanged',()=>{
  const {p,v}=setup(),before=structuredClone(p);
  for(const speed of [0,-1,.01,10,NaN,Infinity]){assert.equal(changeSpeed(p,v.id,speed),false);assert.deepEqual(p,before);}
});
test('slipping at fractional source bounds preserves sequence-frame edit increments',()=>{const {p,v,a,assets}=setup();v.sourceIn=a.sourceIn=.019;slipLinked(p,v.id,-1,assets);assert.equal(v.sourceIn,.019);assert.equal(a.sourceIn,.019);});
