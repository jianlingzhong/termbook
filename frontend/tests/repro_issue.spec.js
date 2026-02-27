import { test, expect } from '@playwright/test';

test('repro empty terminal output', async ({ page }) => {
  await page.goto('http://localhost:4000');

  // Wait for session to initialize
  await page.waitForTimeout(1000);

  // Focus input
  await page.click('.terminal-input');

  // Run ls
  await page.keyboard.type('ls');
  await page.keyboard.press('Enter');

  // Wait for output
  await page.waitForTimeout(3000);

  // Capture screenshot for debugging
  await page.screenshot({ path: 'repro_ls.png' });

  // Assert that we can find "package.json" in the output
  // We look for a cell that is NOT active (isRunning=false) and check its content
  const cellOutputs = page.locator('.cell-output');
  const count = await cellOutputs.count();
  console.log(`Found ${count} cells`);

  let found = false;
  for (let i = 0; i < count; i++) {
    const text = await cellOutputs.nth(i).innerText();
    console.log(`Cell ${i} text: ${text}`);
    if (text.includes('package.json')) {
      found = true;
    }
  }

  expect(found).toBe(true);
});

