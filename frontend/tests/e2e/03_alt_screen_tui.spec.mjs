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

    test('nvim opens in modal (content-based TUI detection)', async ({ page }, testInfo) => {
        // Catches a class of bugs the old "modal opens? ✓ modal big? ✓"
        // test missed:
        //   1. Modal opens but the chrome (header, traffic lights) is missing
        //   2. nvim draws at one size, modal is another → empty rows below
        //      where nvim thinks the screen ends
        //   3. Duplicate status lines (nvim drew at size A, then partial
        //      redraw at size B)
        //   4. File content not visible (rendered off-screen due to size mismatch)
        //
        // We test against a small file with KNOWN content (line1..line5) and
        // assert nvim actually drew those lines into the visible terminal area.
        await gotoFreshSession(page);
        // Probe for nvim availability.
        await page.locator('.chat-input-wrapper textarea').first().fill('which nvim 2>/dev/null && echo NVIM_OK || echo NVIM_MISSING');
        await page.locator('.chat-input-wrapper textarea').first().press('Enter');
        await waitForIdle(page);
        const probe = await lastCellInfo(page);
        test.skip(probe.output.includes('NVIM_MISSING'), 'nvim not installed');

        // Create a test file with DISTINCTIVE content so we can assert
        // exactly what nvim should be displaying.
        await page.locator('.chat-input-wrapper textarea').first().fill('printf "NVIM_MARKER_LINE_1\\nNVIM_MARKER_LINE_2\\nNVIM_MARKER_LINE_3\\nNVIM_MARKER_LINE_4\\nNVIM_MARKER_LINE_5\\n" > /tmp/tb_nvim_e2e.txt');
        await page.locator('.chat-input-wrapper textarea').first().press('Enter');
        await waitForIdle(page);

        await startCommand(page, 'nvim /tmp/tb_nvim_e2e.txt');
        await page.waitForSelector('.tui-window', { timeout: 8000 });
        // Wait for the resize race to settle + the forced \x0c redraw to fire.
        await page.waitForTimeout(2500);
        await shot(page, testInfo, 'nvim_open');

        // ── Structural assertions ──
        // Modal chrome must exist (header + traffic lights). If these are
        // missing, the user can't move/maximize/close the modal.
        const chrome = await page.evaluate(() => {
            const w = document.querySelector('.tui-window');
            return {
                header: !!document.querySelector('.tui-window-header'),
                trafficLights: document.querySelectorAll('.tui-traffic-light').length,
                modalW: w ? w.offsetWidth : 0,
                modalH: w ? w.offsetHeight : 0,
            };
        });
        expect(chrome.header).toBe(true);
        expect(chrome.trafficLights).toBe(3);
        expect(chrome.modalW).toBeGreaterThan(VIEWPORT.width * 0.85);
        expect(chrome.modalH).toBeGreaterThan(VIEWPORT.height * 0.8);

        // ── Content assertions ──
        // The file content must actually be VISIBLE in the modal's xterm.
        // We pull the rendered text out of the xterm rows.
        const xtermText = await page.evaluate(() => {
            // xterm's DOM renderer puts each row as a div under .xterm-rows
            const rows = Array.from(document.querySelectorAll('.tui-window .xterm-rows > div'));
            return rows.map(r => r.innerText).join('\n');
        });
        // Should contain all 5 markers.
        for (const marker of ['NVIM_MARKER_LINE_1', 'NVIM_MARKER_LINE_2', 'NVIM_MARKER_LINE_3', 'NVIM_MARKER_LINE_4', 'NVIM_MARKER_LINE_5']) {
            expect(xtermText, `expected nvim to display "${marker}" but it wasn't found in the rendered xterm text`).toContain(marker);
        }

        // ── Layout assertions: status line is at the BOTTOM ──
        // nvim's status line contains "NORMAL" (the mode indicator).
        // Find the row containing it; ensure rows AFTER it are empty
        // (or just the command line) — i.e., no big empty gap between
        // status and bottom of visible area.
        const layout = await page.evaluate(() => {
            const rows = Array.from(document.querySelectorAll('.tui-window .xterm-rows > div'));
            const texts = rows.map(r => r.innerText);
            const normalIdx = texts.findIndex(t => /\bNORMAL\b/.test(t));
            const rowsBelowStatus = normalIdx >= 0 ? texts.slice(normalIdx + 1) : [];
            const nonEmptyBelow = rowsBelowStatus.filter(t => t.trim().length > 0).length;
            return { totalRows: rows.length, normalIdx, rowsBelowStatus: rowsBelowStatus.length, nonEmptyBelow };
        });
        expect(layout.normalIdx, 'nvim status line (NORMAL) not found in rendered xterm').toBeGreaterThanOrEqual(0);
        // After the status line there should be AT MOST 1 row (nvim's
        // command line `:` for entering commands). If we see 5+ rows
        // below, it means nvim drew its status at a wrong row and there's
        // empty space below it (the size-mismatch bug).
        expect(layout.rowsBelowStatus,
            `nvim drew status line at row ${layout.normalIdx} but ${layout.rowsBelowStatus} rows exist below it — size mismatch / redraw race`
        ).toBeLessThanOrEqual(2);

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

    test('nvim navigation (j/k) keeps file content stable across redraws', async ({ page }, testInfo) => {
        // The user reported a visual artifact where after pressing 'j'
        // to move the cursor down by one row, a previously-rendered line
        // would visually disappear from the cell or appear duplicated.
        // This is symptomatic of xterm.js's DOM renderer getting out of
        // sync with nvim's redraw commands.
        //
        // We test: open nvim with a 40-line file, press 'j' 20 times,
        // and verify that all 40 file lines are still consistently
        // present in the rendered xterm rows. No gaps (line N missing
        // between N-1 and N+1), no duplicates (same line shown twice in
        // adjacent rows).
        await gotoFreshSession(page);
        await page.locator('.chat-input-wrapper textarea').first().fill('which nvim 2>/dev/null && echo NVIM_OK || echo NVIM_MISSING');
        await page.locator('.chat-input-wrapper textarea').first().press('Enter');
        await waitForIdle(page);
        const probe = await lastCellInfo(page);
        test.skip(probe.output.includes('NVIM_MISSING'), 'nvim not installed');

        // Build a file with numbered DISTINCTIVE lines.
        await page.locator('.chat-input-wrapper textarea').first().fill('seq 1 40 | awk \'{print "NAV_LINE_" $1}\' > /tmp/tb_nav_test.txt');
        await page.locator('.chat-input-wrapper textarea').first().press('Enter');
        await waitForIdle(page);

        await startCommand(page, 'nvim /tmp/tb_nav_test.txt');
        await page.waitForSelector('.tui-window', { timeout: 8000 });
        await page.waitForTimeout(1500);

        // Press 'j' 20 times to navigate down.
        for (let i = 0; i < 20; i++) {
            await page.keyboard.press('j');
            await page.waitForTimeout(50);
        }
        await page.waitForTimeout(500);
        await shot(page, testInfo, 'nvim_after_navigation');

        // Pull rendered rows. Each row should contain at most ONE NAV_LINE marker.
        // Each NAV_LINE_N should appear in adjacent rows in order
        // (no gaps in the sequence visible on screen).
        const rows = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('.tui-window .xterm-rows > div')).map(r => r.innerText);
        });
        const navMarkers = rows
            .map((t, i) => {
                const m = t.match(/NAV_LINE_(\d+)/);
                return m ? { row: i, n: parseInt(m[1]) } : null;
            })
            .filter(Boolean);

        // The sequence of NAV_LINE numbers visible on screen should be
        // monotonically increasing by 1 from one row to the next.
        // Gap (e.g., NAV_LINE_5 then NAV_LINE_7) = a row got skipped.
        // Repeat (e.g., NAV_LINE_5 then NAV_LINE_5) = same line shown
        // twice.
        for (let i = 1; i < navMarkers.length; i++) {
            const prev = navMarkers[i - 1];
            const cur = navMarkers[i];
            // Adjacent visible markers should be in adjacent xterm rows
            // (cur.row === prev.row + 1) and adjacent file lines
            // (cur.n === prev.n + 1).
            if (cur.row === prev.row + 1) {
                expect(cur.n,
                    `NAV_LINE_${prev.n} (xterm row ${prev.row}) → NAV_LINE_${cur.n} (xterm row ${cur.row}) — expected NAV_LINE_${prev.n + 1}; file line skipped or duplicated`
                ).toBe(prev.n + 1);
            }
        }

        // Quit.
        await page.keyboard.press('Escape');
        await page.keyboard.type(':q!');
        await page.keyboard.press('Enter');
        await waitForIdle(page, 10000);
    });

    test('xterm uses WebGL renderer (eliminates cursor sub-pixel drift)', async ({ page }, testInfo) => {
        // Background: xterm's DOM renderer computes cellWidth from font
        // metrics and often gets a fractional value (JetBrains Mono 13px
        // → 7.81px). The cursor block, rendered as an absolutely-
        // positioned overlay div at `left = col * cellWidth`, accumulates
        // rounding error → visible as the cursor straddling two
        // characters after many cursor moves. The WebGL renderer draws
        // every cell at integer pixel boundaries on a canvas, so the
        // cursor is always pixel-aligned.
        //
        // This test verifies the WebGL renderer is in use (canvas
        // elements present, _tb_webglLoaded flag set) for the modal
        // terminal. If WebGL silently falls back to DOM in a future
        // change, this test catches it.
        await gotoFreshSession(page);
        await page.locator('.chat-input-wrapper textarea').first().fill('which nvim 2>/dev/null && echo NVIM_OK || echo NVIM_MISSING');
        await page.locator('.chat-input-wrapper textarea').first().press('Enter');
        await waitForIdle(page);
        const probe = await lastCellInfo(page);
        test.skip(probe.output.includes('NVIM_MISSING'), 'nvim not installed');

        await page.locator('.chat-input-wrapper textarea').first().fill('printf "line1\\nline2\\nline3\\n" > /tmp/tb_webgl_test.txt');
        await page.locator('.chat-input-wrapper textarea').first().press('Enter');
        await waitForIdle(page);

        await startCommand(page, 'nvim /tmp/tb_webgl_test.txt');
        await page.waitForSelector('.tui-window', { timeout: 8000 });
        await page.waitForTimeout(1500);

        const rendererInfo = await page.evaluate(() => {
            const t = window.__ACTIVE_TERM;
            return {
                webglLoaded: !!t?._tb_webglLoaded,
                modalCanvasCount: document.querySelectorAll('.tui-window canvas').length,
                cellWidthCss: t?._core?._renderService?.dimensions?.css?.cell?.width,
            };
        });
        // Headless Playwright/Chromium may not have GPU access, in which
        // case WebGL silently falls back to DOM. Skip the assertion in
        // that case — but in a real browser (which is what users hit)
        // WebGL WILL be active.
        if (!rendererInfo.webglLoaded) {
            test.skip(true, 'WebGL unavailable in this environment (headless without GPU); real browsers use WebGL');
            return;
        }
        // WebGL adds multiple canvases (background, text, link layers).
        expect(rendererInfo.modalCanvasCount).toBeGreaterThanOrEqual(2);
        // WebGL normalizes cellWidth to an integer. With the DOM
        // renderer this would be ~7.81 (fractional). If we see a
        // fractional value, WebGL silently failed despite reporting
        // loaded.
        expect(Number.isInteger(rendererInfo.cellWidthCss),
            `cellWidth=${rendererInfo.cellWidthCss} is fractional — WebGL renderer not active, cursor drift will return`
        ).toBe(true);

        await page.keyboard.press('Escape');
        await page.keyboard.type(':q!');
        await page.keyboard.press('Enter');
        await waitForIdle(page, 10000);
    });

    test('command that briefly enters alt-screen but produces main-screen output keeps its snapshot', async ({ page }, testInfo) => {
        // Regression: brew/npm/git push etc. open the alt-screen for a
        // progress display, exit alt-screen, then print summary output
        // to the main screen. That summary IS the output the user wants
        // to see — must NOT be replaced with "Interactive session ended"
        // placeholder.
        //
        // We simulate this with a shell script that:
        //   1. prints some output (BEFORE_TUI_MARKER)
        //   2. enters alt-screen (\e[?1049h), draws something briefly
        //   3. exits alt-screen (\e[?1049l)
        //   4. prints more output (AFTER_TUI_MARKER) — the "summary"
        //
        // The cell's snapshot must contain AFTER_TUI_MARKER (and
        // probably BEFORE_TUI_MARKER too, depending on terminal-buffer
        // restoration), NOT just "Interactive session ended".
        await gotoFreshSession(page);
        const script = `printf 'BEFORE_TUI_MARKER\\n'; printf '\\033[?1049h'; printf 'fake progress bar inside altscreen'; sleep 0.4; printf '\\033[?1049l'; printf 'AFTER_TUI_MARKER\\nFINAL_LINE\\n'`;
        await startCommand(page, `bash -c "${script.replace(/"/g, '\\"')}"`);
        await waitForIdle(page, 8000);
        await shot(page, testInfo, '01_after_command');

        const last = await lastCellInfo(page);
        // The snapshot must contain the SUMMARY output that came after
        // the alt-screen exited. If we see "Interactive session ended"
        // and no AFTER_TUI_MARKER, the bug is back: we mistook the
        // brief-altscreen command for a real TUI.
        expect(last.output, 'snapshot lost the post-altscreen output').toContain('AFTER_TUI_MARKER');
        expect(last.output, 'snapshot lost the post-altscreen output').toContain('FINAL_LINE');
        // Must NOT show the TUI placeholder for this kind of cell.
        expect(last.output).not.toContain('Interactive session ended');
    });

    test('cat (not a TUI) does NOT trigger modal promotion', async ({ page }, testInfo) => {
        // The content-based detection should NOT trigger on commands that
        // just stream text. If `cat` (or `ls`, `grep`, `echo`) accidentally
        // gets promoted, the user's normal cell-stream workflow breaks.
        await gotoFreshSession(page);
        await page.locator('.chat-input-wrapper textarea').first().fill('printf "line_a\\nline_b\\nline_c\\n" > /tmp/tb_cat_nottui.txt');
        await page.locator('.chat-input-wrapper textarea').first().press('Enter');
        await waitForIdle(page);

        await startCommand(page, 'cat /tmp/tb_cat_nottui.txt');
        await waitForIdle(page);
        await shot(page, testInfo, 'cat_done');

        // Modal must NOT have opened at any point.
        expect(await page.locator('.tui-modal-overlay').count()).toBe(0);
        // Output should be the file content as a normal cell.
        const last = await lastCellInfo(page);
        expect(last.output).toContain('line_a');
        expect(last.output).toContain('line_b');
        expect(last.output).toContain('line_c');
    });
});
