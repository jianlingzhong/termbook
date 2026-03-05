import { test, expect } from '@playwright/test';
test('Debug focus', async ({ page }) => {
  await page.goto('http://localhost:4000');
  await page.click('button[title="New Session"]');
  const input = page.locator('textarea[placeholder="Enter terminal command..."]');
  await input.waitFor({ state: 'visible', timeout: 5000 });
  await page.waitForTimeout(1000); // Give React time to re-render
  await page.keyboard.type('nvim -u NONE temp.txt');
  await page.keyboard.press('Enter');
  
  await page.waitForTimeout(3000);
  const activeElementTag = await page.evaluate(() => document.activeElement.tagName);
  const activeElementClass = await page.evaluate(() => document.activeElement.className);
  console.log("ACTIVE TAG:", activeElementTag, "CLASS:", activeElementClass);
  await page.keyboard.type(':q!');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2000);
});
