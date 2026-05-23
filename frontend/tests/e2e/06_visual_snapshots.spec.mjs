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
//
// IMPORTANT: any UI element that displays a path or hostname derived
// from the local filesystem (sidebar session IDs, top pwd-breadcrumb,
// per-cell pwd chip, the chat-input host prefix) MUST be in the
// `mask` list — those values vary per contributor and would otherwise
// either fail the diff on every other machine or, worse, bake the
// original committer's username into the golden PNG forever.
//
// The pwd cell test additionally runs commands inside `/tmp` so that
// the command OUTPUT (which is canvas-rendered xterm content, NOT a
// DOM element that mask can hide) doesn't carry a username either.

import { test, expect } from '@playwright/test';
import {
    VIEWPORT,
    gotoFreshSession,
    runCommand,
    waitInputReady,
    shot,
} from './helpers.mjs';

test.use({ viewport: VIEWPORT });

// Per-contributor volatile UI that must be masked from every golden.
// Returns a function called with `page` (Playwright doesn't accept
// re-resolving locators across tests, so we resolve fresh each time).
const volatileMasks = (page) => [
    page.locator('.sidebar ul li'),         // session IDs
    page.locator('.cell-time'),             // wall-clock time
    page.locator('.cell-duration'),         // ms
    page.locator('.pwd-breadcrumb'),        // top breadcrumb shows pwd / username
    page.locator('.cell-header-breadcrumb'),// per-cell pwd chip
    page.locator('.pwd-prompt-prefix'),     // chat input shows hostname
];

// Pixel snapshots are platform-specific (font rendering, antialiasing,
// and font availability differ between macOS and Linux). The goldens
// committed to this repo were generated on macOS; running these on a
// Linux CI runner will fail with "no snapshot for platform" or pixel
// diffs that have nothing to do with the SUT.
//
// We skip them on non-darwin platforms. The OTHER 57 e2e tests run on
// every platform — those gate CI for cross-platform correctness.
// Contributors on Linux who want to regenerate the goldens for their
// own platform can run `npm run test:e2e:update` locally; the
// per-platform golden files (chromium-linux.png) coexist with the
// darwin ones in tests/e2e/*-snapshots/.
test.describe('visual snapshots', () => {
    test.skip(process.platform !== 'darwin', 'pixel goldens are darwin-only');

    test('welcome state pixels match golden', async ({ page }, testInfo) => {
        await gotoFreshSession(page);
        // Wait for layout to settle.
        await page.waitForTimeout(800);
        await expect(page).toHaveScreenshot('welcome.png', {
            mask: volatileMasks(page),
        });
        await shot(page, testInfo, 'welcome_for_log');
    });

    test('cell after pwd matches golden (modulo timestamps and session id)', async ({ page }, testInfo) => {
        await gotoFreshSession(page);
        // Run from /tmp so the pwd OUTPUT is `/tmp`, not the contributor's
        // home directory. The output text is rendered into xterm's canvas
        // and cannot be hidden via `mask`, so we change the command
        // instead.
        await runCommand(page, 'cd /tmp && pwd');
        await page.waitForTimeout(500);
        await expect(page).toHaveScreenshot('pwd_cell.png', {
            mask: volatileMasks(page),
        });
        await shot(page, testInfo, 'pwd_for_log');
    });

    test('command palette overlay matches golden', async ({ page }, testInfo) => {
        await gotoFreshSession(page);
        await waitInputReady(page);
        await page.keyboard.press('Meta+k');
        await page.waitForTimeout(500);
        await expect(page).toHaveScreenshot('palette.png', {
            mask: volatileMasks(page),
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
            mask: volatileMasks(page),
        });
        await shot(page, testInfo, 'history_for_log');
    });
});
