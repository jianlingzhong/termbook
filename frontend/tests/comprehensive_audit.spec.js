import { test, expect } from '@playwright/test';

test('comprehensive nvim lifecycle audit', async ({ page }) => {
    test.setTimeout(180000);
    const tempFile = 'audit_success_check.txt';

    // 1. start a new session
    await page.goto('http://localhost:4000');
    await expect(page.locator('button[title="New Session"]')).toBeVisible({ timeout: 30000 });
    await page.click('button[title="New Session"]');
    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'screenshots/audit_01_start.png' });

    const input = page.locator('input[placeholder="Enter terminal command..."]');
    await expect(input).toBeVisible();

    // 2. run "ls"
    await input.fill('ls');
    await input.press('Enter');
    await page.waitForTimeout(4000);
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
    await page.keyboard.type('Persistent Cursor Audit Content\nLine 2 Verification\nLine 3 Verification');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'screenshots/audit_04_insert_mode.png' });

    // 6. press esc to go back to the normal mode, move the cursor up, down, left, right
    await page.keyboard.press('Escape');
    await page.waitForTimeout(2000);

    await page.keyboard.press('k'); // up
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'screenshots/audit_05_move_up.png' });

    await page.keyboard.press('j'); // down
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'screenshots/audit_06_move_down.png' });

    await page.keyboard.press('h'); // left
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'screenshots/audit_07_move_left.png' });

    await page.keyboard.press('l'); // right
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'screenshots/audit_08_move_right.png' });

    // 7. quit nvim, saving
    await page.keyboard.type(':wq');
    await page.keyboard.press('Enter');
    await expect(modal).not.toBeVisible({ timeout: 20000 });
    await page.waitForTimeout(5000);

    // 8. run "ls" again
    await input.fill('ls');
    await input.press('Enter');
    await page.waitForTimeout(5000);
    await page.screenshot({ path: 'screenshots/audit_09_ls_final.png' });
    
    await expect(page.locator('.notebook-content')).toContainText(tempFile);
});

