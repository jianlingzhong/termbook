import { test, expect } from '@playwright/test';

test.describe('Nvim Cursor Visual Audit', () => {
    test('verify block vs bar cursor visibility', async ({ page }) => {
        test.setTimeout(60000);
        await page.goto('http://localhost:4000');
        await page.waitForTimeout(2000);

        const input = page.locator('input[placeholder="Enter terminal command..."]');
        await expect(input).toBeVisible();
        
        await input.fill('python3 scripts/reproduce_cursor.py');
        await input.press('Enter');

        await expect(page.locator('.tui-modal-overlay')).toBeVisible({ timeout: 10000 });

        // 1. Audit Normal Mode (Block)
        await page.waitForTimeout(1500); 
        await page.screenshot({ path: 'screenshots/audit_cursor_block.png' });
        
        // 2. Audit Insert Mode (Bar)
        await page.waitForTimeout(3000);
        await page.screenshot({ path: 'screenshots/audit_cursor_bar.png' });
        
        await expect(page.locator('.tui-modal-overlay')).not.toBeVisible({ timeout: 10000 });
    });
});

