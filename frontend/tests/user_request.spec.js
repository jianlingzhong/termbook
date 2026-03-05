import { test, expect } from '@playwright/test';

test('nvim user requested sequence audit', async ({ page }) => {
    test.setTimeout(180000);
    const tempFile = 'user_request_test.txt';

    // 1. start a new session
    await page.goto('http://localhost:4000');
    await expect(page.locator('button[title="New Session"]')).toBeVisible({ timeout: 30000 });
    await page.click('button[title="New Session"]');
    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'screenshots/user_01_start.png' });

    const input = page.locator('textarea[placeholder="Enter terminal command..."]');
    await expect(input).toBeVisible();

    // 2. run "ls"
    await input.fill('ls');
    await input.press('Enter');
    await page.waitForTimeout(4000);
    await page.screenshot({ path: 'screenshots/user_02_ls_initial.png' });

    // 3. run "nvim"
    await input.fill('nvim -u NONE ' + tempFile);
    await input.press('Enter');
    const modal = page.locator('.tui-modal-overlay');
    await expect(modal).toBeVisible({ timeout: 20000 });
    await page.waitForTimeout(5000);

    // 4. show the cursor in normal mode
    await page.screenshot({ path: 'screenshots/user_03_nvim_normal.png' });

    // 5. insert a few lines of random text and show the cursor in insert mode
    await page.keyboard.press('i');
    await page.waitForTimeout(1000);
    await page.keyboard.type('Line 1: User Request Test\nLine 2: Random text here\nLine 3: Finalizing.');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'screenshots/user_04_nvim_insert.png' });

    // 6. press esc to go back to the normal mode, move the cursor up, down, left, right
    await page.keyboard.press('Escape');
    await page.waitForTimeout(2000);

    // Up
    await page.keyboard.press('k');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'screenshots/user_05_move_up.png' });

    // Down
    await page.keyboard.press('j');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'screenshots/user_06_move_down.png' });

    // Left
    await page.keyboard.press('h');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'screenshots/user_07_move_left.png' });

    // Right
    await page.keyboard.press('l');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'screenshots/user_08_move_right.png' });

    // 7. quit nvim, saving
    await page.keyboard.type(':wq');
    await page.keyboard.press('Enter');
    await expect(modal).not.toBeVisible({ timeout: 20000 });
    await page.waitForTimeout(5000);

    // 8. then run "ls" again
    await input.fill('ls');
    await input.press('Enter');
    await page.waitForTimeout(5000);
    await page.screenshot({ path: 'screenshots/user_09_ls_final.png' });

    await expect(page.locator('.notebook-content')).toContainText(tempFile);
});

