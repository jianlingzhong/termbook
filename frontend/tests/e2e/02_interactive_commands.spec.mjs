// E2E: interactive commands (passthrough mode).
//
// Covers every code path that routes chat-input keystrokes to a running
// command's PTY. These are the gap-area tests called out in code review:
// arrow keys, backspace, Tab, Ctrl+letter combos, paste, multi-character
// input, exit via Ctrl+C / Ctrl+D, then return to normal mode.

import { test, expect } from '@playwright/test';
import {
    VIEWPORT,
    gotoFreshSession,
    startCommand,
    runCommand,
    waitForPassthrough,
    waitForIdle,
    shot,
    sendKeystrokes,
    lastCellInfo,
} from './helpers.mjs';

test.use({ viewport: VIEWPORT });

test.describe('interactive commands (passthrough)', () => {

    test('cat with no args: type lines, Ctrl+D exits', async ({ page }, testInfo) => {
        await gotoFreshSession(page);
        await startCommand(page, 'cat');
        await waitForPassthrough(page);
        await shot(page, testInfo, 'cat_running_passthrough');

        await page.locator('.chat-input-wrapper textarea').first().focus();
        await page.keyboard.type('hello');
        await page.keyboard.press('Enter');
        await page.waitForTimeout(300);
        await page.keyboard.type('world');
        await page.keyboard.press('Enter');
        await page.waitForTimeout(300);
        await shot(page, testInfo, 'cat_typed_two_lines');

        // EOF.
        await page.keyboard.press('Control+d');
        await waitForIdle(page);
        await shot(page, testInfo, 'cat_after_eof');

        const last = await lastCellInfo(page);
        expect(last.output).toContain('hello');
        expect(last.output).toContain('world');
        expect(last.isSuccess).toBe(true);
    });

    test('read -r: single line, Enter submits', async ({ page }, testInfo) => {
        await gotoFreshSession(page);
        await startCommand(page, 'read -r LINE; printf "[GOT:%s]\\n" "$LINE"');
        await waitForPassthrough(page);
        await shot(page, testInfo, 'read_passthrough');

        await page.locator('.chat-input-wrapper textarea').first().focus();
        await page.keyboard.type('the_quick_brown_fox');
        await page.keyboard.press('Enter');
        await waitForIdle(page);
        await shot(page, testInfo, 'read_after_submit');

        const last = await lastCellInfo(page);
        expect(last.output).toContain('[GOT:the_quick_brown_fox]');
    });

    test('Ctrl+C interrupts a sleep', async ({ page }, testInfo) => {
        await gotoFreshSession(page);
        await startCommand(page, 'sleep 60');
        await waitForPassthrough(page);
        await shot(page, testInfo, 'sleep_running');

        const startedAt = Date.now();
        await page.locator('.chat-input-wrapper textarea').first().focus();
        await page.keyboard.press('Control+c');
        await waitForIdle(page, 5000);
        const elapsed = Date.now() - startedAt;
        // Should interrupt well under 5s (we typed Ctrl+C ~immediately).
        expect(elapsed).toBeLessThan(5000);
        await shot(page, testInfo, 'sleep_interrupted');
    });

    test('backspace removes characters before Enter', async ({ page }, testInfo) => {
        await gotoFreshSession(page);
        await startCommand(page, 'read -r LINE; printf "[GOT:%s]\\n" "$LINE"');
        await waitForPassthrough(page);

        await page.locator('.chat-input-wrapper textarea').first().focus();
        // Type "helloXY" then backspace twice to get "hello".
        await page.keyboard.type('helloXY');
        await page.keyboard.press('Backspace');
        await page.keyboard.press('Backspace');
        await page.keyboard.press('Enter');
        await waitForIdle(page);
        await shot(page, testInfo, 'read_after_backspace');

        const last = await lastCellInfo(page);
        expect(last.output).toContain('[GOT:hello]');
        expect(last.output).not.toContain('[GOT:helloXY]');
    });

    test('arrow keys are forwarded to the PTY', async ({ page }, testInfo) => {
        await gotoFreshSession(page);
        // bash `read -e` enables readline editing (so arrow keys work).
        await startCommand(page, 'read -e -r LINE; printf "[GOT:%s]\\n" "$LINE"');
        await waitForPassthrough(page);

        await page.locator('.chat-input-wrapper textarea').first().focus();
        // Type "abcZZ", then left-arrow twice, then type "_". Expected: "abc_ZZ".
        await page.keyboard.type('abcZZ');
        await page.keyboard.press('ArrowLeft');
        await page.keyboard.press('ArrowLeft');
        await page.keyboard.type('_');
        await page.keyboard.press('Enter');
        await waitForIdle(page);
        await shot(page, testInfo, 'arrows_after_submit');

        const last = await lastCellInfo(page);
        expect(last.output).toContain('[GOT:abc_ZZ]');
    });

    test('Tab is forwarded (bash readline insertion)', async ({ page }, testInfo) => {
        await gotoFreshSession(page);
        // Run a Python REPL where Tab inserts a literal tab character
        // (without readline). Even simpler: use bash `read` and verify the
        // Tab character ends up in $LINE.
        await startCommand(page, 'read -r LINE; printf "[len=%d]\\n" "${#LINE}"');
        await waitForPassthrough(page);

        await page.locator('.chat-input-wrapper textarea').first().focus();
        // Type 'a', Tab, 'b' -> 3 chars total.
        await page.keyboard.type('a');
        await page.keyboard.press('Tab');
        await page.keyboard.type('b');
        await page.keyboard.press('Enter');
        await waitForIdle(page);

        const last = await lastCellInfo(page);
        expect(last.output).toContain('[len=3]');
    });

    test('Ctrl+U clears the current line (readline kill-line)', async ({ page }, testInfo) => {
        await gotoFreshSession(page);
        await startCommand(page, 'read -e -r LINE; printf "[GOT:%s]\\n" "$LINE"');
        await waitForPassthrough(page);

        await page.locator('.chat-input-wrapper textarea').first().focus();
        await page.keyboard.type('garbage_to_erase');
        await page.keyboard.press('Control+u');  // kill from cursor to start of line
        await page.keyboard.type('clean');
        await page.keyboard.press('Enter');
        await waitForIdle(page);
        await shot(page, testInfo, 'ctrlu_after');

        const last = await lastCellInfo(page);
        expect(last.output).toContain('[GOT:clean]');
        expect(last.output).not.toContain('garbage');
    });

    test('after passthrough exits, input returns to normal command mode', async ({ page }, testInfo) => {
        await gotoFreshSession(page);
        await startCommand(page, 'cat');
        await waitForPassthrough(page);
        await page.locator('.chat-input-wrapper textarea').first().focus();
        await page.keyboard.type('first');
        await page.keyboard.press('Enter');
        await page.keyboard.press('Control+d');
        await waitForIdle(page);

        // Now run a new command — should NOT be passthrough at start.
        await runCommand(page, 'echo back_to_normal');
        const last = await lastCellInfo(page);
        expect(last.cmd).toContain('echo back_to_normal');
        expect(last.output).toContain('back_to_normal');
        await shot(page, testInfo, 'final_state');
    });
});
