
import { test, expect } from '@playwright/test';

test('nvim comprehensive sequence audit', async ({ page }) => {
    test.setTimeout(180000);
    const tempFile = 'audit_final_check.txt';

    await page.goto('http://localhost:4000');
    await expect(page.locator('button[title="New Session"]')).toBeVisible({ timeout: 40000 });
    await page.click('button[title="New Session"]');
    await page.waitForTimeout(5000);
    await page.screenshot({ path: 'screenshots/audit_01_start.png' });

    const input = page.locator('textarea[placeholder="Enter terminal command..."]');
    await input.fill('ls');
    await input.press('Enter');
    await page.waitForTimeout(4000);
    await page.screenshot({ path: 'screenshots/audit_02_ls_initial.png' });

    await input.fill('nvim -u NONE ' + tempFile);
    await input.press('Enter');
    const modal = page.locator('.tui-modal-overlay');
    await expect(modal).toBeVisible({ timeout: 20000 });
    await page.waitForTimeout(5000);
    await page.screenshot({ path: 'screenshots/audit_03_normal_mode.png' });

    await page.keyboard.press('i');
    await page.waitForTimeout(1000);
    await page.keyboard.type('Persistent Cursor Audit Content\nLine 2 Validation\nLine 3 Verification');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'screenshots/audit_04_insert_mode.png' });

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
    await page.waitForTimeout(5000);

    await input.fill('ls');
    await input.press('Enter');
    await page.waitForTimeout(5000);
    await page.screenshot({ path: 'screenshots/audit_06_ls_final.png' });
});

