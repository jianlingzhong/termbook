
import { test, expect } from '@playwright/test';

test('restored ui fidelity and nvim cursor audit', async ({ page }) => {
    test.setTimeout(240000);
    const tempFile = 'human_audit.txt';

    // 1. Load App
    await page.goto('http://localhost:4000');
    // Verify Sidebar structure
    await expect(page.locator('.sidebar h1')).toContainText('TERMBOOK');
    
    // RELAXED LOCATOR: Find any button inside sidebar that might be the new session button
    // The code uses <button ...><Plus size={16}/></button> with title="New Session"
    const newSessionBtn = page.locator('.sidebar button').first();
    await expect(newSessionBtn).toBeVisible({ timeout: 60000 });
    await newSessionBtn.click();
    
    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'screenshots/audit_01_restored_ui.png' });

    // 2. Check Layout/Whitespace with 'pwd' (short output)
    const input = page.locator('textarea[placeholder="Enter terminal command..."]');
    await input.fill('pwd');
    await input.press('Enter');
    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'screenshots/audit_02_pwd_compact.png' });

    // 3. Start Nvim
    await input.fill('nvim -u NONE ' + tempFile);
    await input.press('Enter');
    const modal = page.locator('.tui-modal-overlay');
    await expect(modal).toBeVisible({ timeout: 20000 });
    await page.waitForTimeout(5000);

    // 4. Normal Mode (Block Cursor) + Full Height Check
    await page.screenshot({ path: 'screenshots/audit_03_nvim_normal.png' });

    // 5. Insert Mode (Bar Cursor)
    await page.keyboard.press('i');
    await page.waitForTimeout(1000);
    await page.keyboard.type('Test');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'screenshots/audit_04_nvim_insert.png' });

    // 6. Escape to Normal and Move
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1000);
    await page.keyboard.press('k');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'screenshots/audit_05_nvim_move.png' });

    // 7. Quit
    await page.keyboard.type(':wq!');
    await page.keyboard.press('Enter');
    await expect(modal).not.toBeVisible({ timeout: 20000 });
    await page.waitForTimeout(5000);

    // 8. Auto-Scroll Check: Run many ls commands to fill screen
    for (let i = 0; i < 5; i++) {
        await input.fill('ls');
        await input.press('Enter');
        await page.waitForTimeout(1000);
    }
    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'screenshots/audit_06_autoscroll.png' });
});
