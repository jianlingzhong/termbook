
import { test, expect } from '@playwright/test';

test('nvim interactive sequence audit', async ({ page }) => {
    test.setTimeout(240000);
    const tempFile = 'audit_final_test.txt';

    await page.goto('http://localhost:4000');
    await expect(page.locator('button[title="New Session"]')).toBeVisible({ timeout: 60000 });
    await page.click('button[title="New Session"]');
    await page.waitForTimeout(5000);
    await page.screenshot({ path: 'screenshots/audit_01_start.png' });

    const input = page.locator('input[placeholder="Enter terminal command..."]');
    await input.fill('ls');
    await input.press('Enter');
    await page.waitForTimeout(4000);
    await page.screenshot({ path: 'screenshots/audit_02_ls_initial.png' });

    await input.fill('nvim -u NONE ' + tempFile);
    await input.press('Enter');
    const modal = page.locator('.tui-modal-overlay');
    await expect(modal).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(5000);

    // Normal Mode
    await page.screenshot({ path: 'screenshots/audit_03_nvim_normal.png' });

    // Insert Mode
    await page.keyboard.press('i');
    await page.waitForTimeout(1000);
    await page.keyboard.type('Persistent Cursor Audit Data Content\nLine 2 Verification\nLine 3 Verification');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'screenshots/audit_04_nvim_insert.png' });

    // Escape and Move
    await page.keyboard.press('Escape');
    await page.waitForTimeout(2000);

    const moves = ['k', 'j', 'h', 'l'];
    for (const key of moves) {
        await page.keyboard.press(key);
        await page.waitForTimeout(1200);
        await page.screenshot({ path: `screenshots/audit_05_move_${key}.png` });
    }

    await page.keyboard.type(':wq');
    await page.keyboard.press('Enter');
    await expect(modal).not.toBeVisible({ timeout: 20000 });
    await page.waitForTimeout(6000);

    await input.fill('ls');
    await input.press('Enter');
    await page.waitForTimeout(6000);
    await page.screenshot({ path: 'screenshots/audit_06_ls_final.png' });
});
