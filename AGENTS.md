# AGENTS.md

Operating manual for AI coding agents (Claude, Codex, etc.) working on
Termbook. Read this end-to-end before touching code.

This file is the source of truth for *how to work in this repo* — what to do,
what not to do, where the traps are, and what "done" looks like.

## TL;DR for the impatient

1. Read [`docs/architecture.md`](docs/architecture.md) to understand the
   data flow. Two processes (backend Node + frontend Vite) talk over a
   single WebSocket. There is no other transport.
2. Read [`docs/decisions.md`](docs/decisions.md) before changing anything
   in `backend/server.js`, `backend/parser.js`, `frontend/src/NotebookCell.jsx`,
   or `frontend/src/App.jsx`. Most of those lines exist because of a
   specific bug. Don't re-introduce them.
3. The test suites that matter are:
   - `frontend/tests/visual/*.spec.mjs` (40+ tests) — fast functional +
     motion regressions. Run with `npm run test:visual`.
   - `frontend/tests/e2e/*.spec.mjs` (20+ tests) — full human-workflow
     E2E with screenshots, video, pixel goldens. Run with
     `npm run test:e2e`.
   - `npm run test:all` runs both.
   The legacy `frontend/tests/*.spec.{js,ts}` is abandoned cruft
   — do not run or modify it.
4. Before claiming "done": `npm run test:all` must pass green. Show the
   user real screenshots or videos of the change (the e2e tests produce
   these automatically in `frontend/test-results/`).
5. **Never delete an e2e test as "ad-hoc debug script".** If you wrote
   a Playwright driver to investigate something, promote it into
   `tests/e2e/` — that's how this codebase stays well-tested. See
   `frontend/tests/e2e/README.md`.

## Project layout

```
termbook/
├── README.md
├── AGENTS.md                    ← you are here
├── app_config.json              ← branding (appName, markerPrefix)
├── mprocs.yaml                  ← dev runner alternative
├── scripts/
│   └── restart_servers.sh       ← clean restart of both servers
├── backend/                     ← Node.js Express + ws + node-pty
│   ├── server.js                  ← single-file server (~450 lines, do read it)
│   ├── parser.js                  ← prompt-marker detector (~35 lines)
│   └── package.json
├── frontend/                    ← React 19 + Vite + xterm.js
│   ├── src/
│   │   ├── App.jsx                ← session/cell/WS state, ~540 lines
│   │   ├── NotebookCell.jsx       ← per-cell rendering, ~285 lines
│   │   ├── TuiModal.jsx           ← full-screen TUI host, ~95 lines
│   │   └── index.css              ← all styles
│   ├── tests/visual/            ← curated regression + motion suite
│   │   ├── motion.spec.mjs        ← catches transient flashes
│   │   ├── regression.spec.mjs    ← catches functional regressions
│   │   ├── helpers.mjs
│   │   └── README.md
│   ├── tests/e2e/               ← end-to-end human-workflow suite
│   │   ├── 01_dev_workflow.spec.mjs
│   │   ├── 02_interactive_commands.spec.mjs
│   │   ├── 03_alt_screen_tui.spec.mjs
│   │   ├── 04_persistence.spec.mjs
│   │   ├── 05_motion_stability.spec.mjs
│   │   ├── 06_visual_snapshots.spec.mjs        ← pixel goldens
│   │   ├── 06_*-snapshots/                     ← golden PNGs (committed)
│   │   ├── helpers.mjs
│   │   └── README.md
│   ├── tests/                   ← ~50 abandoned audit scripts (ignore)
│   ├── playwright.config.ts        ← legacy config (ignore)
│   ├── playwright.visual.config.js ← visual / regression suite
│   └── playwright.e2e.config.js    ← e2e suite (video always on)
└── docs/                        ← see Documentation in README
```

The repo also contains ~1800 audit PNGs (`*_frames/`, `gemini_tui_*.png`),
several `.webm` videos, and `.md` audit reports from earlier debugging work.
**Do not touch them.** They are not in scope and deleting them is a separate
explicit task.

## Working rules

### Always

- Use the dev loop: `bash scripts/restart_servers.sh`, then drive the app
  with Playwright (headless chromium) to verify behavior. Don't trust that
  "the code looks right" — drive it.
- For any UI/rendering change: capture a screenshot (Playwright
  `page.screenshot()`) and look at it. Use the `read` tool to view PNGs.
- For any *motion* (transition) change: record a `.webm` with Playwright's
  `recordVideo` and extract frames with `ffmpeg -i x.webm -vf fps=10 ...`,
  then inspect frames around the transition. Stuck states won't show up in
  end-state screenshots.
- Run `cd frontend && npm run test:visual` before declaring done. All 20
  must pass.
- When fixing a regression: add or extend a test in
  `frontend/tests/visual/regression.spec.mjs` so it can't happen again.
- When fixing a regression: add or extend a test in
  `frontend/tests/visual/regression.spec.mjs` so it can't happen again.
- When fixing a flash/transition: add a test in
  `frontend/tests/visual/motion.spec.mjs` using
  `maxCellHeightDuring()` (or similar polling).
- Commit in logical chunks. Look at `git log --oneline` and match the
  existing `type(scope): summary` style (e.g.
  `fix(width): actually use horizontal space on wide displays`).
- Write commit message *bodies* explaining why, not what. The diff shows
  what.

### Never

- Never enable HMR. `vite.config.js` disables it intentionally (HMR with
  xterm.js causes terminal state corruption mid-session).
- Never add auth/auth-like logic unless the user explicitly asks. Termbook
  is localhost-only by design.
- Never rely on the legacy `frontend/tests/*.spec.{js,ts}` files. They are
  abandoned. They run against assumptions that no longer hold.
- Never delete or "tidy up" the audit PNGs, webms, or old docs in `docs/`
  without explicit instruction. They are historical evidence of past bugs.
- Never re-introduce hardcoded `cols: 120, rows: 24` for the headless or
  temp terminals. The exit message now carries `snapshotCols`/`snapshotRows`
  and the `join_session` carries viewport-derived cols. See
  [`docs/decisions.md#width`](docs/decisions.md#width).
- Never add a `behavior: 'smooth'` to programmatic scrolls without
  understanding the test impact. Sequential smooth scrolls cancel each
  other; the user ends up at the wrong position.
- Never use `terminal.reset()` on a live xterm. It exits the alt-screen
  buffer and breaks TUIs (vim, etc.) silently. See
  [`docs/decisions.md`](docs/decisions.md) entry on the gemini exit bug.
- Never call `fitAddon.proposeDimensions()` for resize emission *without*
  also calling `fitAddon.fit()`. `proposeDimensions` is read-only — it
  returns suggested dims without applying them, so the local xterm stays
  small while the remote PTY gets resized. The cell ends up with content
  in the corner and empty black space around it.

## The motion test pattern

This is the key superpower of this codebase. Use it.

```javascript
import { test, expect } from '@playwright/test';
import { gotoFreshSession, waitInputReady, maxCellHeightDuring } from './helpers.mjs';

test('short command does not flash a giant box', async ({ page }) => {
    await gotoFreshSession(page);
    const inp = await waitInputReady(page);
    await inp.fill('pwd');

    // Start measuring BEFORE pressing Enter.
    const measurePromise = maxCellHeightDuring(page, 2000);
    await inp.press('Enter');
    const maxH = await measurePromise;

    // The cell must NEVER exceed 200px during the transition.
    expect(maxH).toBeLessThan(200);
});
```

`maxCellHeightDuring(page, ms)` polls `getBoundingClientRect().height` at
~30ms intervals and returns the maximum value seen. This catches transient
flashes (e.g. a 480px black box that shows for 200ms then collapses to
50px) that screenshot-at-end tests miss entirely.

Before claiming a motion fix works:

1. Add a failing test that proves the bug.
2. Confirm it fails on the current code.
3. Apply the fix.
4. Confirm the test passes.
5. Temporarily revert the fix to verify the test correctly fails again.
6. Restore the fix.

Skipping step 5 has bitten us before.

## Debugging recipes

| Symptom | Where to look |
|---|---|
| Commands never finish (input stays disabled) | `backend/ssr_debug.log` for `COMMAND_START` without matching `CELL_CLOSE`. Likely a parser issue — see `backend/parser.js`. The OSC marker may be using ST (`\e\`) instead of BEL (`\x07`); both must be handled. |
| Output renders at wrong width (`ls` shows 2 columns on a 4K screen) | Three places must agree: `frontend/src/App.jsx` `join_session` `cols` (viewport-derived), backend `handleResize` (server.js, picks min of clients), frontend snapshot temp terminal cols (NotebookCell, uses `snapshotCols` from exit msg). |
| TUI modal opens blank | Likely the `activeCellId` vs `cellId` field mismatch on `tui_enter`. Frontend reads `msg.activeCellId ?? msg.cellId` for safety. |
| Cell flashes a 480px black box | The live-cell sizing fell back to fixed-height. See `NotebookCell.jsx` `cell-output` style branch. Live cells should size by `liveContentRows`, snapshots by `displaySnapshot` rendering. |
| User's `ll` alias doesn't work | `backend/server.js` `extractUserAliases()` parses `~/.bashrc`, `~/.zshrc`, `~/.aliases` etc. on backend startup. If it didn't get parsed, check the file is readable. |
| Powerlevel10k prompt leaks into cells | `backend/parser.js` must accept both salted and unsalted `133;D` markers. p10k emits unsalted ones. The pwd marker must accept both `\x07` and `\x1b\\` terminators. |
| Backend won't quit (crashes on Ctrl+C) | PTY stdio EIO. Each `pty.spawn` result needs `.onExit()` handler; bare event errors crash Node. |

`backend/ssr_debug.log` is your friend. It's appended (not rotated) on every
session activity. Truncate it before reproducing a bug:
`: > ssr_debug.log` then trigger the bug, then `tail -50 ssr_debug.log`.

## Conventions

- **Code style**: Match what's already there. No prettier/eslint config is
  authoritative; the existing files are the spec.
- **Comments**: Only for non-obvious things. Don't add comments that just
  restate what the code does.
- **File length**: `server.js` is long but single-file is intentional — it
  fits in one mental model. Don't split it unless you genuinely benefit
  from it.
- **Telemetry**: All backend events go through `debugLog()` which writes to
  `ssr_debug.log`. Add `[CATEGORY] ...` lines for new flows.

## What "done" looks like

A change is done when:

1. `cd frontend && npm run test:all` is green (both visual and e2e suites).
2. You drove the app with Playwright (headless or visible) and looked at
   actual screenshots/video proving the change works. The e2e suite
   produces these for free under `test-results/`.
3. For UX changes: the user can see the difference. Take a before/after
   screenshot and show them. If you're changing pixels intentionally,
   regenerate the golden screenshots with
   `npm run test:e2e:update` AND visually inspect every regenerated
   file before committing.
4. The commit message body explains *why*, links to the issue/symptom, and
   names the files changed.
5. The fix is testable. Either an existing test covers it, or you added a
   new test in `tests/visual/` (focused regression) or `tests/e2e/`
   (full workflow / pixel goldens).
6. No new files in the repo root, `backend/`, or `frontend/src/` that
   aren't part of the actual fix. Especially not `_*.mjs` scratch files —
   if a Playwright driver was useful, promote it into `tests/e2e/`;
   otherwise delete it before committing.

## Anti-patterns observed in this repo's history

Listed so you don't repeat them. See `git log --oneline | tail -10` for
the older commits; the work before commit `7e1797d` followed many of these
patterns and produced the ~1800 audit PNGs and ~50 abandoned spec files
still in the repo.

- **Audit-PNG-driven development**: capturing hundreds of screenshots
  without an assertion that fails when the bug returns. The screenshots
  document the bug but don't prevent recurrence.
- **"It worked when I tested"**: looking at one screenshot, declaring
  victory. Two days later the bug is back.
- **Comment-driven explanations**: writing "// THIS IS CRITICAL FOR THE
  WIDGET" instead of writing a test.
- **Sprawling experimental files**: `test_ws.js`, `test_ws2.js`, ...,
  `test_ws6.js` — six versions of the same investigation, all checked in.
- **Aspirational docs**: writing what the system *will* do instead of
  what it *does*. The original `docs/architecture_plan.md` describes the
  intended state from before the recent fixes; the actual state is in
  `docs/architecture.md`.

If you find yourself writing test_v2.js, stop and use Playwright in a
single deterministic spec.

## Emergency contacts

This is a personal project. There are no contacts. If the user says
something is broken, drive the app yourself, take screenshots, find the
cause, fix it, prove the fix. Don't ask them to repro unless absolutely
necessary.
