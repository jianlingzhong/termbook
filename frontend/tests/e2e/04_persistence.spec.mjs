// E2E: SQLite persistence across backend restart.
//
// Runs commands, restarts the backend (via scripts/restart_servers.sh
// invoked from execSync), reloads the page, verifies cells are still
// visible AND that a fresh PTY is spawned successfully on next
// interaction (the lazy-respawn path).

import { test, expect } from '@playwright/test';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    VIEWPORT,
    gotoFreshSession,
    runCommand,
    shot,
    lastCellInfo,
    cellCount,
} from './helpers.mjs';

test.use({ viewport: VIEWPORT });

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');

test.describe('persistence', () => {

    test('cells survive backend restart + page reload', async ({ page }, testInfo) => {
        await gotoFreshSession(page);

        await runCommand(page, 'echo PERSIST_MARKER_ALPHA');
        await runCommand(page, 'pwd');
        await runCommand(page, 'echo PERSIST_MARKER_OMEGA');
        await shot(page, testInfo, 'before_restart');

        const bodyBefore = await page.locator('body').innerText();
        expect(bodyBefore).toContain('PERSIST_MARKER_ALPHA');
        expect(bodyBefore).toContain('PERSIST_MARKER_OMEGA');
        const cellsBefore = await cellCount(page);

        execSync('bash scripts/restart_servers.sh', {
            cwd: repoRoot,
            env: { ...process.env, CI: 'true' },
        });
        await page.waitForTimeout(2500);
        await page.reload({ waitUntil: 'networkidle' });
        await page.waitForTimeout(2500);
        await shot(page, testInfo, 'after_restart');

        const bodyAfter = await page.locator('body').innerText();
        expect(bodyAfter).toContain('PERSIST_MARKER_ALPHA');
        expect(bodyAfter).toContain('PERSIST_MARKER_OMEGA');
        const cellsAfter = await cellCount(page);
        expect(cellsAfter).toBe(cellsBefore);

        // Lazy PTY respawn: type a new command and verify a fresh shell answers.
        await runCommand(page, 'echo PERSIST_AFTER_RESTART_OK');
        await shot(page, testInfo, 'after_restart_new_cmd');
        const last = await lastCellInfo(page);
        expect(last.output).toContain('PERSIST_AFTER_RESTART_OK');
        expect(last.isSuccess).toBe(true);
    });
});
