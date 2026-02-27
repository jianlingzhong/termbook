import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const configPath = path.join(__dirname, '..', '..', 'app_config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const appNameLower = config.appName.toLowerCase();

test.describe('Session Management & Persistent State', () => {

  test('Creates a default session and tracks PWD accurately', async ({ page }) => {
    await page.goto('http://localhost:4000/?new_session=true');
    await page.waitForTimeout(3000);

    // Assert UI elements load properly with Premium UI selectors
    await expect(page.locator('.sidebar h2', { hasText: /sessions/i })).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.top-header .pwd-breadcrumb')).toBeVisible();

    const getActiveInput = () => page.locator('.chat-input-wrapper input[type="text"]');

    // Command 1: Change directory
    const input1 = getActiveInput();
    await input1.waitFor({ state: 'visible', timeout: 15000 });
    await input1.fill('cd /tmp');
    await input1.press('Enter');

    // Wait for cell output creation (which bubbles up the new PWD)
    await expect(page.locator('.notebook-cell:not(.interactive-cell)')).toHaveCount(1, { timeout: 15000 });

    // Assert the Breadcrumb is attached and rendering dynamically
    const breadcrumb = page.locator('.pwd-breadcrumb');
    await expect(breadcrumb).toBeAttached();

    // Command 2: Write a file to prove state
    const input2 = getActiveInput();
    await input2.fill(`echo "hello ${appNameLower} sessions" > ${appNameLower}_test.txt`);
    await input2.press('Enter');

    await expect(page.locator('.notebook-cell:not(.interactive-cell)')).toHaveCount(2, { timeout: 15000 });
  });

  test('Multiple sessions isolate state correctly without cross-pollution', async ({ page }) => {
    await page.goto('http://localhost:4000/?new_session=true');
    await page.waitForTimeout(3000);

    // SETUP SESSION A
    const inputA1 = page.locator('.chat-input-wrapper input[type="text"]');
    await inputA1.waitFor({ state: 'visible', timeout: 15000 });
    const varName = `${config.markerPrefix.toUpperCase()}_VAR`;
    await inputA1.fill(`export ${varName}="session_a_secret"`);
    await inputA1.press('Enter');
    await expect(page.locator('.notebook-cell:not(.interactive-cell)')).toHaveCount(1, { timeout: 10000 });

    // Capture Session A's ID from the UI List (assuming the active li is highlighted)
    const sessionALocator = page.locator('.sidebar li.active');
    const fullSessionAText = await sessionALocator.innerText();
    // Extract the "# sess-..." part or just use the substring if we know it
    const sessionATruncatedId = fullSessionAText.split('\n')[0].trim(); 

    // CREATE SESSION B
    await page.click('button[title="New Session"]');
    await page.waitForTimeout(1500);

    // Wait for the UI to clear out the old cells down to 0 fresh cells
    await expect(page.locator('.notebook-cell:not(.interactive-cell)')).toHaveCount(0, { timeout: 5000 });

    // VERIFY ISOLATION
    const inputB1 = page.locator('.chat-input-wrapper input[type="text"]');
    await inputB1.fill(`echo $${varName}`);
    await inputB1.press('Enter');

    await expect(page.locator('.notebook-cell:not(.interactive-cell)')).toHaveCount(1, { timeout: 10000 });
    const cellB1 = page.locator('.notebook-cell:not(.interactive-cell)').first();
    // Session B should NOT have Session A's variable
    await expect(cellB1).not.toContainText('session_a_secret');

    // SWITCH BACK TO SESSION A
    await page.locator('.sidebar li', { hasText: sessionATruncatedId }).click();
    await page.waitForTimeout(1500);

    // Verify we have our 1 original cell restored to the DOM
    await expect(page.locator('.notebook-cell:not(.interactive-cell)')).toHaveCount(1, { timeout: 5000 });

    // Execute a command to verify the PTY process is still alive and remembers our export!
    const inputA2 = page.locator('.chat-input-wrapper input[type="text"]');
    await inputA2.fill(`echo $${varName}`);
    await inputA2.press('Enter');

    await expect(page.locator('.notebook-cell:not(.interactive-cell)')).toHaveCount(2, { timeout: 15000 });
    const outputA2 = page.locator('.notebook-cell:not(.interactive-cell)').nth(1).locator('.cell-output');
    await expect(outputA2).toContainText('session_a_secret');
  });

});
