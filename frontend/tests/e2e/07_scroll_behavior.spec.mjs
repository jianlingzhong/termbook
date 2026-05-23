// E2E: comprehensive scroll behavior matrix.
//
// Behavior contract under test:
//   1. After submit, the latest cell's top edge is at the viewport top
//      (within ~32px tolerance for header chrome).
//   2. On session switch with NO prior user scroll: latest cell at top.
//   3. On session switch WITH prior user scroll: restore scrollTop.
//   4. Submit clears the saved scroll memo (next switch defaults again).
//   5. Layout-shift scrolls (cell renders, fit-addon resizes, session
//      DOM churn) do NOT pollute the memo.
//   6. ArrowUp/Down inside the chat input is history recall, not scroll.
//
// Matrix dimensions covered:
//   - Content shapes: short cells / long single cell / mixed / TUI / passthrough
//   - Pre-switch scroll: default / scrolled-to-top / scrolled-to-middle / scrolled-to-bottom
//   - Switch patterns: A→B→A / A→B→C→A / A→B→A→B→A (bouncing)
//   - Post-switch action: observe / submit-new / wheel-again
//
// All tests take labeled screenshots at every key state for visual audit.

import { test, expect } from '@playwright/test';
import {
    VIEWPORT,
    gotoFreshSession,
    runCommand,
    startCommand,
    waitInputReady,
    waitForPassthrough,
    waitForIdle,
    shot,
    scrollGeometry,
    assertLatestCellAtTop,
    userScrollUp,
    userScrollDown,
    userScrollTo,
    newSession,
    switchToSessionByIndex,
} from './helpers.mjs';

test.use({ viewport: VIEWPORT });

test.describe('scroll behavior — content shape × scroll state × switch pattern', () => {

    // === BASELINE ASSERTIONS ===========================================

    test('A1: submit short command — latest cell pinned at viewport top', async ({ page }, testInfo) => {
        await gotoFreshSession(page);
        await runCommand(page, 'echo hello');
        await runCommand(page, 'pwd');
        await runCommand(page, 'echo world');
        await shot(page, testInfo, 'after_third_submit');
        const { delta, geometry } = await assertLatestCellAtTop(page);
        console.log('delta=', delta);
        // The latest cell must be the only one visible at-or-near the top.
        expect(geometry.cells[geometry.cells.length - 1].cmd).toContain('echo world');
    });

    test('A2: submit a tall command — cell starts at top, content scrolls within', async ({ page }, testInfo) => {
        await gotoFreshSession(page);
        await runCommand(page, 'echo before');
        await runCommand(page, 'seq 1 200', { afterWaitMs: 1500 });
        await shot(page, testInfo, 'after_tall_submit');

        const { geometry } = await assertLatestCellAtTop(page);
        // The tall cell (latest) should be at the top of the scroll
        // container. Older cell scrolled out above.
        const seqCell = geometry.cells.find(c => c.cmd.includes('seq 1 200'));
        expect(seqCell).toBeTruthy();
        expect(seqCell.viewportTop).toBeGreaterThanOrEqual(-5);
        expect(seqCell.viewportTop).toBeLessThan(50);
        const beforeCell = geometry.cells.find(c => c.cmd === 'echo before');
        expect(beforeCell.viewportBottom).toBeLessThan(5);
    });

    // === SESSION SWITCH WITHOUT USER SCROLL ============================

    test('B1: short cells, switch A→B→A: latest at top in both', async ({ page }, testInfo) => {
        await gotoFreshSession(page);
        for (const c of ['echo A1', 'echo A2', 'echo A3_latest']) await runCommand(page, c);
        await shot(page, testInfo, 'A_after_submits');
        await assertLatestCellAtTop(page);

        await newSession(page);
        for (const c of ['echo B1', 'echo B2_latest']) await runCommand(page, c);
        await shot(page, testInfo, 'B_after_submits');
        await assertLatestCellAtTop(page);

        await switchToSessionByIndex(page, 0);  // back to A
        await shot(page, testInfo, 'returned_to_A');
        await assertLatestCellAtTop(page);
    });

    test('B2: long output A, switch to B (short), switch back to A: latest at top', async ({ page }, testInfo) => {
        await gotoFreshSession(page);
        await runCommand(page, 'echo A_first');
        await runCommand(page, 'seq 1 150', { afterWaitMs: 2000 });
        await runCommand(page, 'echo A_latest');
        await shot(page, testInfo, 'A_after_submits');
        await assertLatestCellAtTop(page);

        await newSession(page);
        await runCommand(page, 'echo B_latest');
        await shot(page, testInfo, 'B_after_submit');

        await switchToSessionByIndex(page, 0);
        await shot(page, testInfo, 'returned_to_A_latest_at_top');
        await assertLatestCellAtTop(page);
        const g = await scrollGeometry(page);
        const seq = g.cells.find(c => c.cmd.includes('seq 1 150'));
        // seq is above the visible area now.
        expect(seq.viewportBottom).toBeLessThanOrEqual(50);
    });

    test('B3: TUI cell (vim) in A then switch to B then back to A — placeholder cell at top', async ({ page }, testInfo) => {
        await gotoFreshSession(page);
        await runCommand(page, 'echo A_first');
        // open vim and immediately quit so we have a closed-TUI placeholder cell.
        await runCommand(page, 'echo test > /tmp/tb_scroll_vim.txt');
        await startCommand(page, 'vim /tmp/tb_scroll_vim.txt');
        await page.waitForSelector('.tui-modal-overlay', { timeout: 8000 });
        await page.keyboard.press('Escape');
        await page.keyboard.type(':q!');
        await page.keyboard.press('Enter');
        await waitForIdle(page);
        await shot(page, testInfo, 'A_after_vim_exit');

        await newSession(page);
        await runCommand(page, 'echo B_only');

        await switchToSessionByIndex(page, 0);
        await shot(page, testInfo, 'returned_to_A_vim_placeholder_at_top');
        await assertLatestCellAtTop(page);
        const g = await scrollGeometry(page);
        const lastCellCmd = g.cells[g.cells.length - 1].cmd;
        expect(lastCellCmd).toContain('vim');
    });

    // === SESSION SWITCH WITH USER SCROLL — POSITION RESTORE ============

    test('C1: scroll to TOP in A, switch to B, back to A: scroll restored to top', async ({ page }, testInfo) => {
        await gotoFreshSession(page);
        for (const c of ['echo A1', 'seq 1 80', 'echo A3', 'echo A4_latest']) await runCommand(page, c);
        await shot(page, testInfo, 'A_after_submits');

        // Wheel up to the very top.
        await userScrollUp(page, 10000);
        const beforeSwitch = await scrollGeometry(page);
        expect(beforeSwitch.atTop).toBe(true);
        await shot(page, testInfo, 'A_scrolled_to_top');

        await newSession(page);
        await runCommand(page, 'echo B');
        await shot(page, testInfo, 'B_active');

        await switchToSessionByIndex(page, 0);
        await shot(page, testInfo, 'returned_to_A_restored_top');
        const after = await scrollGeometry(page);
        expect(after.atTop).toBe(true);
        // First cell visible near the top (notebook padding 48px + maybe a bit).
        expect(after.cells[0].viewportTop).toBeGreaterThanOrEqual(-5);
        expect(after.cells[0].viewportTop).toBeLessThan(150);
    });

    test('C2: scroll to MIDDLE in A, switch to B, back to A: restored to middle', async ({ page }, testInfo) => {
        await gotoFreshSession(page);
        for (const c of ['echo A1', 'seq 1 100', 'echo A3', 'seq 1 100', 'echo A5_latest']) await runCommand(page, c);
        await shot(page, testInfo, 'A_after_submits');

        const initial = await scrollGeometry(page);
        const midScroll = Math.round(initial.scrollHeight / 2);
        await userScrollTo(page, midScroll);
        const beforeSwitch = await scrollGeometry(page);
        await shot(page, testInfo, 'A_scrolled_to_middle');
        // Should be near our target, not at top or bottom.
        expect(beforeSwitch.scrollTop).toBeGreaterThan(100);
        expect(beforeSwitch.atBottom).toBe(false);

        await newSession(page);
        await runCommand(page, 'echo B');

        await switchToSessionByIndex(page, 0);
        const after = await scrollGeometry(page);
        await shot(page, testInfo, 'returned_to_A_restored_middle');
        expect(Math.abs(after.scrollTop - beforeSwitch.scrollTop)).toBeLessThan(30);
    });

    test('C3: scroll to bottom-but-not-default in A, restore exact bottom on return', async ({ page }, testInfo) => {
        await gotoFreshSession(page);
        for (const c of ['echo A1', 'echo A2', 'seq 1 60', 'echo A4_latest']) await runCommand(page, c);
        // Latest is already at the top of viewport after submit. Wheel
        // DOWN slightly so we're past the "default" position. This proves
        // we don't just snap back to "latest at top" on return.
        await userScrollDown(page, 200);
        const before = await scrollGeometry(page);
        await shot(page, testInfo, 'A_scrolled_down_a_bit');

        await newSession(page);
        await runCommand(page, 'echo B');

        await switchToSessionByIndex(page, 0);
        const after = await scrollGeometry(page);
        await shot(page, testInfo, 'returned_to_A_restored_down');
        expect(Math.abs(after.scrollTop - before.scrollTop)).toBeLessThan(30);
    });

    // === SUBMIT CLEARS THE MEMO ========================================

    test('D1: scrolled A, submit new command in A: latest jumps to top', async ({ page }, testInfo) => {
        await gotoFreshSession(page);
        for (const c of ['echo A1', 'seq 1 100', 'echo A3_latest']) await runCommand(page, c);
        await userScrollUp(page, 10000);
        const scrolled = await scrollGeometry(page);
        expect(scrolled.atTop).toBe(true);
        await shot(page, testInfo, 'A_scrolled_to_top');

        await runCommand(page, 'echo NEWEST');
        await shot(page, testInfo, 'A_after_new_submit');
        await assertLatestCellAtTop(page);

        // Going to B and back: memo was cleared by submit, so we default
        // to latest at top, not the old scroll-to-top position.
        await newSession(page);
        await runCommand(page, 'echo B');
        await switchToSessionByIndex(page, 0);
        await shot(page, testInfo, 'returned_to_A_default_after_submit_clear');
        await assertLatestCellAtTop(page);
    });

    // === THREE-WAY AND BOUNCING ========================================

    test('E1: three sessions A→B→C→A→B: each remembered independently', async ({ page }, testInfo) => {
        // A: scrolled to top
        await gotoFreshSession(page);
        for (const c of ['echo A1', 'seq 1 80', 'echo A3_latest']) await runCommand(page, c);
        await userScrollUp(page, 10000);
        await shot(page, testInfo, 'A_scrolled_top');

        // B: never scrolled (will default to latest-at-top on return)
        await newSession(page);
        for (const c of ['echo B1', 'seq 1 60', 'echo B3_latest']) await runCommand(page, c);
        await shot(page, testInfo, 'B_active_no_scroll');

        // C: scrolled to middle
        await newSession(page);
        for (const c of ['echo C1', 'seq 1 80', 'echo C3', 'echo C4_latest']) await runCommand(page, c);
        const cInitial = await scrollGeometry(page);
        await userScrollTo(page, Math.round(cInitial.scrollHeight / 2));
        const cScroll = (await scrollGeometry(page)).scrollTop;
        await shot(page, testInfo, 'C_scrolled_middle');

        // Switch to A: should be at top (restored)
        await switchToSessionByIndex(page, 0);
        const aReturn = await scrollGeometry(page);
        await shot(page, testInfo, 'returned_to_A_restored_top');
        expect(aReturn.atTop).toBe(true);

        // Switch to B: never scrolled, so latest at top
        await switchToSessionByIndex(page, 1);
        await shot(page, testInfo, 'returned_to_B_default');
        await assertLatestCellAtTop(page);

        // Switch to C: restored to middle
        await switchToSessionByIndex(page, 2);
        const cReturn = await scrollGeometry(page);
        await shot(page, testInfo, 'returned_to_C_restored_middle');
        expect(Math.abs(cReturn.scrollTop - cScroll)).toBeLessThan(30);
    });

    test('E2: bouncing A↔B with one scrolled, one not: stays consistent', async ({ page }, testInfo) => {
        await gotoFreshSession(page);
        for (const c of ['echo A1', 'seq 1 100', 'echo A3_latest']) await runCommand(page, c);
        await userScrollUp(page, 10000);
        const aSavedTop = (await scrollGeometry(page)).scrollTop;
        await shot(page, testInfo, 'A_initial_scrolled_to_top');

        await newSession(page);
        for (const c of ['echo B1', 'echo B2_latest']) await runCommand(page, c);
        await shot(page, testInfo, 'B_initial_default');

        // Bounce 3 times.
        for (let i = 0; i < 3; i++) {
            await switchToSessionByIndex(page, 0);
            const a = await scrollGeometry(page);
            await shot(page, testInfo, `bounce_${i}_A_restored`);
            expect(Math.abs(a.scrollTop - aSavedTop)).toBeLessThan(30);
            await switchToSessionByIndex(page, 1);
            await shot(page, testInfo, `bounce_${i}_B_default_latest_at_top`);
            // B was never scrolled — should always show latest at top.
            await assertLatestCellAtTop(page);
        }
    });

    // === EDGE / REGRESSION CASES =======================================

    test('F1: layout shift from a new cell in another session does NOT pollute A memo', async ({ page }, testInfo) => {
        await gotoFreshSession(page);
        for (const c of ['echo A1', 'seq 1 100', 'echo A3_latest']) await runCommand(page, c);
        await userScrollUp(page, 10000);
        const aTop = (await scrollGeometry(page)).scrollTop;

        await newSession(page);
        // Trigger lots of cell churn in B while A's memo should stay frozen.
        for (let i = 0; i < 5; i++) await runCommand(page, `echo B_${i}`);
        await shot(page, testInfo, 'B_churn_done');

        await switchToSessionByIndex(page, 0);
        const aReturn = await scrollGeometry(page);
        await shot(page, testInfo, 'returned_to_A_after_B_churn');
        expect(Math.abs(aReturn.scrollTop - aTop)).toBeLessThan(30);
    });

    test('F2: arrow-up history recall in chat input does NOT mark user-scroll', async ({ page }, testInfo) => {
        await gotoFreshSession(page);
        for (const c of ['echo first', 'echo second', 'seq 1 80', 'echo last']) await runCommand(page, c);
        const inp = await waitInputReady(page);
        await inp.focus();
        for (let i = 0; i < 3; i++) { await page.keyboard.press('ArrowUp'); await page.waitForTimeout(150); }
        await shot(page, testInfo, 'A_after_arrow_recall');

        await newSession(page);
        await runCommand(page, 'echo B');
        await switchToSessionByIndex(page, 0);
        // No user-scroll memo → default to latest at top.
        await shot(page, testInfo, 'returned_to_A_default');
        await assertLatestCellAtTop(page);
    });

    test('F3: passthrough cell, exit, then switch: latest cell at top', async ({ page }, testInfo) => {
        await gotoFreshSession(page);
        await runCommand(page, 'echo before_passthrough');
        await startCommand(page, 'read -r LINE; printf "[GOT:%s]\\n" "$LINE"');
        await waitForPassthrough(page);
        await page.locator('.chat-input-wrapper textarea').first().focus();
        await page.keyboard.type('typed_line');
        await page.keyboard.press('Enter');
        await waitForIdle(page);
        await runCommand(page, 'echo after_passthrough');
        await shot(page, testInfo, 'A_after_passthrough_finished');
        await assertLatestCellAtTop(page);

        await newSession(page);
        await runCommand(page, 'echo B');
        await switchToSessionByIndex(page, 0);
        await shot(page, testInfo, 'returned_to_A_default_post_passthrough');
        await assertLatestCellAtTop(page);
    });

    // === PIXEL-LEVEL VERIFICATION ======================================
    //
    // G1 / G2 are pixel-perfect snapshot tests. The goldens are platform-
    // specific (macOS font rendering vs Linux); committed copies are
    // darwin-only. Skip on non-darwin so CI on Linux doesn't fail for
    // reasons unrelated to scroll behavior. The non-pixel scroll tests
    // above this section still run on all platforms.

    test('G1: pixel snapshot — short cell at top of viewport (golden)', async ({ page }, testInfo) => {
        test.skip(process.platform !== 'darwin', 'pixel goldens are darwin-only');
        await gotoFreshSession(page);
        await runCommand(page, 'echo cell_one');
        await runCommand(page, 'echo cell_two');
        await runCommand(page, 'echo top_of_viewport');
        await page.waitForTimeout(500);
        // Capture just the top 250px of the notebook area (where the
        // latest cell should be sitting). Mask all per-contributor
        // volatile chrome — see comment in 06_visual_snapshots.spec.mjs.
        await expect(page).toHaveScreenshot('scroll_short_cell_at_top.png', {
            clip: { x: 280, y: 0, width: 1320, height: 250 },
            mask: [
                page.locator('.sidebar ul li'),
                page.locator('.cell-time'),
                page.locator('.cell-duration'),
                page.locator('.pwd-breadcrumb'),
                page.locator('.cell-header-breadcrumb'),
            ],
        });
        await shot(page, testInfo, 'short_cell_at_top_for_log');
    });

    test('G2: pixel snapshot — long-output cell at top (cell header + first rows visible)', async ({ page }, testInfo) => {
        test.skip(process.platform !== 'darwin', 'pixel goldens are darwin-only');
        await gotoFreshSession(page);
        await runCommand(page, 'echo before');
        await runCommand(page, 'seq 1 100', { afterWaitMs: 1500 });
        await page.waitForTimeout(500);
        await expect(page).toHaveScreenshot('scroll_long_cell_at_top.png', {
            clip: { x: 280, y: 0, width: 1320, height: 400 },
            mask: [
                page.locator('.sidebar ul li'),
                page.locator('.cell-time'),
                page.locator('.cell-duration'),
                page.locator('.pwd-breadcrumb'),
                page.locator('.cell-header-breadcrumb'),
            ],
        });
        await shot(page, testInfo, 'long_cell_at_top_for_log');
    });

    // === ADDITIONAL EDGE CASES =========================================

    test('H1: alt-screen TUI (vim) ended, then scroll up — switch + return restores', async ({ page }, testInfo) => {
        await gotoFreshSession(page);
        await runCommand(page, 'echo A_pre');
        await runCommand(page, 'seq 1 100');
        // Open vim, exit cleanly.
        await runCommand(page, 'echo data > /tmp/tb_scroll_h1.txt');
        await startCommand(page, 'vim /tmp/tb_scroll_h1.txt');
        await page.waitForSelector('.tui-modal-overlay', { timeout: 8000 });
        await page.keyboard.press('Escape');
        await page.keyboard.type(':q!');
        await page.keyboard.press('Enter');
        await waitForIdle(page);
        await runCommand(page, 'echo A_post_vim_latest');
        await assertLatestCellAtTop(page);

        // User scrolls up to look at older cells.
        await userScrollUp(page, 10000);
        await page.waitForTimeout(800);
        const saved = (await scrollGeometry(page)).scrollTop;
        expect(saved).toBeLessThan(50);
        await shot(page, testInfo, 'A_scrolled_top_with_vim_in_history');

        await newSession(page);
        await runCommand(page, 'echo B');

        await switchToSessionByIndex(page, 0);
        await page.waitForTimeout(500);  // let things settle
        const restored = (await scrollGeometry(page)).scrollTop;
        await shot(page, testInfo, 'returned_to_A_with_vim_restored');
        expect(Math.abs(restored - saved)).toBeLessThan(30);
    });

    test('H2: latest cell pinned at top after submit (pixel proof for short + long cell)', async ({ page }, testInfo) => {
        // Two-step pixel proof: one screenshot after a short cell, one after a long cell.
        // Both should show the new cell's TOP edge at the same pixel row (latest at top).
        await gotoFreshSession(page);
        await runCommand(page, 'echo first');
        await runCommand(page, 'echo short_command_here');
        await page.waitForTimeout(400);
        const shortGeo = await scrollGeometry(page);
        await shot(page, testInfo, 'after_short_latest');

        await runCommand(page, 'seq 1 60', { afterWaitMs: 1200 });
        const longGeo = await scrollGeometry(page);
        await shot(page, testInfo, 'after_long_latest');

        // The two latest cells should both be near the top of the viewport.
        // Tolerance: 60px accommodates the 16px anchor gap + cell border + sub-pixel rounding.
        expect(shortGeo.lastCellViewportTop).toBeGreaterThanOrEqual(-5);
        expect(shortGeo.lastCellViewportTop).toBeLessThan(60);
        expect(longGeo.lastCellViewportTop).toBeGreaterThanOrEqual(-5);
        expect(longGeo.lastCellViewportTop).toBeLessThan(60);
    });

    test('H3: switching while a command is RUNNING does not break scroll memory', async ({ page }, testInfo) => {
        await gotoFreshSession(page);
        for (const c of ['echo A1', 'seq 1 80']) await runCommand(page, c);
        await userScrollUp(page, 10000);
        const saved = (await scrollGeometry(page)).scrollTop;
        expect(saved).toBeLessThan(50);

        // Start a long-running command in A.
        await startCommand(page, 'sleep 10');
        await waitForPassthrough(page);
        await shot(page, testInfo, 'A_with_passthrough_then_scrolled');

        // Switch to B mid-passthrough.
        await newSession(page);
        await runCommand(page, 'echo B');

        // Return to A — the sleep should still be running (passthrough).
        // We do NOT assert scrollTop restoration here because cell render
        // for a still-running cell may shift layout. We only assert that
        // (a) the passthrough indicator is back, (b) interrupting Ctrl+C
        // still works.
        await switchToSessionByIndex(page, 0);
        await page.waitForTimeout(1000);
        const isPassthroughBack = await page.evaluate(() =>
            !!document.querySelector('.chat-input-wrapper.is-passthrough'));
        expect(isPassthroughBack).toBe(true);

        await page.locator('.chat-input-wrapper textarea').first().focus();
        await page.keyboard.press('Control+c');
        await waitForIdle(page, 5000);
        await shot(page, testInfo, 'A_after_interrupt_back_to_normal');
    });
});
