import { test, expect } from '@playwright/test';

test('cell height should not shrink when content is cleared (High-Water Mark fix)', async ({ page }) => {
  test.setTimeout(60000);
  console.log('Navigating to http://localhost:4000/?new_session=true...');
  await page.goto('/?new_session=true');
  await page.waitForTimeout(2000);
  await page.waitForLoadState('networkidle');

  console.log('Looking for input...');
  const input = page.locator('.chat-input-wrapper input');
  await input.waitFor({ state: 'visible', timeout: 10000 });

  // Command that prints 10 lines, waits, then clears and prints 1 line
  const command = 'seq 1 10; sleep 2; printf "\\033[2J\\033[H"; echo "short"';
  console.log(`Running command: ${command}`);
  await input.fill(command);
  await page.keyboard.press('Enter');

  console.log('Waiting for cell to appear...');
  const cell = page.locator('.notebook-cell').last();
  const cellOutput = cell.locator('.cell-output');
  await cell.waitFor({ state: 'visible', timeout: 10000 });

  // 1. Wait for it to have 10 lines (approx height check) in the output area
  console.log('Waiting for 10 lines of output...');
  // xterm-rows or snapshot-output are inside cell-output
  await expect(cellOutput).toContainText('10', { timeout: 15000 });
  
  const tallHeight = await cellOutput.evaluate((el) => el.getBoundingClientRect().height);
  console.log(`Tall height: ${tallHeight}px`);
  // Each line is ~20px, 10 lines should be ~200px.
  expect(tallHeight).toBeGreaterThan(150);

  // 2. Wait for it to be cleared and print "short"
  console.log('Waiting for output to be cleared and "short" to appear...');
  await expect(cellOutput).toContainText('short', { timeout: 15000 });
  // Verify "10" is gone from the OUTPUT (it will still be in the header command)
  // We use a small delay to ensure xterm.js has updated
  await page.waitForTimeout(1000);
  await expect(cellOutput).not.toContainText('10');

  const shortHeight = await cellOutput.evaluate((el) => el.getBoundingClientRect().height);
  console.log(`Height after clear: ${shortHeight}px`);

  // 3. Verify it didn't shrink significantly (High-Water Mark fix)
  // It should be roughly the same height as before (within 5px)
  expect(shortHeight).toBeGreaterThanOrEqual(tallHeight - 5);
});
