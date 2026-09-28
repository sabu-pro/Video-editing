import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {blankProject,sessionProject,makeAVFixture} from './fixtures.js';
test.beforeAll(async()=>{await promisify(execFile)(process.execPath,['scripts/build.mjs']);});

test('real model loads lazily from production assets, preserves speech and mono/stereo, and compensates delay',async({page})=>{
  const requests=[];page.on('request',r=>requests.push(r.url()));
  await page.goto('/dist/index.html');await expect(page.locator('#status-text')).toContainText('Sample project');
  expect(requests.some(url=>url.includes('/assets/voice-isolation/'))).toBe(false);
  const speech=(await readFile('tests/fixtures/voice-speech.wav')).toString('base64');
  const result=await page.evaluate(async base64=>{
    const {VoiceIsolationCache,loadVoiceModel}=await import('./src/voice-isolation.js');
    const {voiceWave,VOICE_ASSETS}=await import('./src/voice-isolation-config.js');
    const audio=new OfflineAudioContext(2,1,48000),clean=await audio.decodeAudioData(Uint8Array.from(atob(base64),c=>c.charCodeAt(0)).buffer);
    const source=clean.getChannelData(0),frames=48000*5;let seed=123;
    const noisy=Float32Array.from({length:frames},(_,i)=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return (i>=48000?source[i-48000]||0:0)+(seed/2147483648-1)*.06;});
    // Encode a conventional stereo float WAV from the same helper's 4-channel file.
    const encode=channels=>{const n=channels.length,buf=new ArrayBuffer(44+frames*n*4),v=new DataView(buf);const header=new Uint8Array(voiceWave([noisy],[noisy]),0,44);new Uint8Array(buf).set(header);v.setUint32(4,buf.byteLength-8,true);v.setUint16(22,n,true);v.setUint32(28,48000*n*4,true);v.setUint16(32,n*4,true);v.setUint32(40,frames*n*4,true);for(let i=0;i<frames;i++)for(let ch=0;ch<n;ch++)v.setFloat32(44+(i*n+ch)*4,channels[ch][i],true);return new Blob([buf],{type:'audio/wav'});};
    const cache=new VoiceIsolationCache(),clip={assetId:'speech',sourceIn:0,duration:5,speed:1},asset={blob:encode([noisy]),duration:5};
    const first=await cache.ensure(clip,asset),same=await cache.ensure({...clip,voiceIsolation:{strength:25,bypass:true}},asset);
    const rendered=await audio.decodeAudioData(await(await fetch(first.url)).arrayBuffer());
    const dry=rendered.getChannelData(0),wet=rendered.getChannelData(2),rms=(data,start,end)=>Math.sqrt(data.subarray(start,end).reduce((s,x)=>s+x*x,0)/(end-start));
    let best={lag:0,error:Infinity};for(let lag=-50;lag<=50;lag++){let error=0;for(let i=60000;i<frames-2400;i+=4)error+=(source[i-48000]-wet[i+lag])**2;if(error<best.error)best={lag,error};}
    const stats={channels:rendered.numberOfChannels,noiseDry:rms(dry,24000,44000),noiseWet:rms(wet,24000,44000),speechDry:rms(dry,60000,frames-2400),speechWet:rms(wet,60000,frames-2400),same:same===first,lag:best.lag,urls:VOICE_ASSETS};
    const right=new Float32Array(frames);const stereo=await cache.ensure({...clip,assetId:'stereo'},{blob:encode([noisy,right]),duration:5});
    const stereoBuffer=await audio.decodeAudioData(await(await fetch(stereo.url)).arrayBuffer());stats.rightPeak=stereoBuffer.getChannelData(3).reduce((p,x)=>Math.max(p,Math.abs(x)),0);
    stats.modelCached=(await loadVoiceModel())===(await loadVoiceModel());cache.clear();return stats;
  },speech);
  expect(result.channels).toBe(4);expect(result.noiseWet/result.noiseDry).toBeLessThan(.3);expect(result.speechWet/result.speechDry).toBeGreaterThan(.45);expect(Math.abs(result.lag)).toBeLessThan(3);
  expect(result.rightPeak).toBeLessThan(.00001);expect(result.same).toBe(true);expect(result.modelCached).toBe(true);
  for(const url of Object.values(result.urls))expect(new URL(url).pathname).toMatch(/^\/dist\/(src|assets)\//);
  const modelRequests=requests.filter(url=>url.endsWith('.wasm')||url.endsWith('.tar.gz'));expect(modelRequests).toHaveLength(2);
  expect(modelRequests.every(url=>new URL(url).origin==='http://localhost:3000')).toBe(true);
  console.log('Voice Isolation production ML:',JSON.stringify(result));
});

test('Voice Isolation controls, persistence, media routing, meters and exported audio use the same cached result',async({page},testInfo)=>{
  test.setTimeout(90000);await page.goto('/');await expect(page.locator('#status-text')).toContainText('Sample project');
  const fixture=await makeAVFixture(page,true,4,{frequencies:[60,1000]});await blankProject(page);await page.locator('#file-input').setInputFiles(fixture);
  await expect(page.locator('.asset-card')).toHaveCount(1);await page.locator('.asset-card').dblclick();await page.getByRole('button',{name:'Add to timeline',exact:true}).click();
  await page.locator('.timeline-clip.video').click();await page.locator('[data-library="effects"]').click();await page.locator('[data-preset="Voice Isolation"]').click();
  await expect(page.locator('[data-voice-status]')).toHaveText('Ready',{timeout:30000});await expect(page.locator('#voice-strength')).toHaveValue('100');
  let p=await sessionProject(page);expect(p.clips.find(c=>c.type==='audio').voiceIsolation).toEqual({strength:100,bypass:false});expect(p.clips.find(c=>c.type==='video').voiceIsolation).toBeUndefined();
  await page.locator('#voice-strength').fill('35');await page.locator('#voice-strength').press('Tab');await page.locator('#voice-bypass').check();
  await page.getByRole('button',{name:'Reset voice isolation',exact:true}).click();await expect(page.locator('#voice-strength')).toHaveValue('100');await page.keyboard.press('Control+z');await expect(page.locator('#voice-strength')).toHaveValue('35');await expect(page.locator('#voice-bypass')).toBeChecked();
  await page.getByRole('button',{name:'Remove voice isolation',exact:true}).click();await expect(page.locator('#voice-strength')).toHaveCount(0);await page.keyboard.press('Control+z');await expect(page.locator('#voice-strength')).toHaveValue('35');
  await sessionProject(page);await page.reload();await page.locator('.timeline-clip.audio').click();await expect(page.locator('#voice-strength')).toHaveValue('35');await expect(page.locator('#voice-bypass')).toBeChecked();
  await page.locator('#voice-strength').fill('100');await page.locator('#voice-strength').press('Tab');await page.locator('#voice-bypass').uncheck();await expect(page.locator('[data-voice-status]')).toHaveText('Ready',{timeout:30000});
  await page.locator('[data-menu="sequence"]').click();await page.locator('[data-action="detach-audio"]').click();p=await sessionProject(page);expect(p.clips.every(c=>!c.linkId)).toBe(true);
  const level=async()=>Number(await page.locator('#meter-left').getAttribute('data-db'));
  const play=async()=>{await page.locator('#monitor-seek').fill('0');await page.locator('#play-button').click();};
  await page.locator('#voice-bypass').check();await play();await expect.poll(level).toBeGreaterThan(-20);await page.locator('#play-button').click();
  await page.locator('#voice-strength').fill('0');await page.locator('#voice-strength').press('Tab');await page.locator('#voice-bypass').uncheck();await play();await expect.poll(level).toBeGreaterThan(-20);
  await page.locator('[data-track-toggle="mute"][data-track="a1"]').click();await expect.poll(level).toBeLessThan(-45);await page.locator('[data-track-toggle="mute"][data-track="a1"]').click();
  await page.locator('[data-track-toggle="solo"][data-track="a2"]').click();await expect.poll(level).toBeLessThan(-45);await page.locator('[data-track-toggle="solo"][data-track="a2"]').click();
  await page.locator('#monitor-seek').fill('0');await page.locator('#voice-strength').fill('100');await page.locator('#voice-strength').press('Tab');
  await page.locator('[data-action="export"]').first().click();await page.locator('#export-resolution').selectOption('.5');const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'Export video',exact:true}).click();const download=await downloading;const path=testInfo.outputPath('voice-isolation.webm');await download.saveAs(path);
  const rms=await page.evaluate(async data=>{const context=new AudioContext(),buffer=await context.decodeAudioData(Uint8Array.from(atob(data),c=>c.charCodeAt(0)).buffer);const levels=[0,1].map(ch=>{const values=buffer.getChannelData(ch).subarray(buffer.sampleRate,buffer.sampleRate*3);return Math.sqrt(values.reduce((s,x)=>s+x*x,0)/values.length);});await context.close();return levels;},(await readFile(path)).toString('base64'));
  expect(rms[0]).toBeLessThan(.04);expect(rms[1]).toBeLessThan(.04);
});

test('unsupported browser and failed model downloads give explicit errors, never fake isolation',async({page})=>{
  await page.goto('/');
  const unsupported=await page.evaluate(async()=>{const saved=window.Worker;window.Worker=undefined;try{const {loadVoiceModel}=await import('/src/voice-isolation.js');await loadVoiceModel();return '';}catch(e){return e.message;}finally{window.Worker=saved;}});expect(unsupported).toContain('WebAssembly and Workers');
  await page.route('**/assets/voice-isolation/*.wasm',route=>route.fulfill({status:503,body:'unavailable'}));
  await page.locator('.timeline-clip.audio').click();await page.locator('[data-library="effects"]').click();await page.locator('[data-preset="Voice Isolation"]').click();
  await expect(page.locator('[data-voice-status]')).toContainText('Error:');await page.locator('#play-button').click();await expect(page.locator('.toast.error').last()).toContainText('model download failed');
  await page.locator('#voice-bypass').check();await page.locator('#play-button').click();await expect(page.locator('#status-text')).toHaveText('Playing sequence');
  await page.locator('#play-button').click();await page.unroute('**/assets/voice-isolation/*.wasm');await page.getByRole('button',{name:'Reset voice isolation',exact:true}).click();await expect(page.locator('[data-voice-status]')).toHaveText('Ready',{timeout:30000});
});

test('embedded audio has smooth dry/wet levels, shared export routing and independent volume/master controls',async({page})=>{
  await page.goto('/');await expect(page.locator('#status-text')).toContainText('Sample project');const fixture=await makeAVFixture(page,true,3);
  const result=await page.evaluate(async data=>{
    const {MediaEngine}=await import('/src/engine.js'),{createProject,createClip}=await import('/src/core.js');
    const blob=new Blob([Uint8Array.from(atob(data),c=>c.charCodeAt(0))],{type:'video/webm'}),url=URL.createObjectURL(blob),asset={id:'v',url,blob,duration:3};
    const p=createProject(),c=createClip({id:'v',type:'video',name:'Embedded',duration:3},'v1');p.clips=[c];c.voiceIsolation={strength:100,bypass:false};
    const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;const errors=[],engine=new MediaEngine(canvas,new Map([['v',asset]]),()=>p,e=>errors.push(e));
    await engine.audioInit();await engine.prepareVoiceEffects();await engine.prepare(0);
    const node=engine.nodes.get(c.id),voice=node.voice,entry=voice.entry;
    const wait=ms=>new Promise(r=>setTimeout(r,ms));
    const level=()=>engine.analysers.map(a=>{const data=new Float32Array(a.fftSize);a.getFloatTimeDomainData(data);return Math.sqrt(data.reduce((s,x)=>s+x*x,0)/data.length);});
    const measure=async()=>{engine.sync(0,true);await wait(600);return level();};
    c.voiceIsolation.strength=0;const dry=await measure();c.voiceIsolation.strength=100;const wet=await measure();c.voiceIsolation.strength=50;const half=await measure();
    const gains=[voice.dry.gain.value,voice.wet.gain.value];c.voiceIsolation.bypass=true;const bypass=await measure();
    c.effects.volume=50;const volume=await measure();engine.setVolume(.4);await wait(150);const master=level();engine.setVolume(.8);c.effects.volume=100;
    c.voiceIsolation.bypass=false;c.voiceIsolation.strength=50;
    c.noiseRemoval={amount:0,mode:'General',bypass:false};const both=await measure();
    const recorder=new MediaRecorder(engine.destination.stream,{mimeType:'audio/webm;codecs=opus'}),chunks=[];
    const done=new Promise(resolve=>{recorder.ondataavailable=e=>chunks.push(e.data);recorder.onstop=resolve;});recorder.start();await wait(600);recorder.stop();await done;
    const decoded=await engine.audio.decodeAudioData(await new Blob(chunks).arrayBuffer());const exported=[0,1].map(ch=>{const d=decoded.getChannelData(ch).subarray(Math.round(decoded.sampleRate*.1));return Math.sqrt(d.reduce((s,x)=>s+x*x,0)/d.length);});
    const stable=voice===node.voice&&entry===engine.voiceCache.get(c,asset),cacheURL=entry.url;
    engine.reset();await engine.audio.close();URL.revokeObjectURL(url);let released=false;try{await fetch(cacheURL);}catch{released=true;}
    return {dry,wet,half,bypass,volume,master,gains,both,exported,stable,released,errors};
  },fixture.buffer.toString('base64'));
  expect(result.errors).toEqual([]);expect(result.stable).toBe(true);expect(result.released).toBe(true);
  for(let ch=0;ch<2;ch++){
    expect(result.dry[ch]).toBeGreaterThan(.03);expect(result.wet[ch]/result.dry[ch]).toBeLessThan(.2);
    expect(result.half[ch]/result.dry[ch]).toBeCloseTo(.5,1);expect(result.bypass[ch]/result.dry[ch]).toBeCloseTo(1,1);
    expect(result.volume[ch]/result.dry[ch]).toBeCloseTo(.5,1);expect(result.master[ch]/result.volume[ch]).toBeCloseTo(.5,1);
    expect(result.exported[ch]/result.both[ch]).toBeGreaterThan(.85);expect(result.exported[ch]/result.both[ch]).toBeLessThan(1.15);
  }
  expect(result.gains[0]).toBeCloseTo(.5,3);expect(result.gains[1]).toBeCloseTo(.5,3);
});

test('oversized sources and Worker failures are reported and cancelled resources are released',async({page})=>{
  await page.goto('/');
  const error=await page.evaluate(async()=>{const {VoiceIsolationCache}=await import('/src/voice-isolation.js');const cache=new VoiceIsolationCache();try{await cache.ensure({assetId:'huge',sourceIn:0,duration:181,speed:1},{blob:new Blob(['fake']),duration:181});return '';}catch(e){return e.message;}finally{cache.clear();}});expect(error).toContain('3 source minutes');
  await page.route('**/src/voice-isolation-worker.js',route=>route.fulfill({status:503,body:'unavailable'}));
  await page.locator('.timeline-clip.audio').click();await page.locator('[data-library="effects"]').click();await page.locator('[data-preset="Voice Isolation"]').click();
  await expect(page.locator('[data-voice-status]')).toContainText('Worker failed',{timeout:30000});
  await page.locator('#voice-bypass').check();await page.locator('#play-button').click();await expect(page.locator('#status-text')).toHaveText('Playing sequence');
});
