import { test, expect } from '@playwright/test';

test('UI Layout and Auto-Grow Terminal', async ({ page }) => {
  // Navigate to app
  await page.goto('http://localhost:4000');

  // Wait for initial load
  // Initially, there might be NO cells if session is new and empty.
  // The 'manual-input' cell should NOT exist.
  const ghostCell = page.locator('#manual-input');
  await expect(ghostCell).not.toBeVisible();

  // 1. Verify Global Input is available
  const input = page.locator('textarea[placeholder="Enter terminal command..."]');
  await expect(input).toBeVisible();

  // 2. Trigger a command to create a cell
  // Send a command that produces output
  await input.fill('seq 1 50');
  await input.press('Enter');

  // Wait for a cell to appear with output
  const lastCell = page.locator('.notebook-cell').last();
  await expect(lastCell).toBeVisible();

  // Now we can check for terminal
  const terminalScreen = lastCell.locator('.xterm-screen');
  await expect(terminalScreen).toBeVisible();

  // Wait for output to likely finish (or at least render significantly)
  await page.waitForTimeout(1000);

  // Check height
  const box = await terminalScreen.boundingBox();
  expect(box).not.toBeNull();

  // 50 lines * ~18px/line should be > 500px easily.
  // Standard terminal minimal height is often ~100-200px.
  expect(box.height).toBeGreaterThan(500);

  // Verify no scrollbar on the *container* if auto-height is working correctly
  // The xterm-viewport often handles scrolling, but we want the container to fit the viewport.
  // This is a bit tricky to test reliably without strict DOM access, but we can check if viewport height ~= screen height
  const viewport = lastCell.locator('.xterm-viewport');
  const viewportBox = await viewport.boundingBox();

  // Allow small margin of error/scrollbar width
  expect(Math.abs(viewportBox.height - box.height)).toBeLessThan(20);
});

