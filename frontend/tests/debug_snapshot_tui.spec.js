import { test, expect } from '@playwright/test';
test('Debug element dump tui', async ({ page }) => {
  page.on('console', msg => console.log('BROWSER_LOG:', msg.text()));
  page.on('pageerror', err => console.log('BROWSER_ERROR:', err.message));
  
  await page.goto('http://localhost:4000');
  
  const input = page.locator('.chat-input-wrapper textarea');
  await input.waitFor({ state: 'visible', timeout: 10000 });
  await input.focus();
  const tuiCommand = "python3 -c \"import sys, time; print('\\x1b[?1049h'); sys.stdout.flush(); print('TUI MODE ACTIVE'); sys.stdout.flush(); time.sleep(2); print('\\x1b[?1049l');\"";
  await page.keyboard.type(tuiCommand, { delay: 10 });
  await page.keyboard.press('Enter');
  
  await page.waitForTimeout(1000);
});
