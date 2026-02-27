import { test, expect } from '@playwright/test';

test.describe('Termbook E2E Verification', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('http://localhost:4000');
        // Wait for connection
        await page.waitForTimeout(1000);
    });

    test('Non-interactive commands (ls, pwd) should render and retian focus', async ({ page }) => {
        // 1. Run 'ls'
        const input = page.getByPlaceholder('Enter terminal command...');
        await input.waitFor({ state: 'visible', timeout: 10000 });

        await input.click();
        await input.fill('ls');
        await input.press('Enter');

        // Wait for output - Wait for at least ONE cell to appear
        const cell = page.locator('.notebook-cell').last();
        await cell.waitFor({ state: 'visible', timeout: 5000 });

        // Verify Output contains "package.json"
        const cellContent = page.locator('.cell-output').last();
        // Wait for content to likely populate
        await expect(cellContent).not.toBeEmpty();
        await expect(cellContent).toContainText('package.json', { timeout: 10000 });

        // Start verify focus is on global input
        await expect(input).toBeFocused();

        // Snapshot
        await page.screenshot({ path: 'e2e_ls_output.png', fullPage: true });

        // 2. Run 'pwd'
        await input.fill('pwd');
        await input.press('Enter');

        // Wait for new cell
        await page.waitForTimeout(500); // graceful wait for new cell creation
        const newCell = page.locator('.notebook-cell').last();
        await expect(newCell).not.toHaveClass(/active-cell/); // Wait for it to finish?
        // Actually, just check text
        const lastContent = page.locator('.cell-output').last();
        await expect(lastContent).toContainText('/termbook', { timeout: 10000 });

        // Verify focus returned to global input
        await expect(input).toBeFocused();

        // Snapshot
        await page.screenshot({ path: 'e2e_pwd_output.png', fullPage: true });
    });

    test('Interactive TUI rendering and focus', async ({ page }) => {
        const input = page.getByPlaceholder('Enter terminal command...');
        await input.waitFor({ state: 'visible', timeout: 10000 });

        // Mimic TUI using python
        const tuiCommand = "python3 -c \"import sys, time; print('\\x1b[?1049h'); sys.stdout.flush(); print('TUI MODE ACTIVE'); sys.stdout.flush(); time.sleep(2); print('\\x1b[?1049l');\"";

        await input.click();
        await input.fill(tuiCommand);
        await input.press('Enter');

        // Wait for TUI activation
        // We look for the cell that entered TUI mode
        // It should have 'xterm-screen' visible and maybe 'active-cell' class
        await page.waitForTimeout(1000);

        // Verify focus is NOT on global input
        await expect(input).not.toBeFocused();

        // Verify TUI content
        const tuiCell = page.locator('.cell-output.live-terminal').last();
        await expect(tuiCell.locator('canvas')).toBeVisible();

        // Snapshot TUI
        await page.screenshot({ path: 'e2e_tui_mode.png' });

        // Wait for TUI to exit (script sleeps 2s)
        await page.waitForTimeout(3000);

        // Verify focus returns to global input after exit
        await expect(input).toBeFocused();
    });
});

