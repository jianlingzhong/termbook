import { test, expect } from '@playwright/test';

test.describe('Nvim Manual Sequence Audit', () => {
    test('comprehensive lifecycle and cursor visibility', async ({ page }) => {
        test.setTimeout(120000);
        const tempFile = 'audit_final_file_' + Date.now() + '.txt';

        // 1. Start a new session
        await page.goto('http://localhost:4000/?new_session=true');
        await page.waitForTimeout(5000); // Wait for boot

        const input = page.locator('input[placeholder="Enter terminal command..."]');
        await expect(input).toBeVisible({ timeout: 20000 });
        await page.screenshot({ path: 'screenshots/audit_01_session.png' });

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

        // 4. Show cursor in Normal Mode
        await page.screenshot({ path: 'screenshots/audit_03_nvim_normal.png' });
        
        // 5. Insert random text and show cursor in Insert Mode
        await page.keyboard.press('i');
        await page.waitForTimeout(1000);
        await page.keyboard.type('Persistent Cursor Audit Content\nLine 2 for navigation\nLine 3 of data');
        await page.waitForTimeout(1000);
        await page.screenshot({ path: 'screenshots/audit_04_nvim_insert.png' });

        // 6. Press ESC for Normal Mode and Move
        await page.keyboard.press('Escape');
        await page.waitForTimeout(1500);

        // Movement Up
        await page.keyboard.press('k');
        await page.waitForTimeout(1000);
        await page.screenshot({ path: 'screenshots/audit_05_move_up.png' });

        // Movement Down
        await page.keyboard.press('j');
        await page.waitForTimeout(1000);
        await page.screenshot({ path: 'screenshots/audit_05_move_down.png' });

        // Movement Left
        await page.keyboard.press('h');
        await page.waitForTimeout(1000);
        await page.screenshot({ path: 'screenshots/audit_05_move_left.png' });

        // Movement Right
        await page.keyboard.press('l');
        await page.waitForTimeout(1000);
        await page.screenshot({ path: 'screenshots/audit_05_move_right.png' });

        // 7. Quit nvim, saving
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
        
        // Verify file created
        await expect(page.locator('.notebook-content')).toContainText(tempFile);
    });
});

