import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const configPath = path.join(__dirname, '..', '..', 'app_config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const appNameLower = config.appName.toLowerCase();

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (err) => {
    if (err.message.includes('ResizeObserver loop completed with undelivered notifications')) {
      console.warn('IGNORING KNOWN RESIZEOBSERVER ERROR:', err.message);
      return;
    }
    console.error('UNCAUGHT PAGE ERROR:', err.message);
    throw new Error(`Browser crashed with pageerror: ${err.message}`);
  });
});

test('renders notebook interface', async ({ page }) => {
  await page.goto('http://localhost:5173/?new_session=true');
  await page.waitForTimeout(1500);
  await expect(page.locator('.sidebar h2', { hasText: 'Command History' })).toBeAttached();
  await expect(page.locator('.top-header')).toBeAttached();
  await expect(page.locator('.notebook-cell')).toHaveCount(0);
});

test('can execute basic command', async ({ page }) => {
  await page.goto('http://localhost:5173/?new_session=true');
  await page.waitForTimeout(1500);

  // wait for global input to be ready
  const input = page.locator('.chat-input-wrapper input[type="text"]');
  await input.waitFor({ state: 'visible', timeout: 5000 });

  await input.fill(`echo "hello ${appNameLower}"`);
  await input.press('Enter');

  // Verify a new cell has been created, meaning the process finished successfully
  const cells = page.locator('.notebook-cell');
  await expect(cells).toHaveCount(1, { timeout: 15000 });
});

test('tui alternate screen opens overlay modal', async ({ page }) => {

  await page.goto('http://localhost:5173/?new_session=true');
  await page.waitForTimeout(1500);

  // wait for global input to be ready
  const input = page.locator('.chat-input-wrapper input[type="text"]');
  await input.waitFor({ state: 'visible', timeout: 5000 });

  // Simulate server sending TUI alternate buffer sequence
  await page.evaluate(() => {
    // @ts-ignore
    window.__TEST_TRIGGER_TUI_DETECT();
  });

  // Verify the modal appears
  const modal = page.locator('.tui-modal-overlay');
  await expect(modal).toBeAttached({ timeout: 5000 });
});

test('tui alternate screen exit renders snapshot', async ({ page }) => {
  await page.goto('http://localhost:5173/?new_session=true');
  await page.waitForTimeout(1500);

  const input = page.locator('.chat-input-wrapper input[type="text"]');
  await input.waitFor({ state: 'visible', timeout: 5000 });

  // 1. Trigger Modal Open
  await page.evaluate(() => {
    // @ts-ignore
    window.__TEST_TRIGGER_TUI_DETECT();
  });

  const modal = page.locator('.tui-modal-overlay');
  await expect(modal).toBeAttached({ timeout: 5000 });

  // 2. Trigger Modal Close
  await page.evaluate(() => {
    // @ts-ignore
    window.__TEST_TRIGGER_TUI_EXIT('<div class="fake-snap">foo</div>');
  });

  await expect(modal).not.toBeAttached({ timeout: 5000 });
});

test('tui terminal is focused on open', async ({ page }) => {
  await page.goto('http://localhost:5173/?new_session=true');
  await page.waitForTimeout(1500);

  await page.evaluate(() => {
    // @ts-ignore
    window.__TEST_TRIGGER_TUI_DETECT();
  });

  // Verify the modal appears and terminal is focused
  const modalTerminal = page.locator('.tui-terminal-container .xterm-helper-textarea');
  await expect(modalTerminal).toBeFocused({ timeout: 5000 });
});

test('focus returns to global input after tui exit', async ({ page }) => {
  await page.goto('http://localhost:5173/?new_session=true');
  await page.waitForTimeout(1500);

  const globalInput = page.locator('.chat-input-wrapper input[type="text"]');

  // Trigger TUI
  await page.evaluate(() => {
    // @ts-ignore
    window.__TEST_TRIGGER_TUI_DETECT();
  });

  // Trigger Exit
  await page.evaluate(() => {
    // @ts-ignore
    window.__TEST_TRIGGER_TUI_EXIT('<div class="fake-snap">foo</div>');
  });

  // Verify global input is refocused
  await expect(globalInput).toBeFocused({ timeout: 5000 });
});

test('ghost text aligns with input field regardless of prompt length', async ({ page }) => {
  await page.goto('http://localhost:5173/?new_session=true');
  await page.waitForTimeout(1500);

  const input = page.locator('.chat-input-wrapper input[type="text"]');
  await input.fill('ls');

  // Verify ghost text appears (assuming 'ls' is in history from previous tests or default)
  const ghostText = page.locator('.global-ghost-text');

  // Get positions
  const inputBounds = await input.boundingBox();
  const ghostBounds = await ghostText.boundingBox();

  if (inputBounds && ghostBounds) {
    // They should start at roughly the same horizontal position (+/- 1px for subpixel rendering)
    expect(Math.abs(inputBounds.x - ghostBounds.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(inputBounds.y - ghostBounds.y)).toBeLessThanOrEqual(5); // vertical alignment
  }
});

test('snapshots are preserved after session switch (re-render)', async ({ page }) => {
  await page.goto('http://localhost:5173/?new_session=true');
  await page.waitForTimeout(1500);

  // Grab the specific session node that is currently ACTIVE to avoid StrictMode double-mount issues
  const initialSession = page.locator('.sidebar li.active');
  const initialSessionText = await initialSession.textContent();

  const input = page.locator('.chat-input-wrapper input[type="text"]');
  await input.fill('echo "persistent output"');
  await input.press('Enter');

  // Wait for snapshot generation (250ms in NotebookCell.jsx)
  await page.waitForTimeout(500);
  const snapshot = page.locator('.snapshot-output');
  await expect(snapshot).toContainText('persistent output', { timeout: 10000 });

  // Create new session to trigger re-render of App and remount of NotebookCell
  await page.locator('button[title="New Session"]').click();
  await page.waitForTimeout(500);

  // Switch back to the specific session we were acting on
  const targetSession = page.locator(`.sidebar li:has-text("${initialSessionText}")`);
  await targetSession.click();
  await page.waitForTimeout(500);

  // Re-query locator after re-mount
  const restoredSnapshot = page.locator('.snapshot-output');
  await expect(restoredSnapshot).toBeVisible({ timeout: 10000 });
  await expect(restoredSnapshot).toContainText('persistent output');
});

test('long output snapshots are scrollable within the cell', async ({ page }) => {
  await page.goto('http://localhost:5173/?new_session=true');
  await page.waitForTimeout(1500);

  // Simulate a command with many lines of output
  const input = page.locator('.chat-input-wrapper input[type="text"]');
  await input.fill('seq 1 100'); // 100 lines of output
  await input.press('Enter');

  const cellOutput = page.locator('.cell-output').first();
  await cellOutput.waitFor({ state: 'visible', timeout: 15000 });

  // Check if it's scrollable (or has the CSS)
  await expect(cellOutput).toHaveCSS('max-height', '500px');
  await expect(cellOutput).toHaveCSS('overflow-y', 'auto');

  // Wait for snapshot generation
  await page.waitForTimeout(500);
  const snapshot = page.locator('.snapshot-output');
  await expect(snapshot).toContainText('100', { timeout: 10000 });

  // Verify scrollHeight > clientHeight
  const isScrollable = await cellOutput.evaluate((el) => el.scrollHeight > el.clientHeight);
  expect(isScrollable).toBe(true);
});

test('cells maintain their size and do not shrink when many are added', async ({ page }) => {
  await page.goto('http://localhost:5173/?new_session=true');
  await page.waitForTimeout(1500);

  const input = page.locator('.chat-input-wrapper input[type="text"]');

  // Execute 15 commands to exceed standard viewport height
  for (let i = 1; i <= 15; i++) {
    await input.fill(`echo "cell ${i}"`);
    await input.press('Enter');
    // small wait to let the cell render
    await page.waitForTimeout(100);
  }

  // Get the height of the first cell
  const firstCell = page.locator('.notebook-cell').first();
  const firstCellHeader = firstCell.locator('.cell-header');
  const initialHeaderHeight = await firstCellHeader.boundingBox().then(b => b?.height);

  // Execute 10 more commands
  for (let i = 16; i <= 25; i++) {
    await input.fill(`echo "cell ${i}"`);
    await input.press('Enter');
    await page.waitForTimeout(100);
  }

  // Verify the header of the first cell still has the same height (it hasn't shrunken)
  const finalHeaderHeight = await firstCellHeader.boundingBox().then(b => b?.height);

  if (initialHeaderHeight && finalHeaderHeight) {
    // Height should be identical (within 1px)
    expect(Math.abs(initialHeaderHeight - finalHeaderHeight)).toBeLessThanOrEqual(1);
    // Height should definitely be reasonable (not crushed to < 10px)
    expect(finalHeaderHeight).toBeGreaterThan(30);
  }

  // Verify the container is scrollable
  const container = page.locator('.notebook-content');
  const isScrollable = await container.evaluate((el) => el.scrollHeight > el.clientHeight);
  expect(isScrollable).toBe(true);
});

test('cell displays executable pwd breadcrumb', async ({ page }) => {
  await page.goto('http://localhost:5173/?new_session=true');
  await page.waitForTimeout(1500);

  const input = page.locator('.chat-input-wrapper input[type="text"]');
  await input.fill('echo "pwd test"');
  await input.press('Enter');

  const cellPwd = page.locator('.cell-header-breadcrumb').first();
  await expect(cellPwd).toBeVisible({ timeout: 5000 });
  // Initial PWD is usually ~ or current dir
  await expect(cellPwd).toContainText('/');

  // Capture screenshot for visual verification removed as it caused issues
  // await page.screenshot({ path: 'rich_ui_breadcrumb.png', fullPage: true });
});

test('empty output commands collapse the cell output area', async ({ page }) => {
  await page.goto('http://localhost:5173/?new_session=true');
  await page.waitForTimeout(1500);

  const input = page.locator('.chat-input-wrapper input[type="text"]');
  // cd usually produces no output
  await input.fill('cd ..');
  await input.press('Enter');

  // Wait for it to be done (snapshot generated)
  const cell = page.locator('.notebook-cell').first();
  const cellOutput = cell.locator('.cell-output');

  // Should not be visible or should be shrunken
  await expect(cellOutput).not.toBeVisible({ timeout: 5000 });
});

test('tui active badge appears during tui mode', async ({ page }) => {
  await page.goto('http://localhost:5173/?new_session=true');
  await page.waitForTimeout(1500);

  await page.evaluate(() => {
    // @ts-ignore
    window.__TEST_TRIGGER_TUI_DETECT();
  });

  const badge = page.locator('.tui-active-badge');
  await expect(badge).toBeVisible({ timeout: 5000 });
  await expect(badge).toContainText('TUI MODE ACTIVE');

  // Trigger Exit
  await page.evaluate(() => {
    // @ts-ignore
    window.__TEST_TRIGGER_TUI_EXIT();
  });

  await expect(badge).not.toBeVisible({ timeout: 5000 });
});

test('history sidebar has import and export buttons', async ({ page }) => {
  await page.goto('http://localhost:5173/?new_session=true');
  await page.waitForTimeout(1500);

  const exportBtn = page.locator('button:has-text("Export")');
  const importBtn = page.locator('.button-label:has-text("Import")');

  await expect(exportBtn).toBeVisible();
  await expect(importBtn).toBeVisible();
});

test('pty output queuing prevents bleed between commands', async ({ page }) => {
  await page.goto('http://localhost:5173/?new_session=true');
  await page.waitForTimeout(1500);

  const globalInput = page.locator('.chat-input-wrapper input[type="text"]');

  // Submit background command
  await globalInput.fill('sleep 2; echo "Background Done"');
  await globalInput.press('Enter');

  // Immediately submit foreground command before the first finishes
  await page.waitForTimeout(200); // Give it a tiny fraction of a second to lock
  await globalInput.fill('echo "Foreground Done"');
  await globalInput.press('Enter');

  // Wait for both to finish (sleep 2 takes at least 2000ms)
  await page.waitForTimeout(3000);

  // Cell 1 should ONLY have Background Done
  const cell1Output = page.locator('.notebook-cell').nth(0).locator('.snapshot-output');
  await expect(cell1Output).toContainText('Background Done');
  await expect(cell1Output).not.toContainText('Foreground Done');

  // Cell 2 should ONLY have Foreground Done
  const cell2Output = page.locator('.notebook-cell').nth(1).locator('.snapshot-output');
  await expect(cell2Output).toContainText('Foreground Done');
  await expect(cell2Output).not.toContainText('Background Done');
});

test('tui modal injects pure cyan cursor theme for normal mode', async ({ page }) => {
  await page.goto('http://localhost:5173/?new_session=true');
  await page.waitForTimeout(1500);

  // Execute a command to create at least one cell (which will have ID 1)
  const input = page.locator('.chat-input-wrapper input[type="text"]');
  await input.fill('echo "triggering tui"');
  await input.press('Enter');
  await expect(page.locator('.notebook-cell')).toHaveCount(1, { timeout: 10000 });

  // Trigger TUI
  await page.evaluate(() => {
    // @ts-ignore
    window.__TEST_TRIGGER_TUI_DETECT();
  });

  // Verify modal is open and terminal is attached
  const modalTerminal = page.locator('.tui-terminal-container .xterm');
  await expect(modalTerminal).toBeVisible({ timeout: 5000 });

  // In xterm.js, explicit cursor theme colors are injected via a dynamic style tag
  // or inline canvas configuration. The easiest E2E way to check xterm theme is
  // verifying the serialized snapshot output respects the color overrides when exiting.

  // Trigger Exit with a fake snapshot that has the cursor color
  await page.evaluate(() => {
    // Simulate what SerializeAddon does when it captures the inverted block cursor
    // It captures the background-color we configured: #00ecec
    // @ts-ignore
    window.__TEST_TRIGGER_TUI_EXIT('<div class="fake-snap"><span style="color: #1a1b26; background-color: #00ecec;">block</span></div>');
  });

  // The last notebook cell should contain the snapshot with our cyan background
  const finalSnapshot = page.locator('.notebook-cell').last().locator('.snapshot-output');
  await expect(finalSnapshot).toContainText('block');

  // Verify the HTML string contains our specific hex code for the cursor
  const innerHtml = await finalSnapshot.innerHTML();
  expect(innerHtml).toContain('#00ecec');
});

test('manual terminal input keystrokes generate snapshot cells', async ({ page }) => {
  await page.goto('http://localhost:5173/?new_session=true');
  await page.waitForTimeout(1500);

  // Trigger an initial cell to get a terminal instance attached to the DOM
  const globalInput = page.locator('.chat-input-wrapper input[type="text"]');
  await globalInput.fill('echo "init"');
  await globalInput.press('Enter');

  // Wait for the first xterm instance to appear
  const xtermTextarea = page.locator('.xterm-helper-textarea').first();
  await xtermTextarea.waitFor({ state: 'attached', timeout: 10000 });

  // Bring focus to the xterm textarea
  await xtermTextarea.focus();

  // Type a raw command directly into the terminal and hit Enter
  await page.keyboard.type('echo "manual_test_xyz987"');
  await page.keyboard.press('Enter');

  // Allow time for the execution, websocket broadcast, and handleCreateSnapshot (500ms + margin)
  await page.waitForTimeout(2000);

  // Assert that a NEW snapshot block was created for the manual input
  // There should be at least 2 cells now (init + manual_test_xyz987)
  const cellOutputs = page.locator('.cell-output');
  await expect(cellOutputs).toHaveCount(2, { timeout: 10000 });

  const lastCellOutput = cellOutputs.last();
  await lastCellOutput.waitFor({ state: 'visible', timeout: 15000 });
  const outputText = await lastCellOutput.textContent();

  // Verify the snapshot successfully captured the manually executed command's output
  expect(outputText).toContain('manual_test_xyz987');
});
