
import { test, expect } from '@playwright/test';

test('nvim definitive cursor audit', async ({ page }) => {
    test.setTimeout(180000);
    const tempFile = 'cursor_fix_verification.txt';

    await page.goto('http://localhost:4000');
    await expect(page.locator('button[title="New Session"]')).toBeVisible({ timeout: 40000 });
    await page.click('button[title="New Session"]');
    await page.waitForTimeout(5000);
    await page.screenshot({ path: 'screenshots/audit_01_start.png' });

    const input = page.locator('textarea[placeholder="Enter terminal command..."]');

    // run ls
    await input.fill('ls');
    await input.press('Enter');
    await page.waitForTimeout(4000);
    await page.screenshot({ path: 'screenshots/audit_02_ls.png' });

    // run nvim
    await input.fill('nvim -u NONE ' + tempFile);
    await input.press('Enter');
    const modal = page.locator('.tui-modal-overlay');
    await expect(modal).toBeVisible({ timeout: 20000 });
    await page.waitForTimeout(5000);

    // Normal Mode (Block)
    await page.screenshot({ path: 'screenshots/audit_03_normal_mode.png' });

    // Insert Mode (Bar)
    await page.keyboard.press('i');
    await page.waitForTimeout(1000);
    await page.keyboard.type('Testing line 1\nTesting line 2');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'screenshots/audit_04_insert_mode.png' });

    // Back to Normal and Move
    await page.keyboard.press('Escape');
    await page.waitForTimeout(2000);

    const moves = ['k', 'j', 'h', 'l'];
    for (const key of moves) {
        await page.keyboard.press(key);
        await page.waitForTimeout(1000);
        await page.screenshot({ path: `screenshots/audit_05_move_${key}.png` });
    }

    // Save and Quit
    await page.keyboard.type(':wq');
    await page.keyboard.press('Enter');
    await expect(modal).not.toBeVisible({ timeout: 20000 });
    await page.waitForTimeout(5000);

    // Final ls
    await input.fill('ls');
    await input.press('Enter');
    await page.waitForTimeout(5000);
    await page.screenshot({ path: 'screenshots/audit_06_ls_final.png' });
});

