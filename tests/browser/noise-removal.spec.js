import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {makeAVFixture,blankProject,sessionProject} from './fixtures.js';

test('effects hierarchy searches, collapses, favorites and noise controls persist through history/reload',async({page},testInfo)=>{
  await page.goto('/');await expect(page.locator('.timeline-clip.audio')).toBeVisible();
  await page.locator('.timeline-clip.audio').click();await page.locator('[data-library="effects"]').click();
  const folder=page.locator('[data-effect-folder="Audio Effects"]');
  await folder.locator(':scope > summary').click();await expect(folder).not.toHaveAttribute('open','');
  await page.locator('#effect-search').fill('restoration');await expect(page.locator('[data-preset="Background Noise Remover"]')).toBeVisible();
  await page.locator('[data-favorite="Background Noise Remover"]').click();
  await page.locator('[data-effect-folder="Favorites"] [data-preset]').click();
  await expect(page.locator('#noise-amount')).toHaveValue('50');
  await page.locator('#noise-amount').fill('82');await page.locator('#noise-amount').press('Tab');await page.locator('#noise-mode').selectOption('60 Hz Hum');
  await page.locator('#noise-bypass').check();
  let p=await sessionProject(page);expect(p.clips.find(c=>c.type==='audio').noiseRemoval).toEqual({amount:82,mode:'60 Hz Hum',bypass:true});
  await page.getByRole('button',{name:'Reset noise remover',exact:true}).click();await expect(page.locator('#noise-amount')).toHaveValue('50');await expect(page.locator('#noise-bypass')).not.toBeChecked();
  await page.keyboard.press('Control+z');await expect(page.locator('#noise-amount')).toHaveValue('82');await expect(page.locator('#noise-bypass')).toBeChecked();
  await page.getByRole('button',{name:'Remove noise remover',exact:true}).click();await expect(page.locator('#noise-amount')).toHaveCount(0);
  await page.keyboard.press('Control+z');await expect(page.locator('#noise-amount')).toHaveValue('82');
  await page.keyboard.press('Control+Shift+z');await expect(page.locator('#noise-amount')).toHaveCount(0);
  await page.keyboard.press('Control+z');await sessionProject(page);await page.reload();
  await page.locator('.timeline-clip.audio').click();await expect(page.locator('#noise-amount')).toHaveValue('82');await expect(page.locator('#noise-mode')).toHaveValue('60 Hz Hum');await expect(page.locator('#noise-bypass')).toBeChecked();
  await page.locator('[data-library="effects"]').click();await expect(page.locator('[data-effect-folder="Favorites"] [data-preset]')).toHaveCount(1);
  await page.locator('#effect-search').fill('keying');await expect(page.locator('[data-preset]')).toHaveCount(0);
  await page.locator('#effect-search').fill('');await page.screenshot({path:testInfo.outputPath('noise-removal-controls.png'),fullPage:true});
});

test('real embedded and detached stereo use stable DSP, meters, volume, mute/solo and encoded export audio',async({page})=>{
  await page.goto('/');await expect(page.locator('.timeline-clip.audio')).toBeVisible();
  const fixture=await makeAVFixture(page,true,3,{frequencies:[60,1000]});
  const result=await page.evaluate(async(base64)=>{
    const {MediaEngine}=await import('/src/engine.js'),{createClip,createProject}=await import('/src/core.js'),{separateAudio}=await import('/src/editing.js');
    const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0)),url=URL.createObjectURL(new Blob([bytes],{type:'video/webm'}));
    const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;
    const p=createProject(),clip=createClip({id:'fixture',type:'video',name:'Embedded',duration:3},'v1');p.clips=[clip];
    const errors=[],engine=new MediaEngine(canvas,new Map([['fixture',{id:'fixture',url}]]),()=>p,error=>errors.push(error));
    const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    await engine.audioInit();await engine.prepare(0);engine.sync(0,true);await wait(600);
    const node=engine.nodes.get(clip.id),processor=node.audioEffects.node,dry=engine.level();
    clip.noiseRemoval={amount:100,mode:'60 Hz Hum',bypass:false};engine.sync(0,true);await wait(1000);const wet=engine.level();
    const record=async()=>{
      engine.sync(0,true);await wait(400);
      const stream=canvas.captureStream(30);stream.addTrack(engine.destination.stream.getAudioTracks()[0]);
      const recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8,opus',audioBitsPerSecond:192000}),chunks=[];
      const done=new Promise(resolve=>{recorder.ondataavailable=e=>chunks.push(e.data);recorder.onstop=resolve;});
      const paint=setInterval(()=>engine.render(),1000/30);recorder.start();await wait(1000);recorder.stop();await done;clearInterval(paint);stream.getVideoTracks().forEach(t=>t.stop());
      const audio=await engine.audio.decodeAudioData(await new Blob(chunks,{type:'video/webm'}).arrayBuffer());
      return Array.from({length:audio.numberOfChannels},(_,ch)=>{const data=audio.getChannelData(ch).subarray(Math.round(audio.sampleRate*.25));return Math.sqrt(data.reduce((sum,x)=>sum+x*x,0)/data.length);});
    };
    const encodedWet=await record();clip.noiseRemoval.bypass=true;engine.sync(0,true);await wait(600);const bypass=engine.level(),encodedDry=await record();
    clip.noiseRemoval.bypass=false;clip.effects.volume=50;engine.sync(0,true);await wait(700);const volume=engine.level();
    engine.setVolume(.4);await wait(150);const master=engine.level();engine.setVolume(.8);
    const track=p.tracks.find(t=>t.id==='v1'),other=p.tracks.find(t=>t.id==='a2');track.muted=true;engine.sync(0,true);await wait(250);const muted=engine.level(),encodedMute=await record();
    track.muted=false;other.solo=true;engine.sync(0,true);await wait(250);const soloOther=engine.level();
    track.solo=true;engine.sync(0,true);await wait(600);const soloSelf=engine.level(),stable=processor===engine.nodes.get(clip.id).audioEffects.node;
    track.solo=false;other.solo=false;clip.effects.volume=100;delete clip.noiseRemoval;engine.sync(0,true);await wait(600);const removed=engine.level();
    clip.noiseRemoval={amount:100,mode:'60 Hz Hum',bypass:false};separateAudio(p,[clip.id],'a1');await engine.prepare(0);engine.sync(0,true);await wait(900);const detached=engine.level();
    engine.reset();await engine.audio.close();URL.revokeObjectURL(url);
    return {dry,wet,bypass,encodedWet,encodedDry,volume,master,muted,encodedMute,soloOther,soloSelf,stable,removed,detached,errors};
  },fixture.buffer.toString('base64'));
  expect(result.errors).toEqual([]);expect(result.stable).toBe(true);
  expect(result.dry[0]).toBeGreaterThan(result.dry[1]*3);
  expect(result.wet[0]).toBeLessThan(result.dry[0]*.08);expect(result.wet[1]/result.dry[1]).toBeGreaterThan(.85);
  expect(result.bypass[0]/result.dry[0]).toBeCloseTo(1,1);expect(result.removed[0]/result.dry[0]).toBeCloseTo(1,1);
  expect(result.encodedWet).toHaveLength(2);expect(result.encodedWet[0]).toBeLessThan(result.encodedDry[0]*.08);expect(result.encodedWet[1]/result.encodedDry[1]).toBeGreaterThan(.85);
  expect(result.volume[1]/result.wet[1]).toBeCloseTo(.5,1);expect(result.master[1]/result.volume[1]).toBeCloseTo(.5,1);
  for(const level of [...result.muted,...result.soloOther,...result.encodedMute])expect(level).toBeLessThan(.0001);
  expect(result.soloSelf[1]).toBeGreaterThan(.03);expect(result.detached[0]).toBeLessThan(result.dry[0]*.08);expect(result.detached[1]/result.wet[1]).toBeCloseTo(1,1);
});

test('mono media remains audible in both channels with the real worklet',async({page})=>{
  await page.goto('/');
  const result=await page.evaluate(async()=>{
    const {MediaEngine,makeDemoAudio}=await import('/src/engine.js'),{createClip,createProject}=await import('/src/core.js');
    const url=URL.createObjectURL(makeDemoAudio(3)),p=createProject(),clip=createClip({id:'mono',type:'audio',name:'Mono',duration:3},'a1');
    clip.noiseRemoval={amount:70,mode:'Voice',bypass:false};p.clips=[clip];
    const engine=new MediaEngine(document.createElement('canvas'),new Map([['mono',{url}]]),()=>p);
    await engine.audioInit();await engine.prepare(0);engine.sync(0,true);await new Promise(r=>setTimeout(r,900));const levels=engine.level();engine.reset();await engine.audio.close();URL.revokeObjectURL(url);return levels;
  });
  expect(result[0]).toBeGreaterThan(.005);expect(result[0]).toBeCloseTo(result[1],5);
});

test('applying to linked video reaches its audio and survives portable save/open and Export video',async({page},testInfo)=>{
  await page.goto('/');await expect(page.locator('.timeline-clip.audio')).toBeVisible();
  const fixture=await makeAVFixture(page,true,3,{frequencies:[60,1000]});await blankProject(page);
  await page.locator('#file-input').setInputFiles(fixture);await expect(page.locator('.asset-card')).toHaveCount(1);
  await page.locator('.asset-card').dblclick();await page.getByRole('button',{name:'Add to timeline',exact:true}).click();
  await page.locator('.timeline-clip.video').click();await page.locator('[data-library="effects"]').click();
  await page.locator('[data-preset="Background Noise Remover"]').dragTo(page.locator('.timeline-clip.video'));
  await page.locator('#noise-amount').fill('100');await page.locator('#noise-amount').press('Tab');await page.locator('#noise-mode').selectOption('60 Hz Hum');
  const p=await sessionProject(page);expect(p.clips.find(c=>c.type==='video').noiseRemoval).toBeUndefined();expect(p.clips.find(c=>c.type==='audio').noiseRemoval.amount).toBe(100);
  await page.locator('[data-action="save"]').first().click();let downloading=page.waitForEvent('download');await page.getByRole('button',{name:'Save project',exact:true}).last().click();
  let download=await downloading;const projectPath=testInfo.outputPath('noise.cutline');await download.saveAs(projectPath);
  const saved=JSON.parse(await readFile(projectPath,'utf8'));expect(saved.project.clips.find(c=>c.type==='audio').noiseRemoval).toEqual({amount:100,mode:'60 Hz Hum',bypass:false});
  await blankProject(page);await page.locator('#project-input').setInputFiles(projectPath);await expect(page.locator('.timeline-clip')).toHaveCount(2);
  await page.locator('.timeline-clip.audio').click();await expect(page.locator('#noise-mode')).toHaveValue('60 Hz Hum');
  await page.locator('[data-action="export"]').first().click();await page.locator('#export-resolution').selectOption('.5');downloading=page.waitForEvent('download');
  await page.getByRole('button',{name:'Export video',exact:true}).click();download=await downloading;expect(await download.failure()).toBeNull();
  const outputPath=testInfo.outputPath('noise-export.webm');await download.saveAs(outputPath);
  const levels=await page.evaluate(async base64=>{
    const audio=new AudioContext(),buffer=await audio.decodeAudioData(Uint8Array.from(atob(base64),c=>c.charCodeAt(0)).buffer);
    const levels=Array.from({length:buffer.numberOfChannels},(_,ch)=>{const samples=buffer.getChannelData(ch).subarray(buffer.sampleRate,buffer.sampleRate*2);return Math.sqrt(samples.reduce((s,x)=>s+x*x,0)/samples.length);});await audio.close();return levels;
  },(await readFile(outputPath)).toString('base64'));
  expect(levels).toHaveLength(2);expect(levels[0]).toBeLessThan(.01);expect(levels[1]).toBeGreaterThan(.04);
});
