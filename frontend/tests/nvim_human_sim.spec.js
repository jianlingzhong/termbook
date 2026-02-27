import { test, expect } from '@playwright/test';

test.describe('Nvim Human Simulation Sequence', () => {
    test('verify nvim lifecycle, cursor visibility, and persistence', async ({ page }) => {
        test.setTimeout(120000);
        const tempFile = 'audit_sim_' + Date.now() + '.txt';

        // 1. Start a new session (Open App)
        await page.goto('http://localhost:4000');
        const input = page.locator('input[placeholder="Enter terminal command..."]');
        await expect(input).toBeVisible({ timeout: 30000 });
        
        // Ensure we are in a fresh session state
        await page.click('button[title="New Session"]');
        await page.waitForTimeout(2000);
        await page.screenshot({ path: 'screenshots/sim_01_session_start.png' });

        // 2. Run "ls"
        await input.fill('ls');
        await input.press('Enter');
        await page.waitForTimeout(3000);
        await page.screenshot({ path: 'screenshots/sim_02_ls_initial.png' });

        // 3. Run "nvim"
        await input.fill('nvim -u NONE');
        await input.press('Enter');
        const modal = page.locator('.tui-modal-overlay');
        await expect(modal).toBeVisible({ timeout: 15000 });
        await page.waitForTimeout(3000);

        // 4. Show cursor in normal mode
        await page.screenshot({ path: 'screenshots/sim_03_nvim_normal.png' });

        // 5. Insert text and show cursor in insert mode
        await page.keyboard.press('i');
        await page.waitForTimeout(1000);
        await page.keyboard.type('Persistent Cursor Simulation Data\nLine 2 for verification\nLine 3 of audit content');
        await page.waitForTimeout(1000);
        await page.screenshot({ path: 'screenshots/sim_04_nvim_insert.png' });

        // 6. Escape to normal mode and move
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
            await page.screenshot({ path: `screenshots/sim_05_${m.name}.png` });
        }

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
        await page.screenshot({ path: 'screenshots/sim_06_ls_final.png' });
        
        // Final verification
        await expect(page.locator('.notebook-content')).toContainText(tempFile);
    });
});

