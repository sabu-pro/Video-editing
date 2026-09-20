import {test,expect} from '@playwright/test';

test('Remove from Project is contextual, undoable, persistent, and protects used assets',async({page})=>{
  await page.goto('/');await expect(page.locator('.timeline-clip.image').first()).toBeVisible();
  await page.locator('.asset-card').first().click();await page.keyboard.press('Delete');
  await expect(page.locator('.asset-card')).toHaveCount(4);await expect(page.locator('.timeline-clip')).toHaveCount(7);
  await expect(page.locator('.toast').filter({hasText:'used by timeline clips'})).toBeVisible();
  await page.locator('#file-input').setInputFiles({name:'unused.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="red"/></svg>')});
  await expect(page.locator('.asset-card')).toHaveCount(5);
  await page.locator('.asset-card').filter({hasText:'unused.svg'}).click({button:'right'});
  await page.getByRole('button',{name:'Remove from Project',exact:false}).click();await expect(page.locator('.asset-card')).toHaveCount(4);
  await page.keyboard.press('Control+z');await expect(page.locator('.asset-card')).toHaveCount(5);
  await page.locator('.asset-card').filter({hasText:'unused.svg'}).click();await page.keyboard.press('Backspace');await expect(page.locator('.asset-card')).toHaveCount(4);
  await expect(page.locator('#save-status')).toHaveText('Saved locally');await page.reload();await expect(page.locator('.asset-card')).toHaveCount(4);await expect(page.locator('.timeline-clip')).toHaveCount(7);
});
