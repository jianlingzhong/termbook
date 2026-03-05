import { test, expect } from '@playwright/test';
test('Debug crash', async ({ page }) => {
  page.on('console', msg => console.log('BROWSER_LOG:', msg.text()));
  page.on('pageerror', err => console.log('BROWSER_ERROR:', err.message));
  await page.goto('http://localhost:4000');
  await page.waitForTimeout(5000);
  await page.screenshot({ path: 'test-debug-crash.png', fullPage: true });
});
