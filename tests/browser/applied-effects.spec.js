import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {sessionProject,blankProject,makeNoiseFixture} from './fixtures.js';

test('Applied Effects are per clip and support bypass, reset, remove, history and portable persistence',async({page},testInfo)=>{
  await page.goto('/');await expect(page.locator('.timeline-clip.image').first()).toBeVisible();await page.locator('.timeline-clip.image').first().click();
  await page.locator('[data-library="effects"]').click();await page.locator('[data-preset="Blur"]').click();
  await page.locator('#inspector-content summary').filter({hasText:'Lens & crop'}).click();
  await page.locator('#effect-blur').fill('9');await page.locator('#effect-blur').press('Tab');await page.locator('[data-keyframe="blur"]').click();
  const before=await sessionProject(page),first=before.clips.find(c=>c.type==='image'),blur=page.locator('[data-applied-effect="blur"]');
  await blur.getByRole('checkbox').uncheck();let p=await sessionProject(page),clip=p.clips.find(c=>c.id===first.id);expect(clip.effects.blur).toBe(9);expect(clip.keyframes.blur).toEqual(first.keyframes.blur);expect(clip.effectBypass).toContain('blur');
  await blur.getByRole('button',{name:'Remove Blur effect',exact:true}).click();await expect(blur).toHaveCount(0);
  p=await sessionProject(page);clip=p.clips.find(c=>c.id===first.id);expect(clip.effects.blur).toBe(0);expect(clip.keyframes.blur).toBeUndefined();expect(clip.keyframes.scale).toEqual(first.keyframes.scale);
  await page.keyboard.press('Control+z');await expect(blur).toHaveCount(1);p=await sessionProject(page);expect(p.clips.find(c=>c.id===first.id).keyframes.blur).toEqual(first.keyframes.blur);
  await page.keyboard.press('Control+Shift+z');await expect(blur).toHaveCount(0);await page.keyboard.press('Control+z');
  await blur.getByRole('button',{name:'Reset applied Blur',exact:true}).click();await expect(blur).toHaveCount(1);await expect(page.locator('#effect-blur')).toHaveValue('0');await expect(blur.getByRole('checkbox')).toBeChecked();
  await page.locator('.timeline-clip.image').nth(1).click();await expect(blur).toHaveCount(0);
  await page.locator('.timeline-clip.audio').click();await page.locator('[data-preset="Volume"]').click();await page.locator('[data-preset="Background Noise Remover"]').click();
  await page.locator('#effect-volume').fill('45');await page.locator('#effect-volume').press('Tab');await page.locator('[data-keyframe="volume"]').click();
  await page.locator('[data-applied-effect="volume"]').getByRole('checkbox').uncheck();await page.getByRole('button',{name:'Remove Volume effect',exact:true}).click();await expect(page.locator('[data-applied-effect="volume"]')).toHaveCount(0);await expect(page.locator('#noise-amount')).toHaveValue('50');
  await page.keyboard.press('Control+z');await expect(page.locator('#effect-volume')).toHaveValue('45');await expect(page.locator('[data-keyframe="volume"]')).toHaveClass(/active/);
  await page.locator('[data-action="save"]').first().click();const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'Save project',exact:true}).last().click();const download=await downloading,path=testInfo.outputPath('applied.cutline');await download.saveAs(path);
  const saved=JSON.parse(await readFile(path,'utf8'));expect(saved.project.clips.find(c=>c.id===first.id).appliedEffects).toContain('blur');
  await blankProject(page);await page.locator('#project-input').setInputFiles(path);await expect(page.locator('.timeline-clip.audio')).toBeVisible();await page.locator('.timeline-clip.audio').click();await expect(page.locator('[data-applied-effect="volume"] input')).not.toBeChecked();await expect(page.locator('#effect-volume')).toHaveValue('45');await expect(page.locator('#noise-amount')).toHaveValue('50');
  await page.locator('.timeline-clip.image').first().click();await expect(blur).toHaveCount(1);await expect(page.locator('[data-applied-effect="noiseRemoval"]')).toHaveCount(0);
});

test('removing shared Voice Isolation releases its last result and restores preview/export through remaining effects',async({page})=>{
  await page.goto('/');const fixture=makeNoiseFixture(2);
  const result=await page.evaluate(async base64=>{
    const {MediaEngine}=await import('/src/engine.js'),{createProject,createClip,manageAppliedEffect}=await import('/src/core.js');
    const blob=new Blob([Uint8Array.from(atob(base64),c=>c.charCodeAt(0))],{type:'audio/wav'}),url=URL.createObjectURL(blob),asset={id:'x',blob,url,duration:2};
    const p=createProject(),c=createClip({id:'x',type:'audio',duration:2},'a1'),other={...structuredClone(c),id:'shared',start:3};p.clips=[c,other];
    c.voiceIsolation={strength:100,bypass:false};other.voiceIsolation={...c.voiceIsolation};c.noiseRemoval={amount:0,mode:'General',bypass:false};c.effects.volume=50;
    const canvas=document.createElement('canvas'),engine=new MediaEngine(canvas,new Map([['x',asset]]),()=>p);await engine.audioInit();await engine.prepareVoiceEffects();await engine.prepare(0);
    const entry=engine.voiceCache.get(c,asset),wait=ms=>new Promise(r=>setTimeout(r,ms));
    const level=()=>{const a=engine.analysers[0],d=new Float32Array(a.fftSize);a.getFloatTimeDomainData(d);return Math.sqrt(d.reduce((s,x)=>s+x*x,0)/d.length);};
    engine.sync(0,true);await wait(450);const isolated=level();delete c.voiceIsolation;engine.sync(0,true);await wait(450);const removed=level(),shared=engine.voiceCache.get(other,asset)===entry&&entry.refs===1;
    delete other.voiceIsolation;engine.sync(0,true);await wait(450);let revoked=false;try{await fetch(entry.url);}catch{revoked=true;}
    const clean=entry.refs===0&&engine.voiceCache.entries.size===0&&!engine.nodes.get(c.id).voice&&!engine.voiceCache.worker;
    const noiseStillPresent=engine.nodes.get(c.id).audioEffects.last.amount===0&&c.noiseRemoval.amount===0;
    manageAppliedEffect(c,'volume','remove');engine.sync(0,true);await wait(400);const full=level();
    const recorder=new MediaRecorder(engine.destination.stream,{mimeType:'audio/webm;codecs=opus'}),chunks=[],done=new Promise(r=>{recorder.ondataavailable=e=>chunks.push(e.data);recorder.onstop=r;});recorder.start();await wait(500);recorder.stop();await done;
    const decoded=await engine.audio.decodeAudioData(await new Blob(chunks).arrayBuffer()),d=decoded.getChannelData(0).subarray(Math.round(decoded.sampleRate*.1)),exported=Math.sqrt(d.reduce((s,x)=>s+x*x,0)/d.length);
    engine.reset();await engine.audio.close();URL.revokeObjectURL(url);return {isolated,removed,shared,revoked,clean,noiseStillPresent,full,exported};
  },fixture.buffer.toString('base64'));
  expect(result.shared).toBe(true);expect(result.revoked).toBe(true);expect(result.clean).toBe(true);expect(result.noiseStillPresent).toBe(true);
  expect(result.isolated/result.removed).toBeLessThan(.3);expect(result.full/result.removed).toBeGreaterThan(1.8);expect(result.exported/result.full).toBeGreaterThan(.8);expect(result.exported/result.full).toBeLessThan(1.2);
});

test('removing Voice Isolation during processing terminates its Worker without publishing an orphan result',async({page})=>{
  await page.goto('/');const fixture=makeNoiseFixture(4);
  const result=await page.evaluate(async base64=>{
    const {VoiceIsolationCache}=await import('/src/voice-isolation.js');let started;
    const ready=new Promise(resolve=>started=resolve),cache=new VoiceIsolationCache(()=>{if([...cache.entries.values()].some(e=>e.status==='Processing 0%'))setTimeout(started,0);});
    const blob=new Blob([Uint8Array.from(atob(base64),c=>c.charCodeAt(0))],{type:'audio/wav'}),clip={assetId:'x',sourceIn:0,duration:4,speed:1,voiceIsolation:{strength:100,bypass:false}};
    const outcome=cache.ensure(clip,{blob,duration:4}).then(()=>false,error=>error.message.includes('cancelled'));
    await ready;const running=!!cache.worker;delete clip.voiceIsolation;cache.retain([clip]);
    return {running,cancelled:await outcome,released:!cache.worker&&cache.entries.size===0};
  },fixture.buffer.toString('base64'));
  expect(result).toEqual({running:true,cancelled:true,released:true});
});
