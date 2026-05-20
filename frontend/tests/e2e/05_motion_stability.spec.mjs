// E2E: motion-stability tests — catch flashes, layout jumps, and timing
// glitches that are invisible in end-state screenshots but obvious to a
// real user watching the page transition.
//
// Strategy: sample a numeric layout property (height, scroll position,
// presence of an overlay) at ~30ms intervals during a known transition.
// Then assert the SHAPE of the sample series (max, monotonicity, no big
// excursions).
//
// These tests are recorded as videos by default — when a test fails, the
// .webm in test-results/ shows exactly what the user would have seen.

import { test, expect } from '@playwright/test';
import {
    VIEWPORT,
    gotoFreshSession,
    runCommand,
    waitInputReady,
    waitForIdle,
    startCommand,
    waitForPassthrough,
    shot,
    sampleDuring,
} from './helpers.mjs';

test.use({ viewport: VIEWPORT });

test.describe('motion stability', () => {

    test('short command (pwd) never flashes a giant box', async ({ page }, testInfo) => {
        await gotoFreshSession(page);
        const inp = await waitInputReady(page);
        await inp.fill('pwd');

        // Begin sampling cell-output height BEFORE Enter so we catch the
        // transient frame just after submit.
        const sampler = sampleDuring(page, () => {
            const el = document.querySelector('.cell-output');
            return el ? Math.round(el.getBoundingClientRect().height) : 0;
        }, 2500);
        await inp.press('Enter');
        const samples = await sampler;
        await shot(page, testInfo, 'pwd_settled');

        const max = Math.max(...samples.map(s => s.v));
        // pwd is one line. Even with header + padding, must never exceed 200px.
        expect(max).toBeLessThan(200);
    });

    test('submitting a new command does not flash the welcome state', async ({ page }, testInfo) => {
        await gotoFreshSession(page);
        await runCommand(page, 'echo first');

        // While submitting the SECOND command, the welcome state should
        // never reappear (would happen if we briefly cleared cells).
        const sampler = sampleDuring(page, () =>
            document.querySelectorAll('.empty-state').length, 2500);
        await runCommand(page, 'echo second');
        const samples = await sampler;
        await shot(page, testInfo, 'after_second');
        const maxEmpty = Math.max(...samples.map(s => s.v));
        expect(maxEmpty).toBe(0);
    });

    test('input refocuses after submit (no focus loss flash)', async ({ page }, testInfo) => {
        await gotoFreshSession(page);
        const inp = await waitInputReady(page);
        await inp.fill('echo focus_test');
        await inp.press('Enter');
        await waitForIdle(page);
        // Input should be focused at idle.
        const focusedTag = await page.evaluate(() => document.activeElement?.tagName);
        expect(focusedTag).toBe('TEXTAREA');
        await shot(page, testInfo, 'refocused');
    });

    test('switching sessions does not flash welcome state', async ({ page }, testInfo) => {
        await gotoFreshSession(page);
        await runCommand(page, 'echo session_one');

        // Create a second session.
        await page.locator('.sidebar h2 + button').click();
        await page.waitForTimeout(1500);
        await runCommand(page, 'echo session_two');

        // Switch back to session 1, sampling empty-state visibility.
        const sampler = sampleDuring(page, () =>
            document.querySelectorAll('.empty-state').length, 1500);
        await page.locator('.sidebar ul li').first().click();
        const samples = await sampler;
        await shot(page, testInfo, 'after_switch');
        // session_one has cells, so we should NEVER see the welcome state.
        const maxEmpty = Math.max(...samples.map(s => s.v));
        expect(maxEmpty).toBe(0);
    });

    test('passthrough mode visual indicator appears and disappears cleanly', async ({ page }, testInfo) => {
        await gotoFreshSession(page);

        // Before passthrough: chat input should NOT have .is-passthrough.
        const before = await page.evaluate(() =>
            !!document.querySelector('.chat-input-wrapper.is-passthrough'));
        expect(before).toBe(false);

        await startCommand(page, 'read -r LINE; printf "done"');
        await waitForPassthrough(page);
        await shot(page, testInfo, 'passthrough_active');

        // Sample passthrough presence during the cell's lifetime.
        await page.locator('.chat-input-wrapper textarea').first().focus();
        await page.keyboard.type('x');
        await page.keyboard.press('Enter');
        const sampler = sampleDuring(page, () =>
            document.querySelector('.chat-input-wrapper.is-passthrough') ? 1 : 0, 2500);
        const samples = await sampler;
        await shot(page, testInfo, 'passthrough_gone');

        // Should END at 0 (cell exited, passthrough cleared).
        expect(samples[samples.length - 1].v).toBe(0);
    });
});
