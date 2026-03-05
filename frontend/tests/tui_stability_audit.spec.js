import { test, expect } from '@playwright/test';

test.describe('TUI Stability and TrueColor Audit', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('http://localhost:4000');
        await page.waitForTimeout(1000);
    });

    test('Inline TUI stability and TrueColor verification', async ({ page }) => {
        const input = page.locator('.chat-input-wrapper textarea');
        await input.waitFor({ state: 'visible', timeout: 10000 });

        // Python script to simulate TUI:
        // 1. Prints 10 lines of text (Red TrueColor)
        // 2. Sleep to allow first screenshot
        // 3. Clear screen
        // 4. Prints 5 lines of text (Green TrueColor)
        // 5. Sleep to allow second screenshot
        const tuiCommand = "python3 -c \"import sys, time; sys.stdout.write('\\x1b[38;2;255;0;0mLine 1\\nLine 2\\nLine 3\\nLine 4\\nLine 5\\nLine 6\\nLine 7\\nLine 8\\nLine 9\\nLine 10\\x1b[0m\\n'); sys.stdout.flush(); time.sleep(2); sys.stdout.write('\\x1b[H\\x1b[2J\\x1b[38;2;0;255;0mNew Frame 1\\nNew Frame 2\\nNew Frame 3\\nNew Frame 4\\nNew Frame 5\\x1b[0m\\n'); sys.stdout.flush(); time.sleep(2);\"";

        await input.click();
        await input.fill(tuiCommand);
        await input.press('Enter');

        // Wait for the first output (before clear)
        await page.waitForTimeout(1500); 
        await page.screenshot({ path: 'audit_tui_before_clear.png' });

        // Wait for the second output (after clear)
        await page.waitForTimeout(2500);
        await page.screenshot({ path: 'audit_tui_after_clear.png' });
    });
});
