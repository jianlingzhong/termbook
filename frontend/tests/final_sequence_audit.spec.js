import { test, expect } from '@playwright/test';

test('nvim comprehensive sequence audit', async ({ page }) => {
    test.setTimeout(180000);
    const tempFile = 'audit_verify_' + Date.now() + '.txt';

    // 1. start session
    await page.goto('http://localhost:4000');
    await page.waitForTimeout(5000);
    
    // Use the New Session button for a clean slate
    const newSessionBtn = page.locator('button[title="New Session"]');
    await expect(newSessionBtn).toBeVisible({ timeout: 30000 });
    await newSessionBtn.click();
    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'screenshots/audit_01_start.png' });

    const input = page.locator('textarea[placeholder="Enter terminal command..."]');
    await expect(input).toBeVisible();

    // 2. run "ls"
    await input.fill('ls');
    await input.press('Enter');
    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'screenshots/audit_02_ls_initial.png' });

    // 3. run "nvim"
    await input.fill('nvim -u NONE ' + tempFile);
    await input.press('Enter');
    const modal = page.locator('.tui-modal-overlay');
    await expect(modal).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(5000);

    // 4. show the cursor in normal mode
    await page.screenshot({ path: 'screenshots/audit_03_normal_mode.png' });

    // 5. insert text and show cursor in insert mode
    await page.keyboard.press('i');
    await page.waitForTimeout(1000);
    await page.keyboard.type('Persistent Cursor Audit Data Content\nLine 2 Verification\nLine 3 of text');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'screenshots/audit_04_insert_mode.png' });

    // 6. press esc to go back to the normal mode, move the cursor up, down, left, right
    await page.keyboard.press('Escape');
    await page.waitForTimeout(2000);

    // Move Up
    await page.keyboard.press('k');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'screenshots/audit_05_move_up.png' });

    // Move Down
    await page.keyboard.press('j');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'screenshots/audit_06_move_down.png' });

    // Move Left
    await page.keyboard.press('h');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'screenshots/audit_07_move_left.png' });

    // Move Right
    await page.keyboard.press('l');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'screenshots/audit_08_move_right.png' });

    // 7. quit nvim, saving
    await page.keyboard.type(':wq');
    await page.keyboard.press('Enter');
    await expect(modal).not.toBeVisible({ timeout: 20000 });
    await page.waitForTimeout(5000);

    // 8. run "ls" again to show file
    await input.fill('ls');
    await input.press('Enter');
    await page.waitForTimeout(5000);
    await page.screenshot({ path: 'screenshots/audit_09_ls_final.png' });
    
    await expect(page.locator('.notebook-content')).toContainText(tempFile);
});

