import {test,expect} from '@playwright/test';
test('a 300-clip drag preserves timeline DOM and records frame timings',async({page},testInfo)=>{
  await page.goto('/');await expect(page.locator('.timeline-clip.image').first()).toBeVisible();
  const project=await page.evaluate(async()=>{const {createProject,createClip}=await import('/src/core.js');const p=createProject();p.width=640;p.height=360;for(let i=0;i<300;i++)p.clips.push(createClip({type:'color',name:`Clip ${i}`,duration:2},'v1',i*2,{color:'#386984'}));return p;});
  await page.locator('#project-input').setInputFiles({name:'performance.cutline',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({application:'Cutline Studio',version:1,project,assets:[]}))});
  await expect(page.locator('.timeline-clip')).toHaveCount(300);await page.locator('#timeline-zoom').fill('100');
  const clip=page.locator('.timeline-clip').first();await clip.scrollIntoViewIfNeeded();const box=await clip.boundingBox();
  await page.mouse.move(box.x+60,box.y+20);await page.mouse.down();
  await page.evaluate(()=>{const state=window.dragProfile={mutations:0,intervals:[],last:performance.now(),node:document.querySelector('.timeline-clip')};state.observer=new MutationObserver(records=>state.mutations+=records.filter(r=>r.type==='childList').length);state.observer.observe(document.querySelector('#tracks'),{childList:true,subtree:true});const tick=now=>{state.intervals.push(now-state.last);state.last=now;state.raf=requestAnimationFrame(tick);};state.raf=requestAnimationFrame(tick);});
  await page.mouse.move(box.x+120,box.y+20,{steps:30});
  const metrics=await page.evaluate(()=>{const s=window.dragProfile;s.observer.disconnect();cancelAnimationFrame(s.raf);const intervals=s.intervals.filter(n=>n>0).sort((a,b)=>a-b);return {clips:300,domReplacements:s.mutations,sameNode:s.node===document.querySelector('.timeline-clip'),samples:intervals.length,medianMs:intervals[Math.floor(intervals.length/2)],p95Ms:intervals[Math.floor(intervals.length*.95)]};});
  await page.mouse.up();expect(metrics.domReplacements).toBe(0);expect(metrics.sameNode).toBe(true);expect(metrics.samples).toBeGreaterThan(0);
  await testInfo.attach('timeline-drag-profile',{body:JSON.stringify(metrics,null,2),contentType:'application/json'});
  console.log('Timeline profile:',JSON.stringify(metrics));
});
