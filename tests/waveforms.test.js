import test from 'node:test';
import assert from 'node:assert/strict';
import {waveformPath} from '../src/waveforms.js';
test('waveform cache reuses source bins across movement and invalidates on source edits',()=>{
  let reads=0;const peaks=new Proxy([.1,.3,.9,.5],{get(target,key){if(/^\d+$/.test(String(key)))reads++;return target[key];}});
  const asset={duration:4,peaks},clip={sourceIn:0,duration:4,speed:1,start:0};
  const first=waveformPath(asset,clip,120),count=reads;assert.ok(count>0);clip.start=10;
  assert.equal(waveformPath(asset,clip,120),first);assert.equal(reads,count);
  clip.sourceIn=1;assert.notEqual(waveformPath(asset,clip,120),first);assert.ok(reads>count);
});
