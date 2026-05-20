// E2E: a realistic developer session.
//
// Drives the same kind of commands a real user would type after opening
// Termbook to do dev work: pwd, git status, git log, ls, cat a file,
// re-run via Cmd+K, search history via Ctrl+R, full-screen toggle.
// Captures screenshots at each step.

import { test, expect } from '@playwright/test';
import {
    VIEWPORT,
    gotoFreshSession,
    runCommand,
    waitInputReady,
    shot,
    lastCellInfo,
    cellCount,
} from './helpers.mjs';

test.use({ viewport: VIEWPORT });

test.describe('dev workflow', () => {

    test('full session: pwd, git, ls, cat, history recall, palette, full-screen', async ({ page }, testInfo) => {
        await gotoFreshSession(page);
        await shot(page, testInfo, 'welcome');

        // Foundational commands.
        await runCommand(page, 'pwd');
        await runCommand(page, 'git status');
        await shot(page, testInfo, 'after_git_status');

        const last = await lastCellInfo(page);
        expect(last.cmd).toContain('git status');
        expect(last.gitChip).toBeTruthy();  // branch chip should appear inside a git repo
        expect(last.isSuccess).toBe(true);

        await runCommand(page, 'git --no-pager log --oneline -5');
        await runCommand(page, 'ls backend');
        await shot(page, testInfo, 'after_ls_backend');

        // Cat a file we know exists.
        await runCommand(page, 'cat package.json | head -5');
        const cat = await lastCellInfo(page);
        expect(cat.output).toContain('"name"');

        expect(await cellCount(page)).toBeGreaterThanOrEqual(5);

        // Ctrl+R fuzzy history search.
        const inp = await waitInputReady(page);
        await inp.focus();
        await page.keyboard.press('Control+r');
        await page.waitForTimeout(400);
        await shot(page, testInfo, 'history_search_open');
        expect(await page.locator('.history-search-overlay').count()).toBe(1);

        await page.locator('.history-search-modal input').fill('git');
        await page.waitForTimeout(300);
        await shot(page, testInfo, 'history_search_filtered_git');
        const rowCount = await page.locator('.history-search-row').count();
        expect(rowCount).toBeGreaterThan(0);

        await page.locator('.history-search-modal input').press('Enter');
        await page.waitForTimeout(300);
        expect(await page.locator('.history-search-overlay').count()).toBe(0);
        const inputAfterHistory = await page.locator('.chat-input-wrapper textarea').first().inputValue();
        expect(inputAfterHistory).toContain('git');
        await page.locator('.chat-input-wrapper textarea').first().fill('');

        // Cmd+K palette.
        await inp.focus();
        await page.keyboard.press('Meta+k');
        await page.waitForTimeout(400);
        await shot(page, testInfo, 'palette_open');
        expect(await page.locator('.palette-modal').count()).toBe(1);
        // Should contain at minimum 4 of our known actions.
        const actionCount = await page.locator('.palette-row').count();
        expect(actionCount).toBeGreaterThanOrEqual(4);
        await page.locator('.palette-modal input').press('Escape');
        await page.waitForTimeout(300);

        // Cmd+Shift+F to maximize.
        await inp.focus();
        await page.keyboard.press('Meta+Shift+f');
        await page.waitForTimeout(400);
        await shot(page, testInfo, 'maximized');
        expect(await page.evaluate(() =>
            getComputedStyle(document.querySelector('.sidebar')).display
        )).toBe('none');

        // Run a command while maximized — wider PTY should give more columns.
        await runCommand(page, 'ls');
        await shot(page, testInfo, 'ls_in_maximized');

        // Restore.
        await page.keyboard.press('Meta+Shift+f');
        await page.waitForTimeout(400);
        await shot(page, testInfo, 'restored');
        expect(await page.evaluate(() =>
            getComputedStyle(document.querySelector('.sidebar')).display
        )).not.toBe('none');
    });
});
