import { test, expect } from '@playwright/test';

test('Master human simulation: ls, nvim, gemini', async ({ page }) => {
    test.setTimeout(300000);
    const tempFile = 'master_sim_test.txt';

    page.on('console', msg => {
        console.log(`[Browser]: ${msg.text()}`);
    });


    await page.goto('http://localhost:4000');
    
    // 1. Start session
    await expect(page.locator('button[title="New Session"]')).toBeVisible({ timeout: 60000 });
    await page.click('button[title="New Session"]');
    await page.waitForTimeout(5000);
    
    const input = page.locator('textarea[placeholder="Enter terminal command..."]');
    await input.waitFor({ state: 'visible', timeout: 10000 });

    // 2. Run 'ls'
    await input.fill('ls');
    await page.keyboard.press('Enter');
    // Wait for the cell to finish (no longer active-cell)
    await page.waitForFunction(() => {
        const cells = document.querySelectorAll('.notebook-cell');
        const lastCell = cells[cells.length - 1];
        return lastCell && !lastCell.classList.contains('active-cell');
    }, { timeout: 30000 });
    await page.screenshot({ path: 'screenshots/master_01_ls.png' });

    // 3. Run 'nvim'
    await input.fill('nvim -u NONE ' + tempFile);
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    const modal = page.locator('.tui-modal-overlay');
    await expect(modal).toBeVisible({ timeout: 20000 });

    await page.waitForTimeout(3000);
    
    // Type in nvim
    // Click modal to ensure focus
    await modal.click();
    await page.keyboard.press('i');
    await page.waitForTimeout(500);
    await page.keyboard.type('Master Simulation Content for TUI Verification');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'screenshots/master_02_nvim_insert.png' });
    
    // Save and Quit
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    await page.keyboard.type(':wq');
    await page.keyboard.press('Enter');

    await expect(modal).not.toBeVisible({ timeout: 20000 });
    await page.waitForTimeout(3000);

    // 4. Run 'gemini'
    await input.fill('gemini');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(10000); // Wait for gemini CLI to load
    
    // Type "hello" to gemini
    // Need to focus the terminal cell for interactive input
    const terminalCell = page.locator('.notebook-cell').last();
    await terminalCell.click();
    await page.waitForTimeout(1000);
    await page.keyboard.type('hello', { delay: 100 });
    await page.keyboard.press('Enter');
    
    // Wait for response
    await page.waitForTimeout(20000); 
    await page.screenshot({ path: 'screenshots/master_03_gemini_response.png' });

    // Exit gemini
    await page.keyboard.press('Control+C');
    await page.waitForTimeout(2000);

    // 5. Final ls to verify file creation
    await input.fill('ls -l ' + tempFile);
    await page.keyboard.press('Enter');
    const finalCell = page.locator('.notebook-cell').last();
    // Wait for completion
    await page.waitForFunction(() => {
        const cells = document.querySelectorAll('.notebook-cell');
        const lastCell = cells[cells.length - 1];
        return lastCell && !lastCell.classList.contains('active-cell');
    }, { timeout: 30000 });
    await expect(finalCell).toContainText(tempFile);
    await page.screenshot({ path: 'screenshots/master_04_ls_final.png' });
});
