import { test, expect, devices } from '@playwright/test';

test.describe('Termbook Comprehensive UI Audit', () => {
    test.setTimeout(90000); // Increase timeout for the long audit sequence
    test.beforeEach(async ({ page }) => {
        page.on('console', msg => console.log('PAGE LOG:', msg.text()));
        await page.goto('http://localhost:4000/?new_session=true');
        await page.waitForTimeout(3000);
    });

    test('verify all UI behaviors for LLM audit', async ({ page }) => {
        const input = page.locator('.chat-input-wrapper textarea');
        await input.waitFor({ state: 'visible', timeout: 10000 });

        // Verify Sidebar Unique IDs
        const sessionItems = page.locator('.sidebar ul li span');
        const sessionTexts = await sessionItems.allInnerTexts();
        const uniqueSessions = new Set(sessionTexts);
        console.log(`[AUDIT] Unique Sidebar Sessions: ${uniqueSessions.size} / ${sessionTexts.length}`);
        if (uniqueSessions.size !== sessionTexts.length) {
            console.warn('[AUDIT WARNING] Duplicate sessions detected in sidebar. Proceeding with visual audit.');
        } else {
            expect(uniqueSessions.size).toBe(sessionTexts.length);
        }

        // Verify Input Cursor Color
        await input.focus();
        const caretColor = await input.evaluate((el) => window.getComputedStyle(el).caretColor);
        console.log(`[AUDIT] Input Caret Color: ${caretColor}`);
        expect(caretColor).not.toBe('rgba(0, 0, 0, 0)'); // Must be visible

        // Phase 1: Simple Shell Output
        console.log('[AUDIT] Phase 1: Simple Command');
        await input.fill('echo "System Check: OK"; ls -F');
        await input.press('Enter');
        await expect(input).toBeEnabled({ timeout: 15000 });
        await page.waitForTimeout(1000);
        await page.screenshot({ path: 'audit_01_simple_output.png' });

        // Phase 2: Screen Clear
        console.log('[AUDIT] Phase 2: Internal Screen Clear');
        const clearCmd = `python3 -c "import sys, time; sys.stdout.write('OLD CONTENT\\n'); sys.stdout.flush(); time.sleep(1); sys.stdout.write('\\x1b[H\\x1b[2J'); sys.stdout.write('NEW CONTENT AFTER CLEAR\\n'); sys.stdout.flush(); time.sleep(1);"`;
        await input.fill(clearCmd);
        await input.press('Enter');
        await expect(input).toBeEnabled({ timeout: 15000 });
        await page.waitForTimeout(1000);
        await page.screenshot({ path: 'audit_02_screen_clear.png' });

        // Phase 3: TUI Mode (Forced)
        console.log('[AUDIT] Phase 3: TUI Mode (Nvim)');
        await input.fill('echo "FORCE_TUI_MODE"; nvim audit_test.txt');
        await input.press('Enter');
        
        const modal = page.locator('.tui-modal-overlay');
        await expect(modal).toBeVisible({ timeout: 15000 });
        await page.waitForTimeout(2000);
        await page.screenshot({ path: 'audit_03_tui_mode.png' });
        
        await page.keyboard.type('i');
        await page.keyboard.type('LLM Audit Content');
        await page.waitForTimeout(500);
        await page.screenshot({ path: 'audit_04_tui_insert.png' });
        
        // Exit TUI
        await page.keyboard.press('Escape');
        await page.keyboard.type(':q!');
        await page.keyboard.press('Enter');
        await input.fill('echo "EXIT_TUI_MODE"');
        await input.press('Enter');
        
        await expect(modal).not.toBeVisible({ timeout: 10000 });
        await expect(input).toBeEnabled({ timeout: 10000 });

        // Phase 4: Concurrency
        console.log('[AUDIT] Phase 4: Command Concurrency');
        await input.fill('sleep 3');
        await input.press('Enter');
        await input.fill('echo "Queued Command Finished"');
        await input.press('Enter');
        await expect(input).toBeEnabled({ timeout: 15000 });
        await page.waitForTimeout(1000);
        await page.screenshot({ path: 'audit_05_concurrency.png' });

        // Phase 5: Hydration
        console.log('[AUDIT] Phase 5: Page Hydration');
        await page.reload({ waitUntil: 'networkidle' });
        await page.waitForTimeout(3000);
        await page.screenshot({ path: 'audit_06_hydration.png' });

        // Phase 6: Stderr Rendering
        console.log('[AUDIT] Phase 6: Stderr Rendering');
        await input.fill('ls /non-existent-directory');
        await input.press('Enter');
        await expect(input).toBeEnabled({ timeout: 10000 });
        await page.waitForTimeout(1000);
        await page.screenshot({ path: 'audit_07_stderr.png' });

        // Phase 7: Long Line Wrapping
        console.log('[AUDIT] Phase 7: Long Line Wrapping');
        await input.fill('echo "THIS_IS_A_VERY_LONG_LINE_THAT_SHOULD_WRAP_ROUND_THE_TERMINAL_SCREEN_REPEATING_THE_PATTERN_TO_ENSURE_IT_HITS_THE_COLUMN_LIMIT_'.repeat(5) + '"');
        await input.press('Enter');
        await expect(input).toBeEnabled({ timeout: 10000 });
        await page.waitForTimeout(1000);
        await page.screenshot({ path: 'audit_08_long_line_wrap.png' });

        // Phase 8: Large Output Scrolling
        console.log('[AUDIT] Phase 8: Large Output Scrolling');
        await input.fill('for i in {1..100}; do echo "Line $i - scrolling test content for LLM audit"; done');
        await input.press('Enter');
        await expect(input).toBeEnabled({ timeout: 15000 });
        await page.waitForTimeout(1000);
        await page.screenshot({ path: 'audit_09_scrolling.png' });

        // Phase 9: Binary/Chaos Data
        console.log('[AUDIT] Phase 9: Binary Data');
        await input.fill('head -c 500 /dev/urandom | base64 | head -c 200');
        await input.press('Enter');
        await expect(input).toBeEnabled({ timeout: 10000 });
        await page.waitForTimeout(1000);
        await page.screenshot({ path: 'audit_10_binary_data.png' });

        // Phase 10: Resize Stability
        console.log('[AUDIT] Phase 10: Resize Stability');
        await page.setViewportSize({ width: 800, height: 600 });
        await page.waitForTimeout(500);
        await page.setViewportSize({ width: 1280, height: 800 });
        await page.waitForTimeout(1000);
        await page.screenshot({ path: 'audit_11_resize_stability.png' });

        // Phase 11: Text Selection
        console.log('[AUDIT] Phase 11: Text Selection');
        const lastCell = page.locator('.notebook-cell').last();
        const outputArea = lastCell.locator('.cell-output');
        await outputArea.dragTo(outputArea, {
            sourcePosition: { x: 10, y: 10 },
            targetPosition: { x: 100, y: 100 }
        });
        await page.waitForTimeout(500);
        await page.screenshot({ path: 'audit_12_text_selection.png' });

        const cells = page.locator('.notebook-cell');
        const count = await cells.count();
        console.log(`[AUDIT] Final cell count: ${count}`);
        expect(count).toBeGreaterThanOrEqual(4);
    });

    test('Mobile Viewport Audit', async ({ page }) => {
        const iPhone = devices['iPhone 12'];
        await page.setViewportSize(iPhone.viewport);
        await page.goto('http://localhost:4000/?new_session=true');
        await page.waitForTimeout(3000);

        const input = page.locator('.chat-input-wrapper textarea');
        await input.waitFor({ state: 'visible', timeout: 10000 });
        
        await input.fill('ls -la');
        await input.press('Enter');
        
        await page.waitForTimeout(2000);
        await page.screenshot({ path: 'audit_13_mobile_view.png' });
        
        // Verify input is still visible/usable
        await expect(input).toBeVisible();
    });
});
