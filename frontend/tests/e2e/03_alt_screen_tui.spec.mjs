// E2E: alt-screen TUI commands (vim, top, htop).
//
// These commands emit OSC 1049h on entry and 1049l on exit. The expected
// UX is: a full-screen modal opens hosting the live xterm; the user
// interacts with the program; on exit, the modal closes and a placeholder
// 'Interactive session ended' is left in the cell.

import { test, expect } from '@playwright/test';
import {
    VIEWPORT,
    gotoFreshSession,
    startCommand,
    waitForIdle,
    shot,
    lastCellInfo,
} from './helpers.mjs';

test.use({ viewport: VIEWPORT });

test.describe('alt-screen TUIs', () => {

    test('vim opens in modal, accepts :q!, closes cleanly', async ({ page }, testInfo) => {
        await gotoFreshSession(page);
        // Pre-create a file so vim has content to display.
        await page.locator('.chat-input-wrapper textarea').first().fill('echo VIM_TEST > /tmp/tb_vim_test.txt');
        await page.locator('.chat-input-wrapper textarea').first().press('Enter');
        await waitForIdle(page);

        await startCommand(page, 'vim /tmp/tb_vim_test.txt');
        // Wait for TUI modal.
        await page.waitForSelector('.tui-modal-overlay', { timeout: 8000 });
        await page.waitForTimeout(1000);
        await shot(page, testInfo, 'vim_open');

        const modalRect = await page.locator('.tui-window').boundingBox();
        // The modal must be near-fullscreen (90vw x 85vh).
        expect(modalRect.width).toBeGreaterThan(VIEWPORT.width * 0.85);
        expect(modalRect.height).toBeGreaterThan(VIEWPORT.height * 0.8);

        // Send :q! to exit vim.
        await page.keyboard.press('Escape');
        await page.keyboard.type(':q!');
        await page.keyboard.press('Enter');
        await waitForIdle(page);
        await shot(page, testInfo, 'vim_after_quit');

        // Modal must be gone.
        expect(await page.locator('.tui-modal-overlay').count()).toBe(0);

        const last = await lastCellInfo(page);
        expect(last.cmd).toContain('vim /tmp/tb_vim_test.txt');
        expect(last.output).toContain('Interactive session ended');
        // usedTui implies no snapshot of vim's screen — by design.
    });

    test('vim cell does NOT enter passthrough mode (modal owns input)', async ({ page }, testInfo) => {
        await gotoFreshSession(page);
        await startCommand(page, 'vim /tmp/tb_vim_pt_test.txt');
        await page.waitForSelector('.tui-modal-overlay', { timeout: 8000 });

        // Chat input should be flagged as TUI, not passthrough.
        const state = await page.evaluate(() => ({
            tui: !!document.querySelector('.chat-input-wrapper.is-tui'),
            passthrough: !!document.querySelector('.chat-input-wrapper.is-passthrough'),
            disabled: document.querySelector('.chat-input-wrapper textarea')?.disabled,
        }));
        expect(state.tui).toBe(true);
        expect(state.passthrough).toBe(false);
        expect(state.disabled).toBe(true);

        // Cleanup.
        await page.keyboard.press('Escape');
        await page.keyboard.type(':q!');
        await page.keyboard.press('Enter');
        await waitForIdle(page);
    });

    test('nvim is pre-promoted to TUI modal (does NOT emit \\x1b[?1049h)', async ({ page }, testInfo) => {
        // Critical regression: modern neovim doesn't enter the standard
        // alt-screen buffer in many configurations — it draws in-place
        // with cursor positioning. Without pre-promotion, the cell would
        // render as a normal cell with broken layout (status line
        // visible but file content cut off because the cell's xterm
        // wasn't sized for a fullscreen TUI).
        //
        // We pre-promote based on the FIRST command token: nvim, vim,
        // emacs, htop, less, etc. The modal opens immediately, modal
        // xterm is sized correctly, nvim renders properly from frame 1.
        // Try with `nvim`; skip test if nvim isn't installed.
        await gotoFreshSession(page);
        // Probe for nvim availability.
        await page.locator('.chat-input-wrapper textarea').first().fill('which nvim 2>/dev/null && echo NVIM_OK || echo NVIM_MISSING');
        await page.locator('.chat-input-wrapper textarea').first().press('Enter');
        await waitForIdle(page);
        const probe = await lastCellInfo(page);
        test.skip(probe.output.includes('NVIM_MISSING'), 'nvim not installed in this environment');

        // Create a multi-line test file.
        await page.locator('.chat-input-wrapper textarea').first().fill('printf "line1\\nline2\\nline3\\nline4\\nline5\\n" > /tmp/tb_nvim_e2e.txt');
        await page.locator('.chat-input-wrapper textarea').first().press('Enter');
        await waitForIdle(page);

        await startCommand(page, 'nvim /tmp/tb_nvim_e2e.txt');
        // Modal MUST open. If pre-promotion is broken (or nvim's altscreen
        // detection silently regressed) this is where we catch it.
        await page.waitForSelector('.tui-modal-overlay', { timeout: 6000 });
        await page.waitForTimeout(1500); // let nvim finish drawing
        await shot(page, testInfo, 'nvim_open');

        const modalRect = await page.locator('.tui-window').boundingBox();
        expect(modalRect.width).toBeGreaterThan(VIEWPORT.width * 0.85);
        expect(modalRect.height).toBeGreaterThan(VIEWPORT.height * 0.8);

        // Quit nvim.
        await page.keyboard.press('Escape');
        await page.keyboard.type(':q!');
        await page.keyboard.press('Enter');
        await waitForIdle(page, 10000);
        await shot(page, testInfo, 'nvim_after_quit');

        // Modal must be gone, cell must have closed (no spin-forever).
        expect(await page.locator('.tui-modal-overlay').count()).toBe(0);
        const runningCells = await page.locator('.notebook-cell.active-cell').count();
        expect(runningCells).toBe(0);
    });
});
