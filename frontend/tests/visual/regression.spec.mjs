// Functional regression suite.
//
// These tests cover all the bug-fixes we shipped. Each one corresponds
// to a real defect that was found and fixed; if any of them ever fails
// again, it's a regression.

import { test, expect } from '@playwright/test';
import {
    INPUT,
    VIEWPORT,
    gotoFreshSession,
    runCommand,
    waitInputReady,
    cellHeights,
    lastCellText,
} from './helpers.mjs';

test.use({ viewport: VIEWPORT });

test.describe('regression', () => {

    test('cells do not bleed: each cell shows only its own output', async ({ page }) => {
        await gotoFreshSession(page);
        await runCommand(page, 'echo MARKER_FIRST', 1500);
        await runCommand(page, 'echo MARKER_SECOND', 1500);
        const last = await lastCellText(page);
        expect(last).toContain('MARKER_SECOND');
        expect(last).not.toContain('MARKER_FIRST');
    });

    test('cells hug content: tiny output is smaller than large output', async ({ page }) => {
        await gotoFreshSession(page);
        await runCommand(page, 'echo tiny', 1500);
        await runCommand(page, 'seq 1 30', 2500);
        const heights = await cellHeights(page);
        expect(heights.length).toBeGreaterThanOrEqual(2);
        expect(heights[0]).toBeLessThan(100);
        expect(heights[1]).toBeGreaterThan(200);
    });

    test('reload hydrates cells from backend', async ({ page }) => {
        await gotoFreshSession(page);
        await runCommand(page, 'echo HYDRATE_A', 1500);
        await runCommand(page, 'echo HYDRATE_B', 1500);
        await page.reload({ waitUntil: 'networkidle' });
        await page.waitForTimeout(2000);
        const body = await page.locator('body').innerText();
        expect(body).toContain('HYDRATE_A');
        expect(body).toContain('HYDRATE_B');
    });

    test('vim renders inside TUI modal and closes cleanly', async ({ page }) => {
        await gotoFreshSession(page);
        const inp = await waitInputReady(page);
        await inp.fill('vim -u NONE /tmp/_regress_vim.txt');
        await inp.press('Enter');
        await page.waitForTimeout(3000);

        const modalText = await page.evaluate(() => {
            const m = document.querySelector('.tui-terminal-container');
            return m ? m.innerText : '';
        });
        expect(modalText, 'vim tildes should be visible in TUI modal').toContain('~');

        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);
        await page.keyboard.type(':q!');
        await page.keyboard.press('Enter');
        await page.waitForTimeout(1500);
        const modalCount = await page.locator('.tui-modal-overlay').count();
        expect(modalCount).toBe(0);
    });

    test('TUI exit shows compact placeholder', async ({ page }) => {
        await gotoFreshSession(page);
        const inp = await waitInputReady(page);
        await inp.fill('vim -u NONE /tmp/_regress_vim2.txt');
        await inp.press('Enter');
        await page.waitForTimeout(2500);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(150);
        await page.keyboard.type(':q!');
        await page.keyboard.press('Enter');
        await page.waitForTimeout(1500);

        const hasPlaceholder = await page.locator('.tui-completed-placeholder').count();
        expect(hasPlaceholder).toBeGreaterThan(0);
        const h = await page.locator('.cell-output').first().evaluate(
            el => Math.round(el.getBoundingClientRect().height)
        );
        expect(h).toBeLessThan(120);
    });

    test('ls renders directories in color', async ({ page }) => {
        await gotoFreshSession(page);
        await runCommand(page, 'ls', 1500);
        const styled = await page.evaluate(() =>
            Array.from(document.querySelectorAll(
                '.snapshot-output [style*="color: #3465a4"]'
            )).map(e => e.textContent.trim())
        );
        // At least one directory should be colored. Test runs in repo root,
        // so backend/frontend/docs are expected.
        expect(styled.some(s => ['backend', 'frontend', 'docs'].includes(s))).toBe(true);
    });

    test('ls -al produces long format with permissions', async ({ page }) => {
        await gotoFreshSession(page);
        await runCommand(page, 'ls -al', 2500);
        const txt = await page.evaluate(
            () => document.querySelector('.snapshot-output')?.innerText || ''
        );
        expect(txt).toContain('total ');
        expect(txt).toMatch(/drwx|-rw-/);
    });

    test('input usable immediately after submit (focus retained)', async ({ page }) => {
        await gotoFreshSession(page);
        const inp = await waitInputReady(page);
        await inp.fill('echo a');
        await inp.press('Enter');
        await page.waitForTimeout(1500);
        // Type without re-focusing — should land in the input
        await page.keyboard.type('echo b');
        const v = await page.locator(INPUT).first().inputValue();
        expect(v).toBe('echo b');
    });

    test('Up arrow recalls previous command from history', async ({ page }) => {
        await gotoFreshSession(page);
        await runCommand(page, 'echo hist-test', 1500);
        const inp = await waitInputReady(page);
        await inp.focus();
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(200);
        const v = await inp.inputValue();
        expect(v).toBe('echo hist-test');
    });

    test('failed command shows exit code badge + red border', async ({ page }) => {
        await gotoFreshSession(page);
        await runCommand(page, 'this-does-not-exist-cmd', 2000);
        const failedCell = await page.locator('.notebook-cell.failed-cell').count();
        const badge = await page.locator('.exit-code-badge').count();
        expect(failedCell).toBeGreaterThan(0);
        expect(badge).toBeGreaterThan(0);
    });

    test('welcome state appears on fresh empty session', async ({ page }) => {
        await gotoFreshSession(page);
        await page.waitForTimeout(1500);
        const hasEmpty = await page.locator('.empty-state').count();
        expect(hasEmpty).toBeGreaterThan(0);
    });

    test('sidebar has no duplicate session entries', async ({ page }) => {
        await gotoFreshSession(page);
        await page.waitForTimeout(1500);
        const ids = await page.locator('.sidebar ul li').evaluateAll(
            els => els.map(e => e.getAttribute('data-session-id'))
        );
        expect(ids.length).toBeGreaterThanOrEqual(1);
        expect(new Set(ids).size).toBe(ids.length);
    });

    // Header should hug its single-line content, not waste ~40-50px of
    // vertical space below the command text. Caused by min-height: 56px
    // + padding: 16px + align-items: flex-start. With a one-line command
    // the header should be roughly 32-56px tall, not 80+.
    test('cell header hugs single-line command (no big gap inside header)', async ({ page }) => {
        await gotoFreshSession(page);
        await runCommand(page, 'pwd', 1500);
        const headerH = await page.locator('.notebook-cell .cell-header').first().evaluate(
            el => Math.round(el.getBoundingClientRect().height)
        );
        // Single-line command + status icon = ~24px content + 2x padding.
        // Allow up to 56px (single-line + comfortable padding). 80+ is the bug.
        expect(headerH).toBeLessThan(64);
    });

    // Cells must survive a backend restart. Tests the SQLite persistence
    // layer end-to-end: run two commands, restart the backend process,
    // reload the page, the cells must still be visible.
    test('cells survive backend restart (persistence)', async ({ page }) => {
        const { execSync } = await import('node:child_process');
        const path = await import('node:path');
        const url = await import('node:url');
        const here = path.dirname(url.fileURLToPath(import.meta.url));
        const repoRoot = path.resolve(here, '..', '..', '..');

        await gotoFreshSession(page);
        await runCommand(page, 'echo PERSIST_MARKER_X', 1500);
        await runCommand(page, 'echo PERSIST_MARKER_Y', 1500);

        const before = await page.locator('body').innerText();
        expect(before).toContain('PERSIST_MARKER_X');
        expect(before).toContain('PERSIST_MARKER_Y');

        execSync('bash scripts/restart_servers.sh', { cwd: repoRoot, env: { ...process.env, CI: 'true' } });
        await page.waitForTimeout(2500);
        await page.reload({ waitUntil: 'networkidle' });
        await page.waitForTimeout(2500);

        const after = await page.locator('body').innerText();
        expect(after).toContain('PERSIST_MARKER_X');
        expect(after).toContain('PERSIST_MARKER_Y');
    });

    // PTY column count must actually use the visible cell width, not
    // leave a third of the horizontal space empty. With a 1600px viewport
    // and ~280px sidebar + 96px padding, the live PTY should get ~155+
    // cols, not ~120.
    test('PTY uses available horizontal space (ls fills width)', async ({ page }) => {
        await gotoFreshSession(page);
        await runCommand(page, 'ls', 2500);
        const data = await page.evaluate(() => {
            const cell = document.querySelector('.notebook-cell');
            const output = cell?.querySelector('.cell-output');
            const snapshot = cell?.querySelector('.snapshot-output');
            const rowDivs = snapshot?.querySelectorAll('pre > div > div') || [];
            const firstRow = rowDivs[0];
            return {
                outputWidth: output?.getBoundingClientRect().width || 0,
                firstRowCharCount: firstRow?.textContent.length || 0,
            };
        });
        // outputWidth at 1600 viewport is ~1208px. With a 9px char width
        // we should fit at least 130 columns. The bug was 120 or less.
        expect(data.outputWidth).toBeGreaterThan(1000);
        expect(data.firstRowCharCount).toBeGreaterThan(140);
    });

    // Tab completion: hitting Tab on a partial token should expand to the
    // matching file/dir in the session's pwd, OR cycle through candidates
    // if multiple matches exist.
    test('tab completion expands a unique path prefix', async ({ page }) => {
        await gotoFreshSession(page);
        const inp = await waitInputReady(page);
        // 'fro' in the termbook repo root is unique-ish to 'frontend'
        // (frontend, frontend-server.log, frontend.log all start with 'fro'),
        // but 'fronten' completes uniquely to 'frontend/' (since others
        // are different lengths). Actually all 3 share the 'fronten'
        // prefix... 'frontend' is the dir. Test the cycling behavior
        // instead.
        await inp.fill('ls fro');
        await inp.press('Tab');
        await page.waitForTimeout(800);
        const val = await inp.inputValue();
        // Backend must respond with at least one candidate starting with 'fro';
        // input becomes 'ls <candidate>'.
        expect(val).toMatch(/^ls fro/);
        expect(val.length).toBeGreaterThan('ls fro'.length);
    });

    test('tab completion cycles through multiple candidates', async ({ page }) => {
        await gotoFreshSession(page);
        const inp = await waitInputReady(page);
        await inp.fill('cd ');
        await inp.press('Tab');
        await page.waitForTimeout(600);
        const first = await inp.inputValue();
        await inp.press('Tab');
        await page.waitForTimeout(300);
        const second = await inp.inputValue();
        // Cycling Tab must show a different candidate.
        expect(second).not.toBe(first);
        // Hint should be visible.
        const hint = await page.locator('.completion-hint').count();
        expect(hint).toBeGreaterThan(0);
    });

    test('tab completion finds executables on PATH (first token)', async ({ page }) => {
        await gotoFreshSession(page);
        const inp = await waitInputReady(page);
        // 'ec' should resolve to 'echo' (a bash builtin and a binary).
        await inp.fill('ec');
        await inp.press('Tab');
        await page.waitForTimeout(600);
        const val = await inp.inputValue();
        expect(val.startsWith('ec')).toBe(true);
        expect(val.length).toBeGreaterThan(2);
    });

    // Ctrl+R opens a fuzzy history search overlay. Typing filters
    // history matches, Enter inserts the selected command into the input.
    test('Ctrl+R fuzzy history search inserts selected command', async ({ page }) => {
        await gotoFreshSession(page);
        const inp = await waitInputReady(page);
        // Build distinct history entries.
        for (const cmd of ['echo aaa', 'echo bbb', 'pwd', 'ls -al', 'echo HIST_TARGET_xyz']) {
            await inp.fill(cmd);
            await inp.press('Enter');
            await page.waitForTimeout(900);
        }
        await inp.focus();
        await page.keyboard.press('Control+r');
        await page.waitForTimeout(400);

        const overlay = await page.locator('.history-search-overlay').count();
        expect(overlay).toBe(1);

        // Fuzzy-search for 'xyz' (only HIST_TARGET_xyz contains it).
        const searchInp = page.locator('.history-search-modal input');
        await searchInp.fill('xyz');
        await page.waitForTimeout(300);
        const rows = await page.locator('.history-search-row').count();
        expect(rows).toBeGreaterThan(0);

        // Press Enter to use selected.
        await searchInp.press('Enter');
        await page.waitForTimeout(300);

        const overlayAfter = await page.locator('.history-search-overlay').count();
        expect(overlayAfter).toBe(0);
        const val = await inp.inputValue();
        expect(val).toContain('HIST_TARGET_xyz');
    });

    test('Ctrl+R can be dismissed with Escape', async ({ page }) => {
        await gotoFreshSession(page);
        const inp = await waitInputReady(page);
        await inp.fill('echo something');
        await inp.press('Enter');
        await page.waitForTimeout(900);
        await inp.focus();
        await page.keyboard.press('Control+r');
        await page.waitForTimeout(300);
        expect(await page.locator('.history-search-overlay').count()).toBe(1);
        await page.locator('.history-search-modal input').press('Escape');
        await page.waitForTimeout(300);
        expect(await page.locator('.history-search-overlay').count()).toBe(0);
    });

    // Cells must display the current git branch as a chip in the header.
    // The repo this test runs in is itself a git repo, so any command run
    // from the repo root should pick up the branch.
    test('cells show git branch chip when inside a git repo', async ({ page }) => {
        await gotoFreshSession(page);
        await runCommand(page, 'pwd', 1500);
        const chipCount = await page.locator('.notebook-cell .cell-env-chip-git').count();
        expect(chipCount).toBeGreaterThan(0);
        const chipText = await page.locator('.cell-env-chip-git').first().innerText();
        // Any non-empty branch name is fine; usually "main" in this repo.
        expect(chipText.trim().length).toBeGreaterThan(0);
    });

    // Activating a Python venv must surface the venv name as a chip on
    // subsequent cells. Tests the OSC 1338 TBENV side-channel.
    test('cells show venv chip after source activate', async ({ page }) => {
        await gotoFreshSession(page);
        const inp = await waitInputReady(page);
        // Build a venv we control. Use python3 -m venv which is on most macs.
        await runCommand(page, 'rm -rf /tmp/tb_test_venv && python3 -m venv /tmp/tb_test_venv', 5000);
        await runCommand(page, 'source /tmp/tb_test_venv/bin/activate && echo VENVON', 1800);
        await runCommand(page, 'echo afterwards', 1500);

        // The third cell (echo afterwards) must have a venv chip.
        const data = await page.evaluate(() => {
            const cells = Array.from(document.querySelectorAll('.notebook-cell'));
            return cells.map(c => ({
                cmd: c.querySelector('.read-only-command')?.textContent,
                venv: c.querySelector('.cell-env-chip-venv')?.textContent,
            }));
        });
        const lastCell = data[data.length - 1];
        expect(lastCell.cmd).toContain('afterwards');
        expect(lastCell.venv || '').toContain('tb_test_venv');
    });

    // Cmd+K opens the action palette. Each action is keyboard-runnable.
    test('Cmd+K opens command palette and runs an action', async ({ page }) => {
        await gotoFreshSession(page);
        const inp = await waitInputReady(page);
        await inp.focus();
        await page.keyboard.press('Meta+k');
        await page.waitForTimeout(300);
        expect(await page.locator('.palette-modal').count()).toBe(1);

        // Multiple actions should be visible.
        expect(await page.locator('.palette-row').count()).toBeGreaterThanOrEqual(4);

        // Filter and run "Search command history" via fuzzy match.
        await page.locator('.palette-modal input').fill('history');
        await page.waitForTimeout(200);
        expect(await page.locator('.palette-row').count()).toBe(1);
        const first = await page.locator('.palette-row').first().textContent();
        expect(first).toContain('Search command history');
        await page.locator('.palette-modal input').press('Enter');
        await page.waitForTimeout(400);
        // Palette closed, history search opened.
        expect(await page.locator('.palette-modal').count()).toBe(0);
        expect(await page.locator('.history-search-overlay').count()).toBe(1);
    });

    // Desktop notifications fire when a long-running command finishes
    // and the tab/window is not focused. Short commands and focused tabs
    // must NOT fire.
    test('long-running command in unfocused tab fires desktop notification', async ({ browser }) => {
        const ctx = await browser.newContext({
            viewport: VIEWPORT,
            permissions: ['notifications'],
        });
        const page = await ctx.newPage();
        const captured = [];
        await page.exposeFunction('__notify_capture', (n) => captured.push(n));
        await page.addInitScript(() => {
            const stub = function(title, opts) {
                window.__notify_capture({ title, body: opts?.body });
                return { close: () => {} };
            };
            stub.permission = 'granted';
            stub.requestPermission = () => Promise.resolve('granted');
            window.Notification = stub;
        });

        await gotoFreshSession(page);
        await page.evaluate(() => {
            Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
            Object.defineProperty(document, 'hasFocus', { value: () => false, configurable: true });
        });

        await runCommand(page, 'echo short', 1500);
        expect(captured.length).toBe(0);

        await runCommand(page, 'sleep 6 && echo done', 7500);
        expect(captured.length).toBe(1);
        expect(captured[0].title).toContain('finished');
        expect(captured[0].body).toContain('sleep 6');

        await runCommand(page, 'sleep 6 && false', 7500);
        expect(captured.length).toBe(2);
        expect(captured[1].title).toContain('failed');
        await ctx.close();
    });

    // Full-screen workspace mode: Cmd+Shift+F (or a button or the palette)
    // hides the sidebar + top-header, expanding the cell area to fill the
    // entire viewport. Must round-trip cleanly via all three triggers.
    test('Cmd+Shift+F hides sidebar and top header', async ({ page }) => {
        await gotoFreshSession(page);
        await waitInputReady(page);
        const before = await page.evaluate(() => ({
            sidebar: getComputedStyle(document.querySelector('.sidebar')).display,
            topHeader: getComputedStyle(document.querySelector('.top-header')).display,
        }));
        expect(before.sidebar).not.toBe('none');
        expect(before.topHeader).not.toBe('none');

        await page.locator('.chat-input-wrapper textarea').first().focus();
        await page.keyboard.press('Meta+Shift+f');
        await page.waitForTimeout(400);

        const after = await page.evaluate(() => ({
            sidebar: getComputedStyle(document.querySelector('.sidebar')).display,
            topHeader: getComputedStyle(document.querySelector('.top-header')).display,
            exitBtn: document.querySelectorAll('.exit-fullscreen-floating').length,
        }));
        expect(after.sidebar).toBe('none');
        expect(after.topHeader).toBe('none');
        expect(after.exitBtn).toBe(1);

        // Toggle back via keyboard.
        await page.keyboard.press('Meta+Shift+f');
        await page.waitForTimeout(400);
        const restored = await page.evaluate(() => ({
            sidebar: getComputedStyle(document.querySelector('.sidebar')).display,
            exitBtn: document.querySelectorAll('.exit-fullscreen-floating').length,
        }));
        expect(restored.sidebar).not.toBe('none');
        expect(restored.exitBtn).toBe(0);
    });

    test('maximize button in header toggles full screen', async ({ page }) => {
        await gotoFreshSession(page);
        await waitInputReady(page);
        await page.locator('.maximize-btn').click();
        await page.waitForTimeout(400);
        expect(await page.evaluate(() =>
            getComputedStyle(document.querySelector('.sidebar')).display
        )).toBe('none');
        // Floating exit button can take us back.
        await page.locator('.exit-fullscreen-floating').click();
        await page.waitForTimeout(400);
        expect(await page.evaluate(() =>
            getComputedStyle(document.querySelector('.sidebar')).display
        )).not.toBe('none');
    });

    test('full-screen preference persists across reload', async ({ page }) => {
        await gotoFreshSession(page);
        await waitInputReady(page);
        await page.locator('.maximize-btn').click();
        await page.waitForTimeout(400);
        await page.reload({ waitUntil: 'networkidle' });
        await page.waitForTimeout(1500);
        const maxAfterReload = await page.evaluate(() =>
            getComputedStyle(document.querySelector('.sidebar')).display === 'none'
        );
        expect(maxAfterReload).toBe(true);
        // Cleanup so we don't pollute subsequent tests.
        await page.evaluate(() => localStorage.setItem('termbook_maximized', '0'));
    });

    test('Cmd+K palette dismisses with Escape', async ({ page }) => {
        await gotoFreshSession(page);
        const inp = await waitInputReady(page);
        await inp.focus();
        await page.keyboard.press('Meta+k');
        await page.waitForTimeout(300);
        expect(await page.locator('.palette-modal').count()).toBe(1);
        await page.locator('.palette-modal input').press('Escape');
        await page.waitForTimeout(300);
        expect(await page.locator('.palette-modal').count()).toBe(0);
    });

    // Tools like gemini-cli go into headless mode when CI=true is set in
    // env. The backend must strip CI (and friends) from the env it passes
    // to the PTY child shell, even if the backend process itself was
    // started with CI=true.
    test('PTY env does not inherit CI=true from backend launcher', async ({ page }) => {
        await gotoFreshSession(page);
        await runCommand(page, 'echo "CI=[${CI:-unset}] GITHUB_ACTIONS=[${GITHUB_ACTIONS:-unset}] TERM_PROGRAM=[${TERM_PROGRAM:-unset}]"', 1500);
        const body = await page.evaluate(() => document.querySelector('.cell-output')?.innerText || '');
        expect(body).toContain('CI=[unset]');
        expect(body).toContain('GITHUB_ACTIONS=[unset]');
        expect(body).toContain('TERM_PROGRAM=[termbook]');
    });

    // Inline TUI promotion: tools like gemini-cli, claude-cli, and other
    // Ink-based interactive CLIs render full-screen prompts WITHOUT
    // entering the alt-screen buffer (no OSC 1049h). The backend detects
    // these via accumulated cursor-move ANSI activity and promotes the
    // cell to TUI mode so the modal opens and routes input to the PTY.
    test('inline TUI command (cursor-move-heavy) opens the TUI modal', async ({ page }) => {
        await gotoFreshSession(page);
        const inp = await waitInputReady(page);
        // Spin up a tiny inline-TUI emulator: ~80 cursor moves should cross
        // the promotion threshold (60).
        // Each \\x1B[3A;3G moves the cursor; the sleep keeps the process
        // alive so we can observe the TUI modal in the DOM.
        await inp.fill('for i in $(seq 1 80); do printf "\\033[1A\\033[3G"; done; sleep 3');
        await inp.press('Enter');
        // Wait for promotion (debounce + modal open).
        await page.waitForTimeout(2000);
        const modal = await page.locator('.tui-modal-overlay').count();
        expect(modal).toBe(1);
        // Wait for the sleep to finish so the cell closes cleanly and
        // doesn't leak into the next test.
        await page.waitForTimeout(3000);
    });

    // Activating a venv must NOT leak the "(venv) " prompt prefix into
    // subsequent cell output. VIRTUAL_ENV_DISABLE_PROMPT=1 in our bashrc
    // prevents the venv activate script from mutating PS1.
    test('venv activation does not leak (venv) prompt into cell output', async ({ page }) => {
        await gotoFreshSession(page);
        await runCommand(page, 'rm -rf /tmp/tb_test_venv2 && python3 -m venv /tmp/tb_test_venv2', 5000);
        await runCommand(page, 'source /tmp/tb_test_venv2/bin/activate && echo ON', 1800);
        await runCommand(page, 'echo CLEAN_OUTPUT', 1500);

        const lastBody = await page.evaluate(() => {
            const cells = Array.from(document.querySelectorAll('.notebook-cell'));
            return cells[cells.length - 1]?.querySelector('.cell-output')?.innerText || '';
        });
        expect(lastBody).toContain('CLEAN_OUTPUT');
        expect(lastBody).not.toContain('(tb_test_venv2)');
    });
});
