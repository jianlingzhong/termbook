// E2E: scroll behavior on submit and session switch.
//
// Contract:
//   1. After submitting a NEW command, the new cell's top edge is
//      ~16px below the viewport top. The user's eyes naturally land
//      on "the command I just ran".
//   2. When switching to a session for the first time (or to a session
//      where the user never explicitly scrolled), the latest cell is
//      placed at the top of the viewport — same rule as submit.
//   3. When switching back to a session where the user HAD explicitly
//      scrolled (wheel / touch / PageUp / PageDown / Home / End),
//      restore that scroll position. The user's place is sacred.
//
// What counts as "user scrolled": wheel / touch / scroll-related key
// events. Generic 'scroll' events that come from layout shifts (cell
// renders, fit-addon resizes, new cell appears) do NOT count.

import { test, expect } from '@playwright/test';
import {
    VIEWPORT,
    gotoFreshSession,
    runCommand,
    waitInputReady,
    shot,
} from './helpers.mjs';

test.use({ viewport: VIEWPORT });

async function lastCellTop(page) {
    return await page.evaluate(() => {
        const cells = document.querySelectorAll('.notebook-cell');
        const last = cells[cells.length - 1];
        return last ? Math.round(last.getBoundingClientRect().top) : -1;
    });
}

async function scrollTop(page) {
    return await page.locator('.notebook-content').evaluate(el => el.scrollTop);
}

test.describe('scroll behavior', () => {

    test('after submit: new cell sits at the top of the viewport', async ({ page }, testInfo) => {
        await gotoFreshSession(page);
        await runCommand(page, 'echo c1');
        await runCommand(page, 'seq 1 80');
        await runCommand(page, 'echo c3');
        await shot(page, testInfo, 'after_third_submit');

        // After the third submit, "echo c3" should be at the top of the
        // viewport. The header bar is ~30px tall (page chrome above the
        // notebook-content scroll area), and we leave a 16px gap above
        // the cell, so the cell's top edge in viewport coords should be
        // somewhere between 30 and 120px.
        const top = await lastCellTop(page);
        expect(top).toBeGreaterThanOrEqual(30);
        expect(top).toBeLessThan(150);
    });

    test('switching to a session (no prior scroll): latest cell at top', async ({ page }, testInfo) => {
        await gotoFreshSession(page);
        for (const c of ['echo A1', 'seq 1 40', 'echo A3']) await runCommand(page, c);

        // Create + populate session B.
        await page.locator('.sidebar h2 + button').click();
        await page.waitForTimeout(2000);
        for (const c of ['echo B1', 'echo B2']) await runCommand(page, c);

        // Switch back to A. A had cells but the user NEVER scrolled it
        // manually. So the default kicks in: latest cell at top.
        await page.locator('.sidebar ul li').nth(0).click();
        await page.waitForTimeout(1500);
        await shot(page, testInfo, 'returned_to_A_no_user_scroll');

        const top = await lastCellTop(page);
        expect(top).toBeGreaterThanOrEqual(30);
        expect(top).toBeLessThan(150);
    });

    test('switching back to a session with user scroll: restores position', async ({ page }, testInfo) => {
        await gotoFreshSession(page);
        for (const c of ['echo A1', 'echo A2', 'seq 1 60', 'echo A4', 'echo A5']) await runCommand(page, c);

        // Wheel-scroll up — this MUST mark the session as user-scrolled.
        await page.locator('.notebook-content').hover();
        await page.mouse.wheel(0, -5000);
        await page.waitForTimeout(800);
        const savedScrollTop = await scrollTop(page);
        expect(savedScrollTop).toBeLessThan(50);  // we scrolled to near-top
        await shot(page, testInfo, 'A_scrolled_to_top');

        // Create + populate session B.
        await page.locator('.sidebar h2 + button').click();
        await page.waitForTimeout(2000);
        for (const c of ['echo B1', 'echo B2']) await runCommand(page, c);

        // Switch back to A — scroll position should be restored.
        await page.locator('.sidebar ul li').nth(0).click();
        await page.waitForTimeout(1500);
        await shot(page, testInfo, 'returned_to_A_position_restored');

        const restored = await scrollTop(page);
        expect(Math.abs(restored - savedScrollTop)).toBeLessThan(20);
    });

    test('layout shifts during session switch do NOT pollute the scroll memo', async ({ page }, testInfo) => {
        // Regression for the bug found while developing this feature:
        // creating/switching sessions causes scroll events from layout
        // changes. Those events used to be misread as user scrolls and
        // overwrote the saved memo with wrong values.
        await gotoFreshSession(page);
        for (const c of ['echo A1', 'seq 1 80', 'echo A3']) await runCommand(page, c);

        // Wheel-scroll to a known place.
        await page.locator('.notebook-content').hover();
        await page.mouse.wheel(0, -10000);
        await page.waitForTimeout(800);
        const target = await scrollTop(page);
        expect(target).toBeLessThan(50);

        // Bounce through several sessions to maximize layout churn.
        for (let i = 0; i < 3; i++) {
            await page.locator('.sidebar h2 + button').click();
            await page.waitForTimeout(1200);
            await runCommand(page, `echo S${i}`);
        }

        // Back to A. Memo must still point at our wheel-scroll position.
        await page.locator('.sidebar ul li').nth(0).click();
        await page.waitForTimeout(1500);
        await shot(page, testInfo, 'returned_to_A_after_churn');
        const restored = await scrollTop(page);
        expect(Math.abs(restored - target)).toBeLessThan(20);
    });

    test('submit clears the saved scroll memo (latest goes to top)', async ({ page }, testInfo) => {
        await gotoFreshSession(page);
        for (const c of ['echo A1', 'seq 1 60', 'echo A3']) await runCommand(page, c);
        // Wheel-scroll up.
        await page.locator('.notebook-content').hover();
        await page.mouse.wheel(0, -10000);
        await page.waitForTimeout(800);
        const wheeled = await scrollTop(page);
        expect(wheeled).toBeLessThan(50);

        // Submit a new command. New cell must jump to top.
        await runCommand(page, 'echo BACK_TO_TOP');
        await shot(page, testInfo, 'after_submit_clears_memo');

        const top = await lastCellTop(page);
        expect(top).toBeGreaterThanOrEqual(30);
        expect(top).toBeLessThan(150);
    });

    test('typing ArrowUp in the input is history recall, NOT a scroll', async ({ page }, testInfo) => {
        // Regression: we use ArrowUp/Down for history recall in the chat
        // input. Pressing them must NOT be misread as a scroll gesture
        // (which would set the user-scrolled flag).
        await gotoFreshSession(page);
        for (const c of ['echo first', 'echo second', 'echo third']) await runCommand(page, c);
        const inp = await waitInputReady(page);
        await inp.focus();

        // Recall history with ArrowUp.
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(300);
        const val = await inp.inputValue();
        expect(val).toContain('third');

        // Now create a second session and switch back. Should DEFAULT
        // (latest at top), proving ArrowUp didn't mark us as user-scrolled.
        await page.locator('.chat-input-wrapper textarea').first().fill('');
        await page.locator('.sidebar h2 + button').click();
        await page.waitForTimeout(2000);
        await runCommand(page, 'echo B');
        await page.locator('.sidebar ul li').nth(0).click();
        await page.waitForTimeout(1500);
        await shot(page, testInfo, 'arrow_up_did_not_mark_user_scroll');
        const top = await lastCellTop(page);
        expect(top).toBeLessThan(150);
    });
});
