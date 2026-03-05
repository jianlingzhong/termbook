import { test, expect } from '@playwright/test';

test.describe('Nvim Full Sequence Audit', () => {
    test('verify nvim cursor visibility and persistence through full lifecycle', async ({ page }) => {
        test.setTimeout(120000);
        const tempFile = 'audit_final_test_' + Date.now() + '.txt';

        // 1. Start a new session
        await page.goto('http://localhost:4000?new_session=true');
        await page.waitForTimeout(2000);
        await page.screenshot({ path: 'screenshots/seq_01_new_session.png' });

        const input = page.locator('textarea[placeholder="Enter terminal command..."]');
        
        // 2. Run "ls"
        await input.fill('ls');
        await input.press('Enter');
        await page.waitForTimeout(3000);
        await page.screenshot({ path: 'screenshots/seq_02_ls_initial.png' });

        // 3. Run "nvim"
        await input.fill('nvim -u NONE'); 
        await input.press('Enter');
        
        const modal = page.locator('.tui-modal-overlay');
        await expect(modal).toBeVisible({ timeout: 15000 });
        await page.waitForTimeout(3000);

        // 4. Show cursor in Normal Mode
        await page.screenshot({ path: 'screenshots/seq_03_nvim_normal.png' });
        
        // 5. Insert random text and show cursor in Insert Mode
        await page.keyboard.press('i');
        await page.waitForTimeout(1000);
        await page.keyboard.type('LLM Audit Line 1\nLLM Audit Line 2\nLLM Audit Line 3');
        await page.waitForTimeout(1000);
        await page.screenshot({ path: 'screenshots/seq_04_nvim_insert.png' });

        // 6. Press ESC for Normal Mode and move cursor
        await page.keyboard.press('Escape');
        await page.waitForTimeout(1000);

        // Move Up
        await page.keyboard.press('k');
        await page.waitForTimeout(500);
        await page.screenshot({ path: 'screenshots/seq_05_move_up.png' });

        // Move Down
        await page.keyboard.press('j');
        await page.waitForTimeout(500);
        await page.screenshot({ path: 'screenshots/seq_06_move_down.png' });

        // Move Left
        await page.keyboard.press('h');
        await page.waitForTimeout(500);
        await page.screenshot({ path: 'screenshots/seq_07_move_left.png' });

        // Move Right
        await page.keyboard.press('l');
        await page.waitForTimeout(500);
        await page.screenshot({ path: 'screenshots/seq_08_move_right.png' });

        // 7. Quit nvim, saving to temp file
        await page.keyboard.type(':w ' + tempFile);
        await page.keyboard.press('Enter');
        await page.waitForTimeout(1000);
        await page.keyboard.type(':q');
        await page.keyboard.press('Enter');

        await expect(modal).not.toBeVisible({ timeout: 15000 });
        await page.waitForTimeout(3000);

        // 8. Run "ls" again
        await input.fill('ls');
        await input.press('Enter');
        await page.waitForTimeout(3000);
        await page.screenshot({ path: 'screenshots/seq_09_ls_final.png' });
        
        const lastCell = page.locator('.notebook-cell').last();
        await expect(lastCell).toContainText(tempFile);
    });
});

