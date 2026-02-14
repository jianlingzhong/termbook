import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const configPath = path.join(__dirname, '..', '..', 'app_config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const appNameLower = config.appName.toLowerCase();

test('renders notebook interface', async ({ page }) => {
  await page.goto('http://localhost:5173/');
  await page.waitForTimeout(1500);
  await expect(page.locator('.sidebar h2', { hasText: 'Command History' })).toBeAttached();
  await expect(page.locator('.top-header')).toBeAttached();
  await expect(page.locator('.notebook-cell')).toHaveCount(0);
});

test('can execute basic command', async ({ page }) => {
  await page.goto('http://localhost:5173/');
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

  await page.goto('http://localhost:5173/');
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
  await page.goto('http://localhost:5173/');
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

test('history sidebar has import and export buttons', async ({ page }) => {
  await page.goto('http://localhost:5173/');
  await page.waitForTimeout(1500);

  const exportBtn = page.locator('button', { hasText: 'Export' });
  const importBtn = page.locator('label', { hasText: 'Import' });

  await expect(exportBtn).toBeAttached();
  await expect(importBtn).toBeAttached();
});



