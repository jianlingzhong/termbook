// End-to-end test helpers.
//
// These tests simulate REAL human interaction — typing, pressing Enter,
// waiting for the UI to settle, scrolling, switching sessions — and verify
// both behavior AND pixel-level appearance via screenshots/screencasts.
//
// Every test should:
//   1. Start from a known state (gotoFreshSession or a hydrated DB)
//   2. Drive the app via keyboard/mouse interactions
//   3. Take labeled screenshots at key states
//   4. Optionally record a screencast for motion-sensitive assertions
//   5. Assert both functional outcomes AND visual stability
//
// Output:
//   - Screenshots: test-results/<test-name>/<step>.png
//   - Video: test-results/<test-name>/video.webm (auto, via playwright config)
//   - HTML report: playwright-report-e2e/ (auto)

import { expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

export const INPUT = '.chat-input-wrapper textarea';
export const VIEWPORT = { width: 1600, height: 900 };
export const BASE_URL = process.env.TERMBOOK_BASE_URL || 'http://localhost:4000';

// Wait until the chat input is enabled and ready to accept new commands.
// In passthrough mode the input is also "ready" (it forwards keystrokes),
// but tests that submit a NEW command should pass waitForCommandReady: true
// to also wait for any currently-running command to finish.
export async function waitInputReady(page, { timeoutMs = 15000, waitForCommandReady = false } = {}) {
    const inp = page.locator(INPUT).first();
    await inp.waitFor({ state: 'visible', timeout: timeoutMs });
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const state = await page.evaluate(() => ({
            disabled: document.querySelector('.chat-input-wrapper textarea')?.disabled,
            passthrough: !!document.querySelector('.chat-input-wrapper.is-passthrough'),
            tui: !!document.querySelector('.chat-input-wrapper.is-tui'),
        })).catch(() => ({ disabled: true }));
        if (state.disabled) { await page.waitForTimeout(150); continue; }
        if (waitForCommandReady && (state.passthrough || state.tui)) {
            await page.waitForTimeout(150);
            continue;
        }
        return inp;
    }
    throw new Error('Input never became ready');
}

// Run a single command and wait for it to finish.
// Throws if the command stays running past timeoutMs.
export async function runCommand(page, cmd, { afterWaitMs = 800, timeoutMs = 30000 } = {}) {
    const inp = await waitInputReady(page, { waitForCommandReady: true });
    await inp.fill(cmd);
    await inp.press('Enter');
    // Wait until command finishes (no .active-cell).
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        await page.waitForTimeout(150);
        const running = await page.locator('.notebook-cell.active-cell').count();
        if (running === 0) {
            await page.waitForTimeout(afterWaitMs);
            return;
        }
    }
    throw new Error(`Command did not finish within ${timeoutMs}ms: ${cmd}`);
}

// Submit a command but do NOT wait for it to finish (used for interactive
// commands the test will then talk to via passthrough).
export async function startCommand(page, cmd) {
    const inp = await waitInputReady(page, { waitForCommandReady: true });
    await inp.fill(cmd);
    await inp.press('Enter');
    return inp;
}

// Wait for the chat input to enter passthrough mode (a command is running
// and the input is forwarding keystrokes to its PTY).
export async function waitForPassthrough(page, timeoutMs = 5000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const passthrough = await page.evaluate(() =>
            !!document.querySelector('.chat-input-wrapper.is-passthrough')
        ).catch(() => false);
        if (passthrough) return;
        await page.waitForTimeout(100);
    }
    throw new Error(`Passthrough mode never activated within ${timeoutMs}ms`);
}

// Wait until the running command exits AND passthrough is gone.
export async function waitForIdle(page, timeoutMs = 30000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const r = await page.evaluate(() => ({
            running: document.querySelectorAll('.notebook-cell.active-cell').length,
            passthrough: !!document.querySelector('.chat-input-wrapper.is-passthrough'),
            tui: !!document.querySelector('.chat-input-wrapper.is-tui'),
        })).catch(() => ({ running: 1 }));
        if (r.running === 0 && !r.passthrough && !r.tui) return;
        await page.waitForTimeout(150);
    }
    throw new Error(`App did not return to idle within ${timeoutMs}ms`);
}

export async function gotoFreshSession(page) {
    await page.goto(`${BASE_URL}/?new_session=true`, { waitUntil: 'networkidle' });
    await waitInputReady(page);
}

// Send a sequence of keystrokes via Playwright's keyboard.
// `steps` is an array of either strings (use page.keyboard.type) or
// objects { press: 'KeyName' } for key events.
export async function sendKeystrokes(page, steps, { delayMs = 30 } = {}) {
    for (const s of steps) {
        if (typeof s === 'string') {
            await page.keyboard.type(s, { delay: 0 });
        } else if (s.press) {
            await page.keyboard.press(s.press);
        } else if (s.combo) {
            await page.keyboard.press(s.combo);
        }
        await page.waitForTimeout(delayMs);
    }
}

// Take a labeled screenshot. Path is rooted at the test's results dir.
// Returns the path relative to repo for easy logging.
export async function shot(page, testInfo, label) {
    const dir = testInfo.outputDir;
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${pad(testInfo.shotCounter ?? 0)}_${label}.png`);
    testInfo.shotCounter = (testInfo.shotCounter ?? 0) + 1;
    await page.screenshot({ path: file, fullPage: true });
    // Attach to the test report so it's visible in the HTML output.
    await testInfo.attach(label, { path: file, contentType: 'image/png' });
    return file;
}

function pad(n) { return String(n).padStart(2, '0'); }

// Sample a numeric property over a window — for catching motion flashes.
export async function sampleDuring(page, evaluator, ms, intervalMs = 30) {
    const samples = [];
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
        const v = await page.evaluate(evaluator).catch(() => null);
        if (v != null) samples.push({ t: Date.now(), v });
        await page.waitForTimeout(intervalMs);
    }
    return samples;
}

// Count cells visible in the notebook.
export async function cellCount(page) {
    return await page.locator('.notebook-cell').count();
}

// Inspect the last cell's metadata.
export async function lastCellInfo(page) {
    return await page.evaluate(() => {
        const cells = Array.from(document.querySelectorAll('.notebook-cell'));
        const cell = cells[cells.length - 1];
        if (!cell) return null;
        return {
            cmd: cell.querySelector('.read-only-command')?.textContent || null,
            exitBadge: cell.querySelector('.exit-badge')?.textContent || null,
            isRunning: cell.classList.contains('active-cell'),
            isFailed: cell.classList.contains('failed-cell'),
            isSuccess: cell.classList.contains('success-cell'),
            output: (cell.querySelector('.cell-output')?.innerText || '').trim(),
            gitChip: cell.querySelector('.cell-env-chip-git')?.innerText || null,
            venvChip: cell.querySelector('.cell-env-chip-venv')?.innerText || null,
            condaChip: cell.querySelector('.cell-env-chip-conda')?.innerText || null,
            pwdBreadcrumb: cell.querySelector('.cell-header-breadcrumb')?.innerText || null,
        };
    });
}
