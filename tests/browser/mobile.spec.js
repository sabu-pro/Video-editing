import {test,expect} from '@playwright/test';
import {createProject,createClip} from '../../src/core.js';
import {sessionProject} from './fixtures.js';
test.use({hasTouch:true});
const ready=async page=>{await page.goto('/');await expect(page.locator('#status-text')).toContainText('Sample project');};
async function fixture(page,linked=false){
  const p=createProject();p.name='Touch fixture';
  p.clips=[createClip({id:null,type:'color',name:'Touch clip',duration:6},'v1',0,{id:'one',color:'#4b73ba'})];
  if(linked){p.clips[0].type='video';p.clips[0].audioRole='video-only';p.clips[0].linkId='pair';p.clips.push(createClip({id:null,type:'audio',name:'Linked audio',duration:6},'a1',0,{id:'audio',linkId:'pair'}));}
  await page.locator('#project-input').setInputFiles({name:'touch.cutline',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({project:p,assets:[]}))});
  await expect(page.locator('#project-name')).toHaveText('Touch fixture');
  await page.locator('#timeline-zoom').fill('30');await page.locator('#track-viewport').evaluate(el=>el.scrollTop=150);
}
async function touch(page,from,to,{hold=0,cancel=false}={}){
  const cdp=await page.context().newCDPSession(page),point=p=>({x:p.x,y:p.y,id:0});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point(from)]});
  if(hold)await page.waitForTimeout(hold);
  if(to)for(let i=1;i<=8;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[point({x:from.x+(to.x-from.x)*i/8,y:from.y+(to.y-from.y)*i/8})]});await page.waitForTimeout(18);}
  await cdp.send('Input.dispatchTouchEvent',{type:cancel?'touchCancel':'touchEnd',touchPoints:[]});await cdp.detach();
}
const boxPoint=async locator=>{const b=await locator.boundingBox();return {x:b.x+b.width/2,y:b.y+b.height/2};};

for(const [name,width,height]of [['portrait',390,844],['landscape',844,390],['tablet',768,1024]])test(`mobile ${name} has preview, transport, timeline and drawers without overflow`,async({page},info)=>{
  await page.setViewportSize({width,height});const ml=[];page.on('request',r=>{if(/\.wasm|\.tar\.gz/.test(r.url()))ml.push(r.url());});await ready(page);
  const preview=await page.locator('.monitor').boundingBox(),bar=await page.locator('.mobile-editbar').boundingBox(),timeline=await page.locator('.timeline-panel').boundingBox(),nav=await page.locator('.mobile-nav').boundingBox();
  expect(preview.height).toBeGreaterThan(80);expect(bar.y).toBeGreaterThanOrEqual(preview.y+preview.height);expect(timeline.y).toBeGreaterThanOrEqual(bar.y+bar.height);expect(nav.y+nav.height).toBeLessThanOrEqual(height+1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await expect(page.locator('.editor>.library')).toBeHidden();await expect(page.locator('.editor>.inspector')).toBeHidden();
  for(const tab of ['media','audio','text','effects','more']){await page.locator(`[data-mobile-sheet="${tab}"]`).tap();await expect(page.locator('#mobile-sheet')).toBeVisible();await page.getByRole('button',{name:'Close workspace sheet'}).tap();await expect(page.locator('#mobile-sheet')).toBeHidden();}
  expect(ml).toEqual([]);await page.screenshot({path:info.outputPath(`mobile-${name}.png`)});
});

test('1440 desktop geometry and pixels match existing desktop styles, and resize preserves project state',async({page})=>{
  await page.setViewportSize({width:1440,height:1000});await ready(page);
  await sessionProject(page); // Keep the autosave status stable across both captures.
  const selectors=['.topbar','.workspace-bar','.library','.monitor','.inspector','.timeline-panel','.statusbar'];
  const geometry=()=>page.evaluate(ss=>ss.map(s=>{const r=document.querySelector(s).getBoundingClientRect();return [r.x,r.y,r.width,r.height];}),selectors);
  const before=await geometry(),image=await page.screenshot();
  await page.evaluate(()=>{document.querySelectorAll('.mobile-only').forEach(el=>el.hidden=true);document.querySelector('link[href="src/mobile.css"]').disabled=true;});
  expect(await geometry()).toEqual(before);expect((await page.screenshot()).equals(image)).toBe(true);
  await page.evaluate(()=>{document.querySelector('link[href="src/mobile.css"]').disabled=false;document.querySelector('.mobile-nav').hidden=false;document.querySelector('.mobile-editbar').hidden=false;});
  const saved=await sessionProject(page);await page.setViewportSize({width:390,height:844});await page.locator('[data-mobile-sheet="effects"]').tap();await expect(page.locator('#mobile-sheet .inspector')).toBeVisible();
  await page.setViewportSize({width:1440,height:1000});await expect(page.locator('#mobile-sheet')).toBeHidden();await expect(page.locator('.editor>.inspector')).toBeVisible();expect(await geometry()).toEqual(before);expect(await sessionProject(page)).toEqual(saved);
});

test('real touch selects, moves, trims, cancels, seeks, scrolls, pinches and opens a clip menu with undo/redo and split/delete',async({page})=>{
  await page.setViewportSize({width:390,height:844});await ready(page);await fixture(page);
  const clip=page.locator('[data-clip="one"]');let point=await boxPoint(clip);await page.touchscreen.tap(point.x,point.y);await expect(clip).toHaveClass(/selected/);
  await touch(page,point,{x:point.x+36,y:point.y});let p=await sessionProject(page);expect(p.clips[0].start).toBeGreaterThan(.5);
  await page.locator('[data-mobile-action="undo"]').tap();expect((await sessionProject(page)).clips[0].start).toBe(0);await page.locator('[data-mobile-action="redo"]').tap();expect((await sessionProject(page)).clips[0].start).toBe(p.clips[0].start);await page.locator('[data-mobile-action="undo"]').tap();
  let b=await clip.boundingBox();await touch(page,{x:b.x+b.width-5,y:b.y+b.height/2},{x:b.x+b.width-40,y:b.y+b.height/2});expect((await sessionProject(page)).clips[0].duration).toBeLessThan(6);await page.locator('[data-mobile-action="undo"]').tap();
  point=await boxPoint(clip);await touch(page,point,{x:point.x+30,y:point.y},{cancel:true});expect((await sessionProject(page)).clips[0].start).toBe(0);
  const ruler=await page.locator('#ruler').boundingBox();await touch(page,{x:ruler.x+60,y:ruler.y+12},{x:ruler.x+90,y:ruler.y+12});expect(Number(await page.locator('#monitor-seek').inputValue())).toBeCloseTo(3,1);
  await page.locator('[data-mobile-action="split"]').tap();await expect(page.locator('.timeline-clip')).toHaveCount(2);await page.locator('[data-mobile-action="delete"]').tap();await expect(page.locator('.timeline-clip')).toHaveCount(1);await page.locator('[data-mobile-action="undo"]').tap();await expect(page.locator('.timeline-clip')).toHaveCount(2);await page.locator('[data-mobile-action="undo"]').tap();
  await page.locator('#track-viewport').evaluate(el=>el.scrollTop=0);const lane=await page.locator('[data-track="v3"].timeline-track').boundingBox(),x=ruler.x+100,y=lane.y+45;
  await touch(page,{x,y},{x:x-70,y});expect(await page.locator('#timeline-scroll').evaluate(el=>el.scrollLeft)).toBeGreaterThan(30);
  const cdp=await page.context().newCDPSession(page),old=Number(await page.locator('#timeline-zoom').inputValue());
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:160,y,id:0},{x:260,y,id:1}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:130,y,id:0},{x:300,y,id:1}]});await page.waitForTimeout(80);await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();expect(Number(await page.locator('#timeline-zoom').inputValue())).toBeGreaterThan(old);
  await page.locator('#timeline-scroll').evaluate(el=>el.scrollLeft=0);await page.locator('#track-viewport').evaluate(el=>el.scrollTop=150);await page.locator('#timeline-zoom').fill('30');point=await boxPoint(clip);await touch(page,point,null,{hold:650});await expect(page.locator('#menu-popover')).toBeVisible();expect((await sessionProject(page)).clips[0].start).toBe(0);expect(await page.evaluate(()=>scrollY)).toBe(0);
});

test('touch linked movement honors track locks and preserves snapping/history',async({page})=>{
  await page.setViewportSize({width:768,height:1024});await ready(page);await fixture(page,true);let point=await boxPoint(page.locator('[data-clip="one"]'));
  await touch(page,point,{x:point.x+60,y:point.y});let p=await sessionProject(page);expect(p.clips[0].start).toBe(p.clips[1].start);expect(p.clips[0].start).toBeGreaterThan(0);await page.locator('[data-mobile-action="undo"]').tap();
  await page.locator('[data-track-toggle="lock"][data-track="a1"]').tap();point=await boxPoint(page.locator('[data-clip="one"]'));await touch(page,point,{x:point.x+60,y:point.y});p=await sessionProject(page);expect(p.clips.map(c=>c.start)).toEqual([0,0]);
});

test('mobile Media and Effects reuse existing preview and Applied Effects controls without hidden rendering',async({page})=>{
  await page.setViewportSize({width:390,height:844});await ready(page);
  await page.locator('[data-mobile-sheet="media"]').tap();await page.locator('.asset-card').first().tap();await expect(page.locator('#modal')).toBeVisible();await page.getByRole('button',{name:'Close dialog'}).tap();
  await page.locator('[data-mobile-sheet="effects"]').tap();await expect(page.locator('#inspector-content')).toContainText('Applied Effects');await page.locator('[data-mobile-add]').tap();await page.locator('[data-preset="Blur"]').tap();
  const blur=page.locator('[data-applied-effect="blur"]');await expect(blur).toBeVisible();await blur.getByRole('checkbox').uncheck();let p=await sessionProject(page);expect(p.clips.find(c=>c.type==='image').effectBypass).toContain('blur');
  await blur.getByRole('button',{name:'Remove Blur effect'}).tap();await expect(blur).toHaveCount(0);await page.getByRole('button',{name:'Close workspace sheet'}).tap();await page.locator('[data-mobile-action="undo"]').tap();await page.locator('[data-mobile-sheet="effects"]').tap();await expect(blur).toBeVisible();
  await page.getByRole('button',{name:'Close workspace sheet'}).tap();const untouched=await page.locator('#inspector-content').innerHTML();await page.locator('[data-mobile-action="undo"]').tap();expect(await page.locator('#inspector-content').innerHTML()).toBe(untouched);
});

test('mobile audio effect controls preserve settings and show ML download failures explicitly',async({page})=>{
  await page.setViewportSize({width:390,height:844});await ready(page);await page.locator('.timeline-clip.audio').tap();await page.locator('[data-mobile-sheet="effects"]').tap();
  await page.locator('[data-mobile-add]').tap();await page.locator('[data-preset="Background Noise Remover"]').tap();await page.locator('#noise-amount').fill('72');await page.locator('#noise-amount').press('Tab');await page.locator('#noise-mode').selectOption('Voice');await page.locator('#noise-bypass').tap();
  let p=await sessionProject(page);expect(p.clips.find(c=>c.type==='audio').noiseRemoval).toEqual({amount:72,mode:'Voice',bypass:true});
  await page.route('**/assets/voice-isolation/*.wasm',route=>route.fulfill({status:503,body:'unavailable'}));
  await page.locator('[data-mobile-add]').tap();await page.locator('[data-preset="Voice Isolation"]').tap();await expect(page.locator('[data-voice-status]')).toContainText('Error:');await page.locator('#voice-bypass').tap();
  await page.getByRole('button',{name:'Remove voice isolation',exact:true}).tap();await expect(page.locator('#voice-strength')).toHaveCount(0);await expect(page.locator('#noise-amount')).toHaveValue('72');
  await page.getByRole('button',{name:'Close workspace sheet'}).tap();await page.locator('[data-mobile-action="undo"]').tap();await page.locator('[data-mobile-sheet="effects"]').tap();await expect(page.locator('#voice-bypass')).toBeChecked();
  await page.getByRole('button',{name:'Reset noise remover',exact:true}).tap();await expect(page.locator('#noise-amount')).toHaveValue('50');await page.getByRole('button',{name:'Remove noise remover',exact:true}).tap();await expect(page.locator('#noise-amount')).toHaveCount(0);await expect(page.locator('#voice-strength')).toHaveValue('100');
});
