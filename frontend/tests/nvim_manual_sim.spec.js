import { test, expect } from '@playwright/test';
import path from 'path';

test.describe('Nvim Manual Simulation Audit', () => {
    test('comprehensive nvim cursor and persistence flow', async ({ page }) => {
        test.setTimeout(90000);
        const tempFile = 'audit_test_file_' + Date.now() + '.txt';

        // 1. Start a new session (Reload ensures fresh state)
        await page.goto('http://localhost:4000?new_session=true');
        await page.waitForTimeout(3000);
        await page.screenshot({ path: 'screenshots/sim_01_new_session.png' });

        const input = page.locator('input[placeholder="Enter terminal command..."]');
        
        // 2. Run "ls"
        await input.fill('ls');
        await input.press('Enter');
        await page.waitForTimeout(2000);
        await page.screenshot({ path: 'screenshots/sim_02_ls_initial.png' });

        // 3. Run "nvim"
        // Using a small delay and explicit focus for the TUI modal
        await input.fill('nvim -u NONE'); // Load without config for speed/predictability
        await input.press('Enter');
        
        const modal = page.locator('.tui-modal-overlay');
        await expect(modal).toBeVisible({ timeout: 10000 });
        await page.waitForTimeout(2000);

        // 4. Show cursor in Normal Mode
        await page.screenshot({ path: 'screenshots/sim_03_nvim_normal.png' });
        
        // 5. Insert random text
        await page.keyboard.press('i');
        await page.waitForTimeout(500);
        await page.keyboard.type('Hello from LLM Audit\nLine 2 of random text\nLine 3');
        await page.waitForTimeout(1000);
        
        // Show cursor in Insert Mode
        await page.screenshot({ path: 'screenshots/sim_04_nvim_insert.png' });

        // 6. Back to Normal Mode and Move Cursor
        await page.keyboard.press('Escape');
        await page.waitForTimeout(1000);
        
        // Move Up
        await page.keyboard.press('k');
        await page.waitForTimeout(500);
        await page.screenshot({ path: 'screenshots/sim_05_move_up.png' });

        // Move Down
        await page.keyboard.press('j');
        await page.waitForTimeout(500);
        await page.screenshot({ path: 'screenshots/sim_06_move_down.png' });

        // Move Left
        await page.keyboard.press('h');
        await page.waitForTimeout(500);
        await page.screenshot({ path: 'screenshots/sim_07_move_left.png' });

        // Move Right
        await page.keyboard.press('l');
        await page.waitForTimeout(500);
        await page.screenshot({ path: 'screenshots/sim_08_move_right.png' });

        // 7. Quit nvim, saving to temp file
        // :w filename then :q
        await page.keyboard.type(':w ' + tempFile);
        await page.keyboard.press('Enter');
        await page.waitForTimeout(1000);
        await page.keyboard.type(':q');
        await page.keyboard.press('Enter');

        await expect(modal).not.toBeVisible({ timeout: 10000 });
        await page.waitForTimeout(2000);

        // 8. Run "ls" again
        await input.fill('ls');
        await input.press('Enter');
        await page.waitForTimeout(2000);
        await page.screenshot({ path: 'screenshots/sim_09_ls_final.png' });
        
        // Verify the file exists in the UI
        const lastCell = page.locator('.notebook-cell').last();
        await expect(lastCell).toContainText(tempFile);
    });
});

