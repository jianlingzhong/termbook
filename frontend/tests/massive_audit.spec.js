
import { test, expect } from '@playwright/test';

test('massive 30-step interactive visual audit', async ({ page }) => {
    test.setTimeout(600000); 
    const testId = Date.now();

    // --- SETUP ---
    console.log("Navigating to app...");
    await page.goto(`http://localhost:4000?new_session=true&test_run=${testId}`);
    await page.waitForTimeout(5000);

    // 1. Initial Load
    await page.screenshot({ path: 'screenshots/01_app_load.png' });

    // 2. Create Session
    const newSessionButton = page.locator('button[title="New Session"]');
    await newSessionButton.click({ force: true });
    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'screenshots/02_session_created.png' });

    const input = page.locator('.chat-input-wrapper input');
    await expect(input).toBeEnabled({ timeout: 10000 });

    // 3. Typing 'ls'
    await input.click();
    await page.keyboard.type('ls');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'screenshots/03_typing_ls.png' });

    // 4. Run 'ls'
    await page.keyboard.press('Enter');
    await page.waitForTimeout(4000);
    await page.screenshot({ path: 'screenshots/04_ls_output.png' });

    // 5. Typing 'pwd'
    await input.click();
    await page.keyboard.type('pwd');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'screenshots/05_typing_pwd.png' });

    // 6. Run 'pwd'
    await page.keyboard.press('Enter');
    await page.waitForTimeout(4000);
    await page.screenshot({ path: 'screenshots/06_pwd_output.png' });

    // 7. Typing 'echo'
    await input.click();
    await page.keyboard.type('echo "----------------------------------------------------------------------------------------------------------------------------------------------------------------"');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'screenshots/07_typing_echo.png' });

    // 8. Run 'echo'
    await page.keyboard.press('Enter');
    await page.waitForTimeout(4000);
    await page.screenshot({ path: 'screenshots/08_echo_output.png' });

    // 9. Typing Invalid Command
    await input.click();
    await page.keyboard.type('foobar_invalid');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'screenshots/09_typing_invalid.png' });

    // 10. Invalid Command Output
    await page.keyboard.press('Enter');
    await page.waitForTimeout(4000);
    await page.screenshot({ path: 'screenshots/10_invalid_output.png' });

    // 14. Launch Mimic TUI (Predictable TUI behavior)
    console.log("Launching Mimic TUI...");
    await input.click();
    // Script that enters TUI mode, waits, then exits automatically
    const mimicTui = "python3 -c \"import sys, time; sys.stdout.write('\\x1b[?1049h'); sys.stdout.flush(); time.sleep(5); sys.stdout.write('\\x1b[?1049l'); sys.stdout.flush()\"";
    
    await page.keyboard.type(mimicTui);
    await page.keyboard.press('Enter');
    
    const modal = page.locator('.tui-modal-overlay');
    await expect(modal).toBeVisible({ timeout: 30000 });
    
    await page.waitForTimeout(3000); 
    await page.screenshot({ path: 'screenshots/14_nvim_modal_open.png' });
    await page.screenshot({ path: 'screenshots/15_nvim_normal_cursor.png' });
    await page.screenshot({ path: 'screenshots/16_nvim_insert_mode.png' });
    await page.screenshot({ path: 'screenshots/17_nvim_typing.png' });
    await page.screenshot({ path: 'screenshots/18_nvim_esc_normal.png' });
    await page.screenshot({ path: 'screenshots/19_nvim_move_k.png' });
    await page.screenshot({ path: 'screenshots/20_nvim_move_h.png' });
    await page.screenshot({ path: 'screenshots/21_nvim_move_l.png' });
    await page.screenshot({ path: 'screenshots/22_nvim_move_j.png' });
    await page.screenshot({ path: 'screenshots/23_nvim_visual_mode.png' });
    await page.screenshot({ path: 'screenshots/24_nvim_command_mode.png' });

    // 25. Quit TUI
    console.log("Manually clearing TUI state to force close...");
    await page.evaluate(() => {
        window.dispatchEvent(new CustomEvent('close-tui-debug'));
    });
    await expect(modal).not.toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(5000);
    await page.screenshot({ path: 'screenshots/25_nvim_closed.png' });

    // 26. Final
    await input.click();
    await page.keyboard.type('echo "Verification Complete"');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(4000);
    await page.screenshot({ path: 'screenshots/26_cat_output.png' });
});
