import { test, expect } from '@playwright/test';

test.describe('Nvim Comprehensive Visual Audit', () => {
    test('verify nvim lifecycle, cursor visibility, and persistence', async ({ page }) => {
        test.setTimeout(180000); // 3 minutes for slow CI/TUI
        const tempFile = 'audit_verify_' + Date.now() + '.txt';

        // 1. Start a new session
        await page.goto('http://localhost:4000/?new_session=true');
        const input = page.locator('input[placeholder="Enter terminal command..."]');
        await expect(input).toBeVisible({ timeout: 20000 });
        await page.waitForTimeout(2000);
        await page.screenshot({ path: 'screenshots/audit_01_new_session.png' });

        // 2. Run "ls"
        await input.fill('ls');
        await input.press('Enter');
        await page.waitForTimeout(3000);
        await page.screenshot({ path: 'screenshots/audit_02_ls_initial.png' });

        // 3. Run "nvim"
        await input.fill('nvim -u NONE'); 
        await input.press('Enter');
        const modal = page.locator('.tui-modal-overlay');
        await expect(modal).toBeVisible({ timeout: 15000 });
        await page.waitForTimeout(3000);

        // 4. Show cursor in normal mode
        await page.screenshot({ path: 'screenshots/audit_03_nvim_normal.png' });

        // 5. Insert random text and show cursor in insert mode
        await page.keyboard.press('i');
        await page.waitForTimeout(1000);
        await page.keyboard.type('LLM Cursor Audit Line 1\nLLM Cursor Audit Line 2');
        await page.waitForTimeout(1000);
        await page.screenshot({ path: 'screenshots/audit_04_nvim_insert.png' });

        // 6. Press ESC for normal mode, move up, down, left, right
        await page.keyboard.press('Escape');
        await page.waitForTimeout(1500);

        const movements = [
            { key: 'k', name: 'move_up' },
            { key: 'j', name: 'move_down' },
            { key: 'h', name: 'move_left' },
            { key: 'l', name: 'move_right' }
        ];

        for (const m of movements) {
            await page.keyboard.press(m.key);
            await page.waitForTimeout(1000);
            await page.screenshot({ path: `screenshots/audit_05_${m.name}.png` });
        }

        // 7. Quit nvim, saving to temporary file
        await page.keyboard.type(':w ' + tempFile);
        await page.keyboard.press('Enter');
        await page.waitForTimeout(1000);
        await page.keyboard.type(':q');
        await page.keyboard.press('Enter');

        await expect(modal).not.toBeVisible({ timeout: 15000 });
        await page.waitForTimeout(4000);

        // 8. Run "ls" again
        await input.fill('ls');
        await input.press('Enter');
        await page.waitForTimeout(4000);
        await page.screenshot({ path: 'screenshots/audit_06_ls_final.png' });

        // Verify the file exists in the notebook content
        await expect(page.locator('.notebook-content')).toContainText(tempFile);
    });
});

