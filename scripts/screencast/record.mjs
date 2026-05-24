// Drives Termbook through a diverse workflow with Playwright, recording
// video. Run with: node scripts/screencast/record.mjs
//
// Prereqs:
//   - Termbook backend + frontend running on http://localhost:4000
//     (run `bash scripts/restart_servers.sh` first)
//   - The demo directory /tmp/termbook-demo is created with safe-to-show
//     content (see prep step at bottom).
//
// Output: scripts/screencast/output/video.webm
// Then run scripts/screencast/to-gif.sh to convert to optimized gif.

// Import from frontend/node_modules since playwright is installed there.
import pkg from '../../frontend/node_modules/playwright/index.js';
const { chromium } = pkg;
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, 'output');
const BASE_URL = process.env.TERMBOOK_BASE_URL || 'http://localhost:4000';
const VIEWPORT = { width: 1280, height: 800 }; // narrower → smaller gif

fs.rmSync(OUT_DIR, { recursive: true, force: true });
fs.mkdirSync(OUT_DIR, { recursive: true });

// Helpers ───────────────────────────────────────────────────────────────────
const INPUT = '.chat-input-wrapper textarea';

async function waitReady(page, { timeoutMs = 15000, waitForCommandReady = false } = {}) {
    const inp = page.locator(INPUT).first();
    await inp.waitFor({ state: 'visible', timeout: timeoutMs });
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const s = await page.evaluate(() => ({
            disabled: document.querySelector('.chat-input-wrapper textarea')?.disabled,
            passthrough: !!document.querySelector('.chat-input-wrapper.is-passthrough'),
            tui: !!document.querySelector('.chat-input-wrapper.is-tui'),
        })).catch(() => ({ disabled: true }));
        if (s.disabled) { await page.waitForTimeout(100); continue; }
        if (waitForCommandReady && (s.passthrough || s.tui)) { await page.waitForTimeout(100); continue; }
        return inp;
    }
    throw new Error('input never ready');
}

async function typeSlowly(page, cmd, perCharMs = 35) {
    const inp = await waitReady(page, { waitForCommandReady: true });
    await inp.click();
    for (const ch of cmd) {
        await page.keyboard.type(ch);
        await page.waitForTimeout(perCharMs);
    }
}

async function runCmd(page, cmd, { afterMs = 700, timeoutMs = 30000 } = {}) {
    await typeSlowly(page, cmd);
    await page.waitForTimeout(300);
    await page.keyboard.press('Enter');
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        await page.waitForTimeout(150);
        const running = await page.locator('.notebook-cell.active-cell').count();
        if (running === 0) { await page.waitForTimeout(afterMs); return; }
    }
    throw new Error(`timed out: ${cmd}`);
}

// Run a command but don't wait for finish (interactive / passthrough).
async function startCmd(page, cmd) {
    await typeSlowly(page, cmd);
    await page.waitForTimeout(300);
    await page.keyboard.press('Enter');
}

async function pause(page, ms) { await page.waitForTimeout(ms); }

// Main ──────────────────────────────────────────────────────────────────────
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
    viewport: VIEWPORT,
    recordVideo: { dir: OUT_DIR, size: VIEWPORT },
});
const page = await ctx.newPage();

// Override /api/config to replace the user's actual hostname with a
// generic one. The hostname is shown in the chat input prompt
// (`<host> ❯`) and would otherwise leak into the screencast.
await page.route('**/api/config', async (route) => {
    const resp = await route.fetch();
    const body = await resp.json();
    body.localHostname = 'localhost';
    await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(body),
    });
});

// Inject CSS via initScript to hide breadcrumb elements that would
// otherwise show the recorder's home directory. The backend's launch dir
// (e.g. /Users/<name>/path/to/termbook) appears in:
//   - the top .pwd-breadcrumb (until the user cd's elsewhere)
//   - the per-cell .cell-header-breadcrumb on cells run from there
// We hide the top breadcrumb outright (it's redundant with the
// per-cell info), and hide any cell breadcrumb whose text contains
// the current user's name or `/Users/<name>/`. Override the substring
// list via TERMBOOK_DEMO_MASK (comma-separated) if needed.
const userName = process.env.USER || process.env.USERNAME || '';
// Mask anything that smells like the recorder's home directory. The
// userName check catches `/Users/<name>/...` formatted chips; the bare
// `/Users/` and `/home/` checks catch any other path under those
// roots that the recorder may have wandered through before the demo
// `cd`. Aggressive but harmless: legitimate cells in the demo run
// under `/tmp/termbook-demo`, which contains none of these strings.
const defaultMasks = [userName, `/Users/${userName}/`, `/home/${userName}/`, '/Users/', '/home/']
    .filter(s => s && s.length >= 3);
const extraMasks = (process.env.TERMBOOK_DEMO_MASK || '')
    .split(',').map(s => s.trim()).filter(Boolean);
const MASKS = [...defaultMasks, ...extraMasks];

// IMPORTANT: addInitScript runs at document_start, BEFORE the DOM is
// constructed. document.head and document.documentElement are both
// null at that moment, so any synchronous DOM manipulation throws
// (silently — Playwright's init scripts don't surface errors), and
// any later setInterval scheduled AFTER the throw never runs.
//
// Wrap the setup in a DOMContentLoaded handler so the style+observer
// are installed after the document tree exists.
await page.addInitScript((masks) => {
    const install = () => {
        const style = document.createElement('style');
        style.textContent = `
            .pwd-breadcrumb { visibility: hidden !important; }
            /* Hide right-side path chips that still hold the launch dir. */
            .cell-header-breadcrumb[data-leak-mask="1"] { visibility: hidden !important; }
        `;
        document.head.appendChild(style);
        const mask = () => {
            document.querySelectorAll('.cell-header-breadcrumb').forEach(el => {
                const txt = el.textContent || '';
                if (masks.some(m => m && txt.includes(m))) {
                    el.setAttribute('data-leak-mask', '1');
                }
            });
        };
        new MutationObserver(mask).observe(document.documentElement, {
            childList: true, subtree: true, characterData: true,
        });
        setInterval(mask, 200);
    };
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', install, { once: true });
    } else {
        install();
    }
}, MASKS);

console.log('[screencast] navigating to fresh session…');
await page.goto(`${BASE_URL}/?new_session=true`, { waitUntil: 'networkidle' });
await waitReady(page);

// Belt-and-suspenders: re-apply the leak-mask styles after the React
// app has rendered. addInitScript runs at document_start, which works,
// but if for any reason the <style> got stripped by React we re-inject.
await page.addStyleTag({
    content: `
        .pwd-breadcrumb { visibility: hidden !important; }
        .cell-header-breadcrumb[data-leak-mask="1"] { visibility: hidden !important; }
    `,
});

await pause(page, 800);

// Everything happens in /tmp/termbook-demo — a throwaway git repo with
// safe contents (see scripts/screencast/prep.sh). Nothing from the
// user's actual filesystem is shown.

// 1. Orient: cd in, show pwd
console.log('[screencast] step 1: cd + pwd');
await runCmd(page, 'cd /tmp/termbook-demo');
await runCmd(page, 'pwd');

// 2. Non-TUI streaming output: ls. Use bare `ls` (not `ls -la`) so
// file-owner columns don't leak the actual username.
console.log('[screencast] step 2: ls');
await runCmd(page, 'ls');

// 3. Text output: cat README
console.log('[screencast] step 3: cat README.md');
await runCmd(page, 'cat README.md');

// 4. Git — shows the env chip and demo commits
console.log('[screencast] step 4: git log');
await runCmd(page, 'git --no-pager log --oneline');

// 5. Streaming output: find
console.log('[screencast] step 5: find files');
await runCmd(page, 'find . -type f -not -path "./.git/*"');

// 6. TUI demo — open vim in the modal, type, save & quit
console.log('[screencast] step 6: vim modal');
await startCmd(page, 'vim notes.md');
// Wait for TUI modal to open (CSS class is `.tui-modal-overlay`,
// not `.tui-modal` — silently waiting on a missing selector then
// falling through after timeout was the prior behavior).
await page.waitForSelector('.tui-modal-overlay', { timeout: 8000 }).catch(() => {});
await pause(page, 1500);
// Enter insert mode, type, escape, save & quit
await page.keyboard.press('i');
await pause(page, 400);
await page.keyboard.type('Termbook makes the terminal feel like a notebook.', { delay: 50 });
await pause(page, 800);
await page.keyboard.press('Escape');
await pause(page, 400);
await page.keyboard.type(':wq');
await pause(page, 400);
await page.keyboard.press('Enter');
await pause(page, 1500);

// 7. Verify the file was written
console.log('[screencast] step 7: cat the new file');
await runCmd(page, 'cat notes.md');

// 8. Scroll back to show the cell history. Each new submit auto-scrolls
// the latest cell to the top of the viewport (the "Warp / Jupyter
// feel"), which on a 45-second walkthrough means by the time we hit
// step 7 only the latest 1-2 cells are visible. The whole point of
// the cell model is invisible unless we wheel up and let viewers see
// the stacked cells. Slow wheel up so it reads as deliberate
// navigation; pause at the top so the structure is legible.
console.log('[screencast] step 8: scroll back to show cell history');
const scroller = page.locator('.notebook-content');
await scroller.hover();
// Take multiple smaller wheels so the scroll animates smoothly instead
// of jumping. ~7 wheel events of 220px each at 240ms intervals
// scrolls past ~1500px (enough to bring early cells into view) over
// ~1.7s — a comfortable read tempo.
for (let i = 0; i < 7; i++) {
    await page.mouse.wheel(0, -220);
    await pause(page, 240);
}
await pause(page, 1800);  // pause at top so the cell stack is legible

// 9. Show a new session (multi-session). cd immediately so the path
// chip doesn't expose the backend's launch directory.
console.log('[screencast] step 9: new session');
await page.locator('.sidebar h2 + button').click();
await pause(page, 1800);
await waitReady(page);
await runCmd(page, 'cd /tmp/termbook-demo && echo "Each session has its own shell, cwd, and history."');

// 10. Final flourish — switch back to first session to show persistence
console.log('[screencast] step 10: switch back to first session');
const sessions = page.locator('.sidebar ul li');
await sessions.nth(0).click();
await pause(page, 2500);

console.log('[screencast] closing…');
await ctx.close();
await browser.close();

// Find the video file (playwright names it with a hash)
const files = fs.readdirSync(OUT_DIR).filter(f => f.endsWith('.webm'));
if (files.length === 0) {
    console.error('[screencast] FAIL: no video produced');
    process.exit(1);
}
const src = path.join(OUT_DIR, files[0]);
const dst = path.join(OUT_DIR, 'video.webm');
if (src !== dst) fs.renameSync(src, dst);
console.log(`[screencast] DONE: ${dst}`);
