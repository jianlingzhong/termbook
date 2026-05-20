// E2E: pixel-level visual regression snapshots.
//
// Uses Playwright's `toHaveScreenshot` which diffs against a stored golden
// PNG. The first run creates the golden image; subsequent runs fail if
// pixels differ beyond the configured tolerance (set in playwright.e2e.config.js).
//
// To regenerate goldens after an intentional UI change:
//   npm run test:e2e -- --update-snapshots
//
// Goldens live in tests/e2e/06_visual_snapshots.spec.mjs-snapshots/

import { test, expect } from '@playwright/test';
import {
    VIEWPORT,
    gotoFreshSession,
    runCommand,
    waitInputReady,
    shot,
} from './helpers.mjs';

test.use({ viewport: VIEWPORT });

test.describe('visual snapshots', () => {

    test('welcome state pixels match golden', async ({ page }, testInfo) => {
        await gotoFreshSession(page);
        // Wait for layout to settle.
        await page.waitForTimeout(800);
        await expect(page).toHaveScreenshot('welcome.png', {
            // Mask the session-id chip in the sidebar — it changes every run.
            mask: [page.locator('.sidebar ul li')],
        });
        await shot(page, testInfo, 'welcome_for_log');
    });

    test('cell after pwd matches golden (modulo timestamps and session id)', async ({ page }, testInfo) => {
        await gotoFreshSession(page);
        await runCommand(page, 'pwd');
        await page.waitForTimeout(500);
        await expect(page).toHaveScreenshot('pwd_cell.png', {
            mask: [
                page.locator('.sidebar ul li'),
                page.locator('.cell-time'),    // wall-clock time
                page.locator('.cell-duration'), // ms
            ],
        });
        await shot(page, testInfo, 'pwd_for_log');
    });

    test('command palette overlay matches golden', async ({ page }, testInfo) => {
        await gotoFreshSession(page);
        await waitInputReady(page);
        await page.keyboard.press('Meta+k');
        await page.waitForTimeout(500);
        await expect(page).toHaveScreenshot('palette.png', {
            mask: [page.locator('.sidebar ul li')],
        });
        await shot(page, testInfo, 'palette_for_log');
    });

    test('history search overlay matches golden', async ({ page }, testInfo) => {
        await gotoFreshSession(page);
        await runCommand(page, 'echo seed_one');
        await runCommand(page, 'echo seed_two');
        await page.keyboard.press('Control+r');
        await page.waitForTimeout(500);
        await expect(page).toHaveScreenshot('history_search.png', {
            mask: [
                page.locator('.sidebar ul li'),
                page.locator('.cell-time'),
                page.locator('.cell-duration'),
            ],
        });
        await shot(page, testInfo, 'history_for_log');
    });
});
