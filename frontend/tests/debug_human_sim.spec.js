import { test, expect } from '@playwright/test';
test('Debug human sim', async ({ page }) => {
  await page.goto('http://localhost:4000');
  await expect(page.locator('button[title="New Session"]')).toBeVisible({ timeout: 10000 });
  await page.click('button[title="New Session"]');
  
  await page.waitForSelector('textarea[placeholder="Enter terminal command..."]', { state: 'visible', timeout: 5000 });
  await page.fill('textarea[placeholder="Enter terminal command..."]', 'ls');
  await page.keyboard.press('Enter');
  
  await page.waitForTimeout(4000);
});
