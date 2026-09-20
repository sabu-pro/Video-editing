import {test,expect} from '@playwright/test';
import {makeAVFixture,blankProject,sessionProject} from './fixtures.js';
test('embedded stereo audio stays one asset, creates linked V1/A1, and meters real channels',async({page})=>{
  await page.goto('/');await expect(page.locator('.timeline-clip')).toHaveCount(7);const fixture=await makeAVFixture(page);
  await blankProject(page);await page.locator('#file-input').setInputFiles(fixture);await expect(page.locator('#asset-count')).toHaveText('1 items');
  await page.locator('.asset-card').dblclick();await page.getByRole('button',{name:'Add to timeline',exact:true}).click();await expect(page.locator('.timeline-clip')).toHaveCount(2);
  let p=await sessionProject(page);const v=p.clips.find(c=>c.type==='video'),a=p.clips.find(c=>c.type==='audio');expect(v.track).toBe('v1');expect(a.track).toBe('a1');expect(v.linkId).toBe(a.linkId);expect(v.assetId).toBe(a.assetId);expect(v.sourceIn).toBe(a.sourceIn);
  await expect(page.locator('.clip-waveform')).toBeVisible();await page.locator('#play-button').click();await expect.poll(async()=>Number(await page.locator('#meter-left').getAttribute('data-db'))).toBeGreaterThan(-20);
  const left=Number(await page.locator('#meter-left').getAttribute('data-db')),right=Number(await page.locator('#meter-right').getAttribute('data-db'));expect(left-right).toBeGreaterThan(8);await page.keyboard.press('Space');
  await page.locator('[data-menu="sequence"]').click();await page.locator('[data-action="detach-audio"]').click();await expect(page.locator('.timeline-clip')).toHaveCount(2);p=await sessionProject(page);expect(p.clips.every(c=>!c.linkId)).toBeTruthy();
});
test('video-only footage does not invent an audio clip',async({page})=>{
  await page.goto('/');await expect(page.locator('.timeline-clip')).toHaveCount(7);const fixture=await makeAVFixture(page,false,1);
  await blankProject(page);await page.locator('#file-input').setInputFiles(fixture);await expect(page.locator('.asset-card')).toHaveCount(1);await page.locator('.asset-card').dblclick();await page.getByRole('button',{name:'Add to timeline',exact:true}).click();await expect(page.locator('.timeline-clip.video')).toHaveCount(1);await expect(page.locator('.timeline-clip.audio')).toHaveCount(0);
});
test('Ctrl+K uses linked frame-accurate Razor editing',async({page})=>{
  await page.goto('/');await expect(page.locator('.timeline-clip')).toHaveCount(7);const fixture=await makeAVFixture(page);
  await blankProject(page);await page.locator('#file-input').setInputFiles(fixture);await expect(page.locator('#asset-count')).toHaveText('1 items');
  await page.locator('.asset-card').dblclick();await page.getByRole('button',{name:'Add to timeline',exact:true}).click();await expect(page.locator('.timeline-clip')).toHaveCount(2);
  await page.locator('.timeline-clip.video').click();await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowRight');await page.keyboard.press('Control+k');
  await expect(page.locator('.timeline-clip.video')).toHaveCount(2);await expect(page.locator('.timeline-clip.audio')).toHaveCount(2);
  let p=await sessionProject(page);expect(new Set(p.clips.map(c=>c.linkId)).size).toBe(2);
  await page.keyboard.press('Control+z');await expect(page.locator('.timeline-clip')).toHaveCount(2);await page.keyboard.press('Control+Shift+z');await expect(page.locator('.timeline-clip')).toHaveCount(4);
});
