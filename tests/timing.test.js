import test from 'node:test';
import assert from 'node:assert/strict';
import { FrameClock, quantize, toFrame } from '../src/timing.js';
import { resolveSnap } from '../src/snapping.js';
import { createProject, createClip, splitClip, trimClip, animatedValue } from '../src/core.js';
const asset={id:'a',name:'test',type:'video',duration:10};
for(const fps of [24,25,30,60]){
  test(`${fps} fps: repeated frame edits and one-frame razor stay on the grid`,()=>{const p=createProject();p.fps=fps;const c=createClip(asset,'v1',0);p.clips.push(c);for(let i=0;i<10000;i++)c.start=quantize(c.start+1/fps,fps);assert.equal(toFrame(c.start,fps),10000);const cut=splitClip(p,c.id,c.start+1/fps);assert.ok(cut);assert.equal(toFrame(c.duration,fps),1);assert.equal(toFrame(cut.start,fps),10001);});
  test(`${fps} fps: trim source bounds floor to a whole frame`,()=>{const c=createClip(asset,'v1',0);trimClip(c,'right',10,10.019,1/fps);assert.equal(c.duration,Math.floor(10.019*fps)/fps);});
}
test('transport uses absolute elapsed time and does not lose stalled frames',()=>{const clock=new FrameClock();clock.start(3,100,1);assert.equal(clock.time(102,30),5);clock.start(5,102,-2);assert.equal(clock.time(103,30),3);});
test('snap includes playhead, clip boundaries, markers, and zero',()=>{const p=createProject();p.clips.push(createClip(asset,'v1',3));p.markers.push({time:20});for(const [time,want]of [[.1,0],[3.1,3],[12.9,13],[19.9,20],[7.1,7]])assert.equal(resolveSnap(p,{time,playhead:7,zoom:50}).time,want);});
test('snap chooses closest edge and has constant pixel tolerance across zooms',()=>{const p=createProject();p.markers=[{time:10}];for(const zoom of [10,40,160]){assert.equal(resolveSnap(p,{time:10+6/zoom,zoom}).point,10);assert.equal(resolveSnap(p,{time:10+12/zoom,zoom}).point,null);}assert.equal(resolveSnap(p,{time:8.1,offsets:[0,2],zoom:50}).time,8);});
test('disabled/bypassed snap still quantizes; illegal targets never jump a group',()=>{const p=createProject();p.markers=[{time:1}];assert.equal(resolveSnap(p,{time:1.1,enabled:false}).time,1.1);assert.equal(resolveSnap(p,{time:1.1,bypass:true}).point,null);assert.equal(resolveSnap(p,{time:1.1,min:2}).time,2);});
test('cuts retain effect parameters and animation values, including fade envelopes',()=>{const p=createProject(),c=createClip(asset,'v1');c.effects.fadeIn=4;c.effects.fadeOut=3;c.keyframes.scale=[{time:0,value:100},{time:10,value:200}];p.clips.push(c);const right=splitClip(p,c.id,2);assert.equal(right.effects.fadeIn,4);assert.equal(right.envelopeDuration,10);assert.equal(right.envelopeOffset,2);assert.equal(animatedValue(right,'scale',3),130);});
test('frame quantization does not enlarge visual snapping tolerance',()=>{const p=createProject();p.markers=[{time:10}];assert.equal(resolveSnap(p,{time:10+8.9/180,zoom:180}).point,null);assert.equal(resolveSnap(p,{time:10+7/180,zoom:180}).point,10);});
