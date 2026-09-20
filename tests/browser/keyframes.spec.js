import {test,expect} from '@playwright/test';
import {sessionProject} from './fixtures.js';
test('keyframes can be selected, moved, eased, deleted and restored with undo',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');await expect(page.locator('.timeline-clip.image').first()).toBeVisible();await page.locator('.timeline-clip.image').first().click();
  await page.locator('#automation-property').selectOption('scale');await page.locator('[data-key-select="0"]').click();
  await page.locator('#keyframe-time').fill('1.11');await page.locator('#keyframe-time').press('Tab');
  await page.locator('#keyframe-interpolation').selectOption('ease-in-out');
  let p=await sessionProject(page),clip=p.clips.find(c=>c.type==='image');expect(clip.keyframes.scale[0].time).toBe(1.1);expect(clip.keyframes.scale[0].interpolation).toBe('ease-in-out');
  await page.getByRole('button',{name:'Delete keyframe',exact:true}).click();await expect(page.locator('[data-key-select]')).toHaveCount(1);
  await page.keyboard.press('Control+z');await expect(page.locator('[data-key-select]')).toHaveCount(2);
  await page.locator('[data-key-nav="1"]').click();expect(errors).toEqual([]);
});
