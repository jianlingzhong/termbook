import { test, expect } from '@playwright/test';

test.describe('Debug Snapshot', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('http://localhost:4000');
        await page.waitForTimeout(1000);
    });

    test('Dump raw HTML of snapshot', async ({ page }) => {
        const input = page.locator('.chat-input-wrapper input');
        await input.waitFor({ state: 'visible', timeout: 10000 });

        const tuiCommand = `python3 -c "import sys, time; sys.stdout.write('\\x1b[2J\\x1b[H'); sys.stdout.flush(); [sys.stdout.write('\\x1b[H=== GEMINI TUI HEADER ===\\n' + '\\n'.join([f'Content line {i}' for i in range(10)]) + '\\n=== GEMINI TUI FOOTER ===\\n') or sys.stdout.flush() or time.sleep(0.5) for _ in range(5)]"`;

        await input.click();
        await input.fill(tuiCommand);
        await input.press('Enter');

        await page.waitForTimeout(4000);
        
        const snapshot = page.locator('.notebook-cell').last().locator('.snapshot-output');
        await snapshot.waitFor({ state: 'visible', timeout: 10000 });

        const html = await snapshot.innerHTML();
        console.log("RAW HTML:\n", html);
    });
});
