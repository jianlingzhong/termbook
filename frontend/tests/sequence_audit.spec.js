import { test, expect } from '@playwright/test';

test('nvim lifecycle and cursor audit sequence', async ({ page }) => {
    test.setTimeout(180000);
    const auditFile = 'audit_final_file_' + Date.now() + '.txt';

    // 1. start a new session
    await page.goto('http://localhost:4000');
    await page.waitForTimeout(5000);
    const newBtn = page.locator('button[title="New Session"]');
    await expect(newBtn).toBeVisible({ timeout: 20000 });
    await newBtn.click();
    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'screenshots/audit_01_session.png' });

    const input = page.locator('textarea[placeholder="Enter terminal command..."]');
    await expect(input).toBeVisible();

    // 2. run "ls"
    await input.fill('ls');
    await input.press('Enter');
    await page.waitForTimeout(4000);
    await page.screenshot({ path: 'screenshots/audit_02_ls_initial.png' });

    // 3. run "nvim"
    await input.fill('nvim -u NONE ' + auditFile);
    await input.press('Enter');
    const modal = page.locator('.tui-modal-overlay');
    await expect(modal).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(5000);

    // 4. show the cursor in normal mode
    await page.screenshot({ path: 'screenshots/audit_03_normal_mode.png' });

    // 5. insert text and show cursor in insert mode
    await page.keyboard.press('i');
    await page.waitForTimeout(1000);
    await page.keyboard.type('Persistent Cursor Audit Data Content\nLine 2 Validation\nLine 3 of text');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'screenshots/audit_04_insert_mode.png' });

    // 6. press esc to go back to the normal mode, move the cursor up, down, left, right
    await page.keyboard.press('Escape');
    await page.waitForTimeout(2000);

    const moves = [
        { key: 'k', name: 'move_up' },
        { key: 'j', name: 'move_down' },
        { key: 'h', name: 'move_left' },
        { key: 'l', name: 'move_right' }
    ];

    for (const m of moves) {
        await page.keyboard.press(m.key);
        await page.waitForTimeout(1000);
        await page.screenshot({ path: `screenshots/audit_05_${m.name}.png` });
    }

    // 7. quit nvim, saving
    await page.keyboard.type(':wq');
    await page.keyboard.press('Enter');
    await expect(modal).not.toBeVisible({ timeout: 20000 });
    await page.waitForTimeout(5000);

    // 8. run "ls" again to show file
    await input.fill('ls');
    await input.press('Enter');
    await page.waitForTimeout(5000);
    await page.screenshot({ path: 'screenshots/audit_06_ls_final.png' });
    
    await expect(page.locator('.notebook-content')).toContainText(auditFile);
});

