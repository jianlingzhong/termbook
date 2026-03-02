import { test, expect } from '@playwright/test';

test('TUI Layout Stability and Logging', async ({ page }, testInfo) => {
  test.setTimeout(60000);
  page.on('console', msg => {
    if (msg.text().includes('[RESIZE_EVENT]') || msg.text().includes('[TUI_DEBUG]')) {
      console.log(`[Browser Console]: ${msg.text()}`);
    }
  });

  await page.goto('http://localhost:4000');

  // Wait for the active session to be initialized
  await page.waitForSelector('.sidebar li.active');

  const input = page.locator('.chat-input-wrapper input');
  await input.waitFor();
  
  // Create a mock gemini node script that correctly uses alternative screen buffer
  // to perfectly emulate the visual behavior of full screen TUI applications
  // that use the terminal's alternate buffer, avoiding the missing PATH/binary issues
  await input.focus();
  await page.keyboard.type('gemini', { delay: 100 });
  await page.waitForTimeout(500);
  await page.keyboard.press('Enter');

  // Wait for the new cell to be created
  await page.waitForSelector('.notebook-cell');
  await page.waitForTimeout(500);

  await page.waitForSelector('.xterm-rows');
  await page.waitForTimeout(4000); // Wait for TUI to load

  const dimensionsLog = [];
  let isInteracting = true;

  // Start a background dimension logger
  const dimensionCheckPromise = (async () => {
    while (isInteracting) {
      const dimensions = await page.evaluate(() => {
        const cell = document.querySelector('.notebook-cell');
        const output = document.querySelector('.cell-output');
        const termRows = window.termData ? window.termData.terminal.rows : -1;
        const termCols = window.termData ? window.termData.terminal.cols : -1;
        return {
          time: Date.now(),
          cellHeight: cell ? cell.getBoundingClientRect().height : -1,
          outputHeight: output ? output.getBoundingClientRect().height : -1,
          termRows,
          termCols
        };
      });
      dimensionsLog.push(dimensions);
      await page.waitForTimeout(100);
    }
  })();

  // 5 rounds of Q&A
  for (let i = 0; i < 5; i++) {
    await page.waitForTimeout(500);
    await page.keyboard.type(`hello ${i}`, { delay: 100 });
    await page.waitForTimeout(500);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(6000); // Wait for response typing
  }

  isInteracting = false;
  await dimensionCheckPromise;
  let stable = true;
  for (let i = 1; i < dimensionsLog.length; i++) {
    const prev = dimensionsLog[i - 1];
    const curr = dimensionsLog[i];
    if (prev.termRows !== curr.termRows || prev.outputHeight !== curr.outputHeight) {
      stable = false;
      console.log('Dimension changed:', prev, curr);
    }
  }

  expect(stable).toBe(true);
});
