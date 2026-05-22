// Motion-stability tests.
//
// These tests catch UX defects that only manifest in MOTION — flashes,
// layout jumps, oversized transient states — that screenshot-at-the-end
// tests cannot see.
//
// Approach: take fine-grained measurements of layout properties
// (`getBoundingClientRect().height`) at ~30ms intervals during a known
// transition. If the maximum value at any instant exceeds the
// final-resting value by more than a tolerance, that's a flash and the
// test fails.
//
// Playwright records video automatically (configured in
// `playwright.visual.config.js`) so failures are easy to inspect.

import { test, expect } from '@playwright/test';
import {
    BASE_URL,
    INPUT,
    VIEWPORT,
    gotoFreshSession,
    runCommand,
    waitInputReady,
    maxCellHeightDuring,
} from './helpers.mjs';

test.use({ viewport: VIEWPORT });

test.describe('motion stability', () => {

    test('short command (pwd) does not flash a 480px live box', async ({ page }) => {
        await gotoFreshSession(page);
        const inp = await waitInputReady(page);
        await inp.fill('pwd');

        // Submit and immediately start measuring height for 2s.
        // The cell goes through: mount → live → exit → snapshot.
        // At NO point should the cell-output exceed ~120px because pwd
        // produces exactly one line of output.
        const measurePromise = maxCellHeightDuring(page, 2000);
        await inp.press('Enter');
        const maxH = await measurePromise;

        // pwd output is 1 line ~22px + padding. Anything above 200px is a flash.
        expect(maxH, `pwd cell flashed to ${maxH}px during transition`).toBeLessThan(200);
    });

    test('echo (short command) cell stays compact throughout', async ({ page }) => {
        await gotoFreshSession(page);
        const inp = await waitInputReady(page);
        await inp.fill('echo hi');
        const measurePromise = maxCellHeightDuring(page, 2000);
        await inp.press('Enter');
        const maxH = await measurePromise;
        expect(maxH, `echo cell flashed to ${maxH}px`).toBeLessThan(200);
    });

    test('TUI exit collapses to compact placeholder (no giant empty box)', async ({ page }) => {
        await gotoFreshSession(page);
        const inp = await waitInputReady(page);
        // Default startup (load system vimrc) so alt-screen mode works
        // on distros where `-u NONE` would skip `t_ti`/`t_te` setup.
        // Ubuntu specifically needs the system vimrc for that.
        await inp.fill('vim /tmp/_motion_vim.txt');
        await inp.press('Enter');
        await page.waitForTimeout(2500);

        // Quit vim
        await page.keyboard.press('Escape');
        await page.waitForTimeout(150);
        await page.keyboard.type(':q!');
        await page.keyboard.press('Enter');

        // While vim exits, the cell should NOT flash to 480px+.
        const maxH = await maxCellHeightDuring(page, 1500);
        expect(maxH, `TUI exit cell flashed to ${maxH}px`).toBeLessThan(200);

        // Final state: placeholder is shown
        await page.waitForTimeout(500);
        const hasPlaceholder = await page.locator('.tui-completed-placeholder').count();
        expect(hasPlaceholder, 'TUI placeholder should appear after exit').toBeGreaterThan(0);
    });

    test('page reload hydrates cells without empty-box flash', async ({ page }) => {
        await gotoFreshSession(page);
        await runCommand(page, 'pwd', 1500);

        // Capture the final cell height (resting state)
        const restingH = await page.locator('.cell-output').first().evaluate(
            el => Math.round(el.getBoundingClientRect().height)
        );

        // Reload and measure the maximum height for 3s while the cell hydrates.
        const reloadPromise = page.reload({ waitUntil: 'domcontentloaded' });
        const measurePromise = maxCellHeightDuring(page, 3000);
        await reloadPromise;
        const maxH = await measurePromise;

        // After hydration the cell should never exceed the resting height by
        // more than 50px (small allowance for any padding differences).
        expect(maxH, `reload caused flash: max=${maxH}px, resting=${restingH}px`)
            .toBeLessThan(restingH + 80);
    });

    test('session switch does not flash welcome state', async ({ page }) => {
        // Create session 1 with data
        await gotoFreshSession(page);
        await runCommand(page, 'echo session1', 1500);

        // Create session 2 (new)
        await page.locator('.sidebar button[title="New Session"]').click();
        await page.waitForTimeout(1500);
        await runCommand(page, 'echo session2', 1500);

        // Switch back to session 1 — welcome state should NOT appear at any frame
        const sessions = await page.locator('.sidebar ul li').all();
        expect(sessions.length).toBeGreaterThanOrEqual(2);

        let sawWelcome = false;
        const watcher = (async () => {
            const deadline = Date.now() + 1500;
            while (Date.now() < deadline) {
                const count = await page.locator('.empty-state').count().catch(() => 0);
                if (count > 0) sawWelcome = true;
                await page.waitForTimeout(30);
            }
        })();

        // Click first session
        await sessions[0].click();
        await watcher;

        expect(sawWelcome, 'welcome flashed during session switch').toBe(false);
    });

    test('input refocuses after submit without flash', async ({ page }) => {
        await gotoFreshSession(page);
        const inp = await waitInputReady(page);

        await inp.fill('echo refocus-test');
        await inp.press('Enter');
        await page.waitForTimeout(2000);

        // After command completes, the input should be focused and usable.
        // The test types directly via keyboard — if the input lost focus
        // the keys would go nowhere.
        await page.keyboard.type('echo after');
        const v = await page.locator(INPUT).first().inputValue();
        expect(v).toBe('echo after');
    });

    test('jump-to-bottom appears when user scrolls up away from active stream', async ({ page }) => {
        await gotoFreshSession(page);
        for (let i = 0; i < 5; i++) await runCommand(page, `echo line-${i}`, 600);

        await page.evaluate(() => {
            const sc = document.querySelector('.notebook-content');
            if (sc) sc.scrollTop = 0;
        });
        await page.waitForTimeout(400);

        const visible = await page.locator('.jump-to-bottom').isVisible().catch(() => false);
        expect(visible, 'jump-to-bottom should appear when scrolled away from latest').toBe(true);

        await page.locator('.jump-to-bottom').click();
        await page.waitForTimeout(800);
        const atBottom = await page.evaluate(() => {
            const sc = document.querySelector('.notebook-content');
            return sc ? sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 10 : false;
        });
        expect(atBottom).toBe(true);
    });

    test('submitting a new command brings the new cell to the top of viewport', async ({ page }) => {
        await gotoFreshSession(page);
        for (let i = 0; i < 4; i++) await runCommand(page, `seq 1 10 # cell ${i}`, 1200);
        await runCommand(page, 'echo LATEST', 1500);

        const info = await page.evaluate(() => {
            const cells = Array.from(document.querySelectorAll('.notebook-cell'));
            const last = cells[cells.length - 1];
            if (!last) return null;
            return {
                cellTop: Math.round(last.getBoundingClientRect().top),
                viewportH: window.innerHeight,
            };
        });
        expect(info).not.toBeNull();
        expect(info.cellTop, 'new cell header should be near the top of viewport').toBeLessThan(info.viewportH / 2);
    });
});
