
import { test, expect } from '@playwright/test';

test('nvim interactive visual audit', async ({ page }) => {
    test.setTimeout(180000);
    const tempFile = 'audit_verify_' + Date.now() + '.txt';

    await page.goto('http://localhost:4000');
    await page.waitForTimeout(5000);
    const newBtn = page.locator('button[title="New Session"]');
    await expect(newBtn).toBeVisible({ timeout: 30000 });
    await newBtn.click();
    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'screenshots/audit_01_start.png' });

    const input = page.locator('input[placeholder="Enter terminal command..."]');
    await input.fill('ls');
    await input.press('Enter');
    await page.waitForTimeout(3000);
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
    await page.keyboard.type('Persistent Cursor Audit Data Content\nLine 2 for movement test.');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'screenshots/audit_04_nvim_insert.png' });

    // Movement in Normal Mode
    await page.keyboard.press('Escape');
    await page.waitForTimeout(2000);
    await page.keyboard.press('k'); 
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'screenshots/audit_05_move_up.png' });

    await page.keyboard.type(':wq!');
    await page.keyboard.press('Enter');
    await expect(modal).not.toBeVisible({ timeout: 20000 });
    await page.waitForTimeout(5000);

    await input.fill('ls');
    await input.press('Enter');
    await page.waitForTimeout(5000);
    await page.screenshot({ path: 'screenshots/audit_06_ls_final.png' });
});

