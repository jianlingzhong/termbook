import { test, expect } from '@playwright/test';
test('Debug element dump tui', async ({ page }) => {
  page.on('console', msg => console.log('BROWSER_LOG:', msg.text()));
  page.on('pageerror', err => console.log('BROWSER_ERROR:', err.message));
  
  await page.goto('http://localhost:4000');
  
  const input = page.locator('.chat-input-wrapper textarea');
  await input.waitFor({ state: 'visible', timeout: 10000 });
  await input.focus();
  await page.keyboard.type('ls', { delay: 100 });
  await page.keyboard.press('Enter');
  
  await page.waitForTimeout(1000);
});
