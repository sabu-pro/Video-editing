import {test,expect} from '@playwright/test';
test('track zoom is independent and razor previews an exact frame',async({page})=>{
  await page.goto('/');await expect(page.locator('.timeline-clip')).toHaveCount(7);
  const before=await page.locator('.timeline-clip.image').first().boundingBox();
  await page.locator('#track-zoom').fill('120');await page.locator('#track-zoom').dispatchEvent('input');
  const after=await page.locator('.timeline-clip.image').first().boundingBox();expect(after.width).toBeCloseTo(before.width,1);expect(after.height).toBeGreaterThan(before.height+50);
  const label=await page.locator('[data-track-label="v1"]').boundingBox(),track=await page.locator('.timeline-track[data-track="v1"]').boundingBox();expect(label.y).toBeCloseTo(track.y,1);expect(label.height).toBe(120);
  await page.locator('[data-tool="razor"]').click();await page.locator('.timeline-clip.image').first().hover();await expect(page.locator('#razor-guide')).toBeVisible();
  const cutText=await page.locator('#razor-guide span').textContent();expect(cutText).toMatch(/^\d{2}:\d{2}:\d{2}:\d{2}$/);
  await page.locator('.timeline-clip.image').first().click();await expect(page.locator('.timeline-clip')).toHaveCount(8);await page.keyboard.press('Control+z');await expect(page.locator('.timeline-clip')).toHaveCount(7);
});
