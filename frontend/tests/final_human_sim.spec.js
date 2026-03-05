
import { test, expect } from '@playwright/test';

test('nvim full interactive simulation', async ({ page }) => {
    test.setTimeout(240000);
    const tempFile = 'audit_success_final.txt';

    await page.goto('http://localhost:4000');
    await expect(page.locator('button[title="New Session"]')).toBeVisible({ timeout: 60000 });
    await page.click('button[title="New Session"]');
    await page.waitForTimeout(5000);
    await page.screenshot({ path: 'screenshots/step_01_start.png' });

    await page.waitForSelector('textarea[placeholder="Enter terminal command..."]', { state: 'visible', timeout: 5000 });
    await page.fill('textarea[placeholder="Enter terminal command..."]', 'ls');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(4000);
    await page.screenshot({ path: 'screenshots/step_02_ls_initial.png' });

    await page.fill('textarea[placeholder="Enter terminal command..."]', 'nvim -u NONE ' + tempFile);
    await page.keyboard.press('Enter');
    const modal = page.locator('.tui-modal-overlay');
    await expect(modal).toBeVisible({ timeout: 20000 });
    await page.waitForTimeout(5000);

    // 4. Normal Mode cursor
    await page.screenshot({ path: 'screenshots/step_03_nvim_normal.png' });

    // 5. Insert Mode text + cursor
    await page.keyboard.press('i');
    await page.waitForTimeout(1000);
    await page.keyboard.type('Persistent Cursor Audit Data Content\nLine 2 Verification\nLine 3 Verification');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'screenshots/step_04_nvim_insert.png' });

    // 6. Navigation
    await page.keyboard.press('Escape');
    await page.waitForTimeout(2000);

    const moves = ['k', 'j', 'h', 'l'];
    for (const key of moves) {
        await page.keyboard.press(key);
        await page.waitForTimeout(1200);
        await page.screenshot({ path: `screenshots/step_05_move_${key}.png` });
    }

    // 7. Save and Quit
    await page.keyboard.type(':wq');
    await page.keyboard.press('Enter');
    await expect(modal).not.toBeVisible({ timeout: 20000 });
    await page.waitForTimeout(6000);

    // 8. Final ls
    await page.fill('textarea[placeholder="Enter terminal command..."]', 'ls');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(6000);
    await page.screenshot({ path: 'screenshots/step_06_ls_final.png' });
});

