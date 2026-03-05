import { test, expect } from '@playwright/test';

test('nvim cursor and persistence flow', async ({ page }) => {
    test.setTimeout(120000);
    const tempFile = 'audit_final_' + Date.now() + '.txt';

    // 1. start a new session
    await page.goto('http://localhost:4000');
    await page.waitForTimeout(5000);
    await page.click('button[title="New Session"]');
    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'screenshots/step_01_new_session.png' });

    const input = page.locator('textarea[placeholder="Enter terminal command..."]');
    await expect(input).toBeVisible();

    // 2. run "ls"
    await input.fill('ls');
    await input.press('Enter');
    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'screenshots/step_02_ls_initial.png' });

    // 3. run "nvim"
    await input.fill('nvim -u NONE ' + tempFile);
    await input.press('Enter');
    const modal = page.locator('.tui-modal-overlay');
    await expect(modal).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(3000);

    // 4. show the cursor in normal mode
    await page.screenshot({ path: 'screenshots/step_03_normal_mode.png' });

    // 5. insert a few lines of random text and show the cursor in insert mode
    await page.keyboard.press('i');
    await page.waitForTimeout(1000);
    await page.keyboard.type('Hello World\nRandom line 2\nThird line');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'screenshots/step_04_insert_mode.png' });

    // 6. press esc to go back to the normal mode, move the cursor up, down, left, right
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1500);

    await page.keyboard.press('k'); // up
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'screenshots/step_05_move_up.png' });

    await page.keyboard.press('j'); // down
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'screenshots/step_06_move_down.png' });

    await page.keyboard.press('h'); // left
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'screenshots/step_07_move_left.png' });

    await page.keyboard.press('l'); // right
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'screenshots/step_08_move_right.png' });

    // 7. quite nvim, saving the random test to a temproray file
    await page.keyboard.type(':wq');
    await page.keyboard.press('Enter');
    await expect(modal).not.toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(4000);

    // 8. then run "ls" again to show the newly create temporary is available.
    await input.fill('ls');
    await input.press('Enter');
    await page.waitForTimeout(4000);
    await page.screenshot({ path: 'screenshots/step_09_ls_final.png' });

    await expect(page.locator('.notebook-content')).toContainText(tempFile);
});

