import { test, expect } from '@playwright/test';

test.describe('Nvim Cursor Verification', () => {
    test('cursor visibility in TUI modes', async ({ page }) => {
        await page.goto('http://localhost:4000');
        await page.waitForTimeout(1000);

        const input = page.getByPlaceholder('Enter terminal command...');
        
        // Execute the reproduction script
        await input.fill('python3 scripts/reproduce_cursor.py');
        await input.press('Enter');

        // Wait for TUI Modal
        await expect(page.locator('.tui-modal-overlay')).toBeVisible({ timeout: 5000 });
        
        // 1. Check Normal Mode (Block)
        await page.waitForTimeout(1500); // Wait for script to display block message
        await page.screenshot({ path: 'screenshots/cursor_01_block.png' });
        
        // We look for the cursor element in xterm.js
        const cursor = page.locator('.xterm-cursor');
        await expect(cursor).toBeVisible();

        // 2. Check Insert Mode (Bar)
        await page.waitForTimeout(3000); // Wait for script to switch to bar
        await page.screenshot({ path: 'screenshots/cursor_02_bar.png' });
        await expect(cursor).toBeVisible();
        
        // Wait for exit
        await expect(page.locator('.tui-modal-overlay')).not.toBeVisible({ timeout: 5000 });
    });
});

