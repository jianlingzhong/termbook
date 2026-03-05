import { test, expect } from '@playwright/test';

test.describe('Nvim Comprehensive Audit', () => {
    test('verify cursor and persistence', async ({ page }) => {
        test.setTimeout(120000);
        const tempFile = 'audit_fix_test.txt';

        await page.goto('http://localhost:4000?new_session=true');
        await page.waitForTimeout(2000);
        await page.screenshot({ path: 'screenshots/audit_01_new_session.png' });

        const input = page.locator('textarea[placeholder="Enter terminal command..."]');
        
        // 2. Initial ls
        await input.fill('ls');
        await input.press('Enter');
        await page.waitForTimeout(3000); // Wait for snapshot
        await page.screenshot({ path: 'screenshots/audit_02_ls_initial.png' });

        // 3. Start nvim
        await input.fill('nvim -u NONE ' + tempFile); 
        await input.press('Enter');
        
        const modal = page.locator('.tui-modal-overlay');
        await expect(modal).toBeVisible({ timeout: 15000 });
        await page.waitForTimeout(3000);

        // 4. Normal Mode Screenshot
        await page.screenshot({ path: 'screenshots/audit_03_nvim_normal.png' });
        
        // 5. Insert Mode
        await page.keyboard.press('i');
        await page.waitForTimeout(500);
        await page.keyboard.type('Persistent Cursor Test Content');
        await page.waitForTimeout(1000);
        await page.screenshot({ path: 'screenshots/audit_04_nvim_insert.png' });

        // 6. Normal Mode Navigation
        await page.keyboard.press('Escape');
        await page.waitForTimeout(1000);
        
        const moves = ['k', 'j', 'h', 'l'];
        for (const key of moves) {
            await page.keyboard.press(key);
            await page.waitForTimeout(500);
            await page.screenshot({ path: `screenshots/audit_05_move_${key}.png` });
        }

        // 7. Save and Quit
        await page.keyboard.press(':');
        await page.waitForTimeout(500);
        await page.keyboard.type('wq');
        await page.keyboard.press('Enter');

        await expect(modal).not.toBeVisible({ timeout: 15000 });
        await page.waitForTimeout(3000);

        // 8. Final ls
        await input.fill('ls');
        await input.press('Enter');
        await page.waitForTimeout(3000);
        await page.screenshot({ path: 'screenshots/audit_06_ls_final.png' });
        
        const lastCell = page.locator('.notebook-cell').last();
        await expect(lastCell).toContainText(tempFile);
    });
});

