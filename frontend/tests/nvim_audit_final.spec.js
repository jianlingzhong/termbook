import { test, expect } from '@playwright/test';

test.describe('Nvim Visual Sequence Audit', () => {
    test('verify nvim lifecycle and cursor visibility', async ({ page }) => {
        test.setTimeout(120000);
        const tempFile = 'audit_fix_verification_' + Date.now() + '.txt';

        // 1. Start a new session
        await page.goto('http://localhost:4000/?new_session=true');
        const input = page.locator('input[placeholder="Enter terminal command..."]');
        await expect(input).toBeVisible({ timeout: 20000 });
        await page.waitForTimeout(2000);
        await page.screenshot({ path: 'screenshots/audit_01_session.png' });

        // 2. Run "ls"
        await input.fill('ls');
        await input.press('Enter');
        await page.waitForTimeout(3000);
        await page.screenshot({ path: 'screenshots/audit_02_ls_initial.png' });

        // 3. Run "nvim"
        await input.fill('nvim -u NONE ' + tempFile);
        await input.press('Enter');
        await expect(page.locator('.tui-modal-overlay')).toBeVisible({ timeout: 15000 });
        await page.waitForTimeout(3000);

        // 4. Show cursor in Normal Mode
        await page.screenshot({ path: 'screenshots/audit_03_normal.png' });
        
        // 5. Insert text and show cursor in Insert Mode
        await page.keyboard.press('i');
        await page.waitForTimeout(1000);
        await page.keyboard.type('Nvim Cursor Reliability Test Data');
        await page.keyboard.press('Enter');
        await page.keyboard.type('Moving around...');
        await page.waitForTimeout(1000);
        await page.screenshot({ path: 'screenshots/audit_04_insert.png' });

        // 6. Normal Mode and Move
        await page.keyboard.press('Escape');
        await page.waitForTimeout(1500);

        const keys = ['k', 'j', 'h', 'l'];
        for (const key of keys) {
            await page.keyboard.press(key);
            await page.waitForTimeout(1000);
            await page.screenshot({ path: `screenshots/audit_05_move_${key}.png` });
        }

        // 7. Quit nvim, saving
        await page.keyboard.press(':');
        await page.waitForTimeout(500);
        await page.keyboard.type('wq');
        await page.keyboard.press('Enter');
        await expect(page.locator('.tui-modal-overlay')).not.toBeVisible({ timeout: 15000 });
        await page.waitForTimeout(4000);

        // 8. Run "ls" again
        await input.fill('ls');
        await input.press('Enter');
        await page.waitForTimeout(4000);
        await page.screenshot({ path: 'screenshots/audit_06_ls_final.png' });
        
        // Verify file created
        await expect(page.locator('.notebook-content')).toContainText(tempFile);
    });
});

