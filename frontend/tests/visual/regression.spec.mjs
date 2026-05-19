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
});
