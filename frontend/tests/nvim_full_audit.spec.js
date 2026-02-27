import { test, expect } from '@playwright/test';

test.describe('Nvim Sequential Visual Audit', () => {
    test('comprehensive nvim cursor and persistence lifecycle', async ({ page }) => {
        test.setTimeout(180000);
        const tempFile = 'audit_verify_file.txt';

        // 1. Start a new session
        await page.goto('http://localhost:4000');
        await page.waitForTimeout(5000);
        const newSessionBtn = page.locator('button[title="New Session"]');
        await expect(newSessionBtn).toBeVisible({ timeout: 20000 });
        await newSessionBtn.click();
        await page.waitForTimeout(3000);
        await page.screenshot({ path: 'screenshots/nvim_01_new_session.png' });

        const input = page.locator('input[placeholder="Enter terminal command..."]');

        // 2. run "ls"
        await input.fill('ls');
        await input.press('Enter');
        await page.waitForTimeout(3000);
        await page.screenshot({ path: 'screenshots/nvim_02_ls_initial.png' });

        // 3. run "nvim"
        await input.fill('nvim -u NONE ' + tempFile);
        await input.press('Enter');
        const modal = page.locator('.tui-modal-overlay');
        await expect(modal).toBeVisible({ timeout: 15000 });
        await page.waitForTimeout(4000);

        // 4. show the cursor in normal mode
        await page.screenshot({ path: 'screenshots/nvim_03_normal_mode.png' });

        // 5. insert text and show cursor in insert mode
        await page.keyboard.press('i');
        await page.waitForTimeout(1000);
        await page.keyboard.type('Nvim Visual Audit: Line 1\nNvim Visual Audit: Line 2');
        await page.waitForTimeout(1000);
        await page.screenshot({ path: 'screenshots/nvim_04_insert_mode.png' });

        // 6. press esc to go back to normal mode, move up, down, left, right
        await page.keyboard.press('Escape');
        await page.waitForTimeout(2000);

        const movements = [
            { key: 'k', name: 'up' },
            { key: 'j', name: 'down' },
            { key: 'h', name: 'left' },
            { key: 'l', name: 'right' }
        ];

        for (const m of movements) {
            await page.keyboard.press(m.key);
            await page.waitForTimeout(1200);
            await page.screenshot({ path: `screenshots/nvim_05_move_${m.name}.png` });
        }

        // 7. quit nvim, saving
        await page.keyboard.press(':');
        await page.waitForTimeout(500);
        await page.keyboard.type('wq');
        await page.keyboard.press('Enter');
        await expect(modal).not.toBeVisible({ timeout: 20000 });
        await page.waitForTimeout(5000);

        // 8. run "ls" again to show file
        await input.fill('ls');
        await input.press('Enter');
        await page.waitForTimeout(4000);
        await page.screenshot({ path: 'screenshots/nvim_06_ls_final.png' });

        await expect(page.locator('.notebook-content')).toContainText(tempFile);
    });
});

