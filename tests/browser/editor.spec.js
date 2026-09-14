import {test,expect} from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs/promises';

test.beforeEach(async({page})=>{
  await page.goto('/');
  await expect(page.locator('.timeline-clip')).toHaveCount(7,{timeout:30000});
  await expect(page.locator('#status-text')).toContainText('Sample project');
});

test('workspace renders; demo playback, effects, cuts and undo work',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.screenshot({path:'test-results/workspace.png',fullPage:true});
  const dimensions=await page.locator('#preview').boundingBox();expect(dimensions.width).toBeGreaterThan(400);expect(dimensions.height).toBeGreaterThan(200);
  await page.locator('#play-button').click();await expect(page.locator('#status-text')).toHaveText('Playing sequence');
  await page.waitForTimeout(1200);await page.keyboard.press('Space');
  await expect(page.locator('#current-time')).not.toHaveText('00:00:03:15');
  await page.locator('[data-library="effects"]').click();await page.locator('[data-preset="Noir"]').click();
  await expect(page.locator('#effect-grayscale')).toHaveValue('100');
  await page.keyboard.press('Control+z');await expect(page.locator('#effect-grayscale')).toHaveValue('0');
  await page.keyboard.press('Control+k');await expect(page.locator('.timeline-clip')).toHaveCount(8);
  await page.keyboard.press('Control+z');await expect(page.locator('.timeline-clip')).toHaveCount(7);
  await page.keyboard.press('Control+Shift+z');await expect(page.locator('.timeline-clip')).toHaveCount(8);
  expect(errors).toEqual([]);
});

test('titles, keyframes, media import and local restore',async({page})=>{
  await page.keyboard.press('t');await expect(page.locator('.timeline-clip')).toHaveCount(8);
  const textarea=page.getByRole('textbox',{name:'Title text'});await textarea.fill('MY NEXT FILM');await textarea.press('Tab');
  await page.locator('[data-keyframe="scale"]').click();await expect(page.locator('[data-keyframe="scale"]')).toHaveClass(/active/);
  await page.locator('[data-library="media"]').click();
  await page.locator('#file-input').setInputFiles(path.resolve('assets/alpine.jpg'));await expect(page.locator('#asset-count')).toHaveText('5 items',{timeout:30000});
  await expect(page.locator('#save-status')).toHaveText('Saved locally');
  await page.reload();await expect(page.locator('.timeline-clip')).toHaveCount(8);await expect(page.locator('#asset-count')).toHaveText('5 items');
  await page.locator('.timeline-clip.title').filter({hasText:'Title · minimal'}).dblclick();await expect(page.getByRole('textbox',{name:'Title text'})).toHaveValue('MY NEXT FILM');
});

test('clip move, trim, track locks and keyboard deletion',async({page})=>{
  const clip=page.locator('.timeline-clip.image').first();const before=await clip.boundingBox();
  await page.mouse.move(before.x+before.width/2,before.y+25);await page.mouse.down();await page.mouse.move(before.x+before.width/2+50,before.y+25,{steps:8});await page.mouse.up();
  const after=await clip.boundingBox();expect(after.x).toBeGreaterThan(before.x+30);
  await page.keyboard.press('Control+z');
  const edge=clip.locator('[data-edge="right"]');const box=await edge.boundingBox();
  await page.mouse.move(box.x+3,box.y+20);await page.mouse.down();await page.mouse.move(box.x-45,box.y+20,{steps:8});await page.mouse.up();
  const trimmed=await clip.boundingBox();expect(trimmed.width).toBeLessThan(before.width-25);
  await page.keyboard.press('Control+z');
  await page.locator('[data-track-toggle="lock"][data-track="v1"]').click();
  await page.keyboard.press('Delete');await expect(page.locator('.timeline-clip')).toHaveCount(7);
  await page.locator('[data-track-toggle="lock"][data-track="v1"]').click();await page.keyboard.press('Delete');await expect(page.locator('.timeline-clip')).toHaveCount(6);
});

test('portable project saves, opens and retains timeline and media',async({page})=>{
  await page.locator('[data-action="save"]').first().click();
  const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'Save project',exact:true}).last().click();
  const download=await downloading;await download.saveAs('test-results/roundtrip.cutline');
  const saved=JSON.parse(await fs.readFile('test-results/roundtrip.cutline','utf8'));expect(saved.project.clips).toHaveLength(7);expect(saved.assets).toHaveLength(4);expect(saved.assets.every(a=>a.data.startsWith('data:'))).toBeTruthy();
  await page.keyboard.press('Control+a');await page.keyboard.press('Delete');await expect(page.locator('.timeline-clip')).toHaveCount(0);
  await page.locator('#project-input').setInputFiles('test-results/roundtrip.cutline');await expect(page.locator('.timeline-clip')).toHaveCount(7,{timeout:30000});
});

test('PNG snapshot and real video export produce playable downloads',async({page})=>{
  let downloading=page.waitForEvent('download');await page.locator('[data-action="snapshot"]').click();let download=await downloading;await download.saveAs('test-results/frame.png');
  expect((await fs.stat('test-results/frame.png')).size).toBeGreaterThan(100000);
  await page.keyboard.press('Home');await page.keyboard.press('i');await page.keyboard.press('Shift+ArrowRight');await page.keyboard.press('Shift+ArrowRight');await page.keyboard.press('o');
  await page.locator('[data-action="export"]').click();await page.locator('#export-range').selectOption('range');await page.locator('#export-resolution').selectOption('.5');
  downloading=page.waitForEvent('download',{timeout:30000});await page.getByRole('button',{name:'Export video',exact:true}).click();download=await downloading;await download.saveAs('test-results/render.webm');
  expect((await fs.stat('test-results/render.webm')).size).toBeGreaterThan(10000);
  await expect(page.locator('#modal')).not.toBeVisible();
  const result=await page.evaluate(async()=>{
    const response=await fetch('/test-results/render.webm'),blob=await response.blob(),video=document.createElement('video');video.src=URL.createObjectURL(blob);video.muted=true;
    await new Promise((resolve,reject)=>{video.onloadeddata=resolve;video.onerror=reject;});
    await video.play();await new Promise(r=>setTimeout(r,500));video.pause();
    const context=new AudioContext(),buffer=await context.decodeAudioData(await blob.arrayBuffer());const audio=buffer.getChannelData(0);const peak=audio.reduce((max,value)=>Math.max(max,Math.abs(value)),0);await context.close();
    const result={width:video.videoWidth,height:video.videoHeight,time:video.currentTime,duration:video.duration,peak};URL.revokeObjectURL(video.src);return result;
  });
  expect(result.width).toBe(960);expect(result.height).toBe(540);expect(result.time).toBeGreaterThan(.1);expect(result.duration).toBeCloseTo(2,1);expect(result.peak).toBeGreaterThan(.001);
  await page.locator('#file-input').setInputFiles('test-results/render.webm');await expect(page.locator('#asset-count')).toHaveText('5 items',{timeout:30000});
  const card=page.locator('.asset-card').filter({hasText:'render.webm'});await card.dblclick();await page.getByRole('button',{name:'Add to timeline',exact:true}).click();await expect(page.locator('.timeline-clip.video')).toHaveCount(1);
  await page.locator('.timeline-clip.video').click();await page.keyboard.press('Space');await page.waitForTimeout(300);await page.keyboard.press('Space');
  await page.locator('[data-menu="sequence"]').click();await page.locator('[data-action="detach-audio"]').click();await expect(page.locator('.timeline-clip.audio')).toHaveCount(2);
  await page.locator('.timeline-clip.video').click();await page.locator('[data-inspector="audio"]').click();await expect(page.locator('#effect-volume')).toHaveValue('0');
});

test('captions can be imported, edited and exported',async({page})=>{
  const srt='1\n00:00:01,000 --> 00:00:03,000\nWelcome to the mountains.\n\n2\n00:00:04,000 --> 00:00:06,000\nFind a new perspective.\n';
  await page.locator('#captions-input').setInputFiles({name:'captions.srt',mimeType:'application/x-subrip',buffer:Buffer.from(srt)});
  await expect(page.locator('.timeline-clip')).toHaveCount(9);await expect(page.locator('.track-label')).toHaveCount(6);
  const downloading=page.waitForEvent('download');await page.locator('[data-menu="file"]').click();await page.locator('[data-action="export-captions"]').click();const download=await downloading;await download.saveAs('test-results/captions.srt');
  const text=await fs.readFile('test-results/captions.srt','utf8');expect(text).toContain('00:00:01,000 --> 00:00:03,000');expect(text).toContain('Find a new perspective.');
});

test('insert and overwrite selected media edit the sequence',async({page})=>{
  await page.keyboard.press(',');await expect(page.locator('#timeline-duration')).toHaveText('29.00 seconds');
  await page.keyboard.press('Control+z');await expect(page.locator('#timeline-duration')).toHaveText('24.00 seconds');
  await page.keyboard.press('.');await expect(page.locator('#timeline-duration')).toHaveText('24.00 seconds');
  await expect(page.locator('.timeline-clip.image')).toHaveCount(4);
});

test('responsive workspace remains contained',async({page})=>{
  for(const [width,height]of [[1280,800],[900,750],[600,800]]){
    await page.setViewportSize({width,height});
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);expect(overflow).toBeFalsy();
    await page.screenshot({path:`test-results/workspace-${width}.png`,fullPage:true});
  }
  await page.locator('#track-viewport').evaluate(el=>el.scrollTop=80);
  const label=await page.locator('[data-track-label="v1"]').boundingBox(),track=await page.locator('.timeline-track[data-track="v1"]').boundingBox();
  expect(Math.abs(label.y-track.y)).toBeLessThan(1);
});
