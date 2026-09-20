import {test,expect} from '@playwright/test';
import {makeAVFixture,blankProject} from './fixtures.js';

test('actual playback honors Solo and Mute while track locking does not silence audio',async({page})=>{
  await page.goto('/');await expect(page.locator('.timeline-clip.image').first()).toBeVisible();
  const fixture=await makeAVFixture(page,true,8);await blankProject(page);
  await page.locator('#file-input').setInputFiles(fixture);await expect(page.locator('.asset-card')).toHaveCount(1);
  await page.locator('.asset-card').dblclick();await page.getByRole('button',{name:'Add to timeline',exact:true}).click();
  const level=()=>page.locator('#meter-left').getAttribute('data-db').then(Number);
  await page.locator('#play-button').click();await expect.poll(level).toBeGreaterThan(-20);
  await page.locator('[data-track-toggle="lock"][data-track="a1"]').click();await expect.poll(level).toBeGreaterThan(-20);
  await page.locator('[data-track-toggle="solo"][data-track="a2"]').click();await expect.poll(level).toBeLessThan(-45);
  await page.locator('[data-track-toggle="solo"][data-track="a1"]').click();await expect.poll(level).toBeGreaterThan(-20);
  await page.locator('[data-track-toggle="mute"][data-track="a1"]').click();await expect.poll(level).toBeLessThan(-45);
  await page.locator('[data-track-toggle="mute"][data-track="a1"]').click();await expect.poll(level).toBeGreaterThan(-20);
});

test('unsupported media reports an error and leaves the editor usable',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');await expect(page.locator('.timeline-clip.image').first()).toBeVisible();
  await page.locator('#file-input').setInputFiles({name:'broken.webm',mimeType:'video/webm',buffer:Buffer.from('invalid media')});
  await expect(page.locator('.toast.error').filter({hasText:'broken.webm'})).toBeVisible();
  await expect(page.locator('.asset-card')).toHaveCount(4);await page.locator('#play-button').click();
  await expect.poll(async()=>Number(await page.locator('#meter-left').getAttribute('data-db'))).toBeGreaterThan(-60);
  expect(errors).toEqual([]);
});
