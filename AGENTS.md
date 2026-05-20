# AGENTS.md

Operating manual for AI coding agents (Claude, Codex, OpenCode, etc.)
working on Termbook. Read this end-to-end before touching code.

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
   - `frontend/tests/visual/*.spec.mjs` (~40 tests) — fast functional +
     motion regressions. Run with `npm run test:visual` (~3 min).
   - `frontend/tests/e2e/*.spec.mjs` (~40 tests) — full human-workflow
     E2E with screenshots, video, pixel goldens. Run with
     `npm run test:e2e` (~5 min).
   - `npm run test:all` runs both.
   - **Always 80/80 green** before you claim done.
   - The legacy `frontend/tests/*.spec.{js,ts}` is abandoned cruft
     — do not run or modify it.
4. Before claiming "done": `npm run test:all` must pass green. Show the
   user real screenshots or videos of the change (the e2e tests produce
   these automatically in `frontend/test-results/`).
5. **Never delete an E2E test as "ad-hoc debug script".** If you wrote
   a Playwright driver to investigate something, promote it into
   `tests/e2e/` — that's how this codebase stays well-tested. See
   [`docs/testing.md`](docs/testing.md) and
   [`frontend/tests/e2e/README.md`](frontend/tests/e2e/README.md).
6. **There is a loadable skill for E2E driving** at
   [`docs/skills/termbook-e2e/SKILL.md`](docs/skills/termbook-e2e/SKILL.md).
   If your agent platform supports skills (OpenCode `/skill`), load it.
   Otherwise read it as a markdown doc — it's the canonical "how to
   write a Termbook E2E test" guide.

## Project layout

```
termbook/
├── README.md
├── AGENTS.md                       ← you are here
├── app_config.json                 ← branding (appName, markerPrefix)
├── mprocs.yaml                     ← dev runner alternative
├── termbook.db                     ← SQLite cell persistence (gitignored)
├── scripts/
│   └── restart_servers.sh          ← clean restart of both servers
├── backend/                        ← Node.js Express + ws + node-pty
│   ├── server.js                     ← single-file server (~610 lines, do read it)
│   ├── parser.js                     ← prompt-marker detector (~70 lines)
│   ├── persistence.js                ← SQLite layer (~140 lines)
│   ├── completion.js                 ← Tab completion (~120 lines)
│   ├── env_detect.js                 ← git branch detection (~60 lines)
│   └── package.json
├── frontend/                       ← React 19 + Vite + xterm.js
│   ├── src/
│   │   ├── App.jsx                   ← session/cell/WS state, ~1100 lines
│   │   ├── NotebookCell.jsx          ← per-cell rendering, ~320 lines
│   │   ├── TuiModal.jsx              ← full-screen TUI host, ~95 lines
│   │   └── index.css                 ← all styles
│   ├── tests/visual/               ← functional + motion regression suite
│   │   ├── motion.spec.mjs           ← catches transient flashes
│   │   ├── regression.spec.mjs       ← catches functional regressions
│   │   ├── helpers.mjs
│   │   └── README.md
│   ├── tests/e2e/                  ← end-to-end human-workflow suite
│   │   ├── 01_dev_workflow.spec.mjs        ← realistic dev session
│   │   ├── 02_interactive_commands.spec.mjs ← passthrough mode
│   │   ├── 03_alt_screen_tui.spec.mjs      ← vim modal
│   │   ├── 04_persistence.spec.mjs         ← backend restart
│   │   ├── 05_motion_stability.spec.mjs    ← flash sampling
│   │   ├── 06_visual_snapshots.spec.mjs    ← pixel goldens
│   │   ├── 07_scroll_behavior.spec.mjs     ← 19-test scroll matrix
│   │   ├── 06_*-snapshots/                 ← golden PNGs (committed)
│   │   ├── 07_*-snapshots/                 ← golden PNGs (committed)
│   │   ├── helpers.mjs
│   │   └── README.md
│   ├── tests/                      ← ~50 abandoned audit scripts (ignore)
│   ├── playwright.config.ts          ← legacy config (ignore)
│   ├── playwright.visual.config.js   ← visual / regression suite
│   └── playwright.e2e.config.js      ← e2e suite (video always on)
└── docs/
    ├── architecture.md             ← current data flow + lifecycles
    ├── decisions.md                ← every shipped fix with rationale
    ├── development.md              ← dev loop, debugging recipes
    ├── testing.md                  ← when/how to add visual vs e2e tests
    ├── known-issues.md             ← deliberate tradeoffs + open bugs
    └── skills/
        └── termbook-e2e/           ← loadable agent skill (E2E workflow)
            └── SKILL.md
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
- For any *motion* (transition) change: sample the relevant layout
  property at ~30ms intervals during the transition (see
  [`docs/testing.md`](docs/testing.md) "Motion test pattern"). Stuck
  states won't show up in end-state screenshots.
- Run `cd frontend && npm run test:all` before declaring done.
  Both suites must be green.
- When fixing a regression: add or extend a test in
  `frontend/tests/visual/regression.spec.mjs` so it can't happen again.
- When adding a user-visible feature: add an e2e test that walks the full
  workflow in `frontend/tests/e2e/`.
- When fixing a flash/transition: add a test in
  `frontend/tests/visual/motion.spec.mjs` OR
  `frontend/tests/e2e/05_motion_stability.spec.mjs` using `sampleDuring()`
  / `maxCellHeightDuring()`.
- When intentionally changing pixels: regenerate goldens with
  `npm run test:e2e:update` AND visually inspect every regenerated PNG
  before committing it.
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
- Never delete an e2e test as an "ad-hoc debug script". Promote it.
- Never re-introduce hardcoded `cols: 120, rows: 24` for the headless or
  temp terminals. The exit message now carries `snapshotCols`/`snapshotRows`
  and the `join_session` carries viewport-derived cols. See
  [`docs/decisions.md`](docs/decisions.md) entry on width.
- Never add a `behavior: 'smooth'` to programmatic scrolls without
  understanding the test impact. Sequential smooth scrolls cancel each
  other; the user ends up at the wrong position.
- Never use `terminal.reset()` on a live xterm. It exits the alt-screen
  buffer and breaks TUIs (vim, etc.) silently. See
  [`docs/decisions.md`](docs/decisions.md) entry on the gemini exit bug.
- Never call `fitAddon.proposeDimensions()` for resize emission *without*
  also calling `fitAddon.fit()`. `proposeDimensions` is read-only — it
  returns suggested dims without applying them, so the local xterm stays
  small while the remote PTY gets resized.
- Never use `:last-of-type` to find the last cell. The notebook renders
  a sentinel `<div>` after the cells (the 240px bottom padding so the
  latest cell can scroll to viewport top), so `:last-of-type` picks the
  sentinel. Use `querySelectorAll('.notebook-cell')` and index-the-last
  via `queryLastCell()` in App.jsx.
- Never write `process.ptyProcess.write(cmd + '\r\n')`. Use `'\r'` only.
  The TTY line discipline maps `\r → \n` via ICRNL; the extra `\n` ends
  up as an empty line in the next `read`'s stdin (this broke `cat` and
  `read X`).
- Never let an `inline TUI promotion` (heuristic-based modal opening for
  apps that don't use alt-screen) come back. The right path for input
  into running commands is passthrough mode (chat input → PTY). See
  [`docs/decisions.md`](docs/decisions.md) entry on "passthrough".

## The motion test pattern

Catches what end-state screenshots miss: flashes, layout jumps, focus
losses, transient oversized states. The full pattern lives in
[`docs/testing.md`](docs/testing.md). Quick template:

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

Before claiming a motion fix works:

1. Add a failing test that proves the bug.
2. Confirm it fails on the current code.
3. Apply the fix.
4. Confirm the test passes.
5. Temporarily revert the fix to verify the test correctly fails again.
6. Restore the fix.

Skipping step 5 has bitten us before.

## E2E test pattern

The e2e suite simulates real human interaction with screenshots and
screencasts. Full guide in
[`docs/skills/termbook-e2e/SKILL.md`](docs/skills/termbook-e2e/SKILL.md).
Quick template:

```javascript
import { test, expect } from '@playwright/test';
import {
    VIEWPORT, gotoFreshSession, runCommand, shot, lastCellInfo,
} from './helpers.mjs';

test.use({ viewport: VIEWPORT });

test('user workflow: pwd then git status', async ({ page }, testInfo) => {
    await gotoFreshSession(page);
    await shot(page, testInfo, 'welcome');

    await runCommand(page, 'pwd');
    await runCommand(page, 'git status');
    await shot(page, testInfo, 'after_git_status');

    const last = await lastCellInfo(page);
    expect(last.cmd).toContain('git status');
    expect(last.gitChip).toBeTruthy();
});
```

What each test run produces, under `frontend/test-results/<test-name>/`:
- `video.webm` — full screencast (the screencast IS the audit artifact)
- `<NN>_<label>.png` — labeled screenshots at each step
- `trace.zip` — Playwright trace; open with `npx playwright show-trace ...`

Pixel goldens (`tests/e2e/06_visual_snapshots.spec.mjs`,
`tests/e2e/07_scroll_behavior.spec.mjs` G1/G2) use
`expect(page).toHaveScreenshot(...)`. Regenerate after intentional UI
changes with `npm run test:e2e:update`, then visually inspect each
regenerated PNG before committing.

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
| `gemini-cli` exits with "No input provided via stdin" | Backend was launched with `CI=true` in env. The PTY spawn now strips CI / GITHUB_ACTIONS / etc. from the child env — if you see this, that stripping logic regressed. See `spawnPtyForSession` in `server.js`. |
| Chat input disabled while a command is running | Should NOT happen — passthrough mode is on whenever a command is running. If you see "Command running…" placeholder, the `isPassthrough` flag isn't being computed. See `App.jsx` `isPassthrough` derivation. |
| Session switch lands at scrollTop=0 instead of latest-at-top | The `:last-of-type` trap returned. Use `queryLastCell()` in App.jsx. |
| Scroll position not restored on switch back | Browser scroll-anchoring is fighting us. `.notebook-content` needs `overflow-anchor: none` in index.css. |

`backend/ssr_debug.log` is your friend. It's appended (not rotated) on every
session activity. Truncate it before reproducing a bug:
`: > ssr_debug.log` then trigger the bug, then `tail -50 ssr_debug.log`.

## Conventions

- **Code style**: Match what's already there. No prettier/eslint config is
  authoritative; the existing files are the spec.
- **Comments**: Only for non-obvious things. Don't add comments that just
  restate what the code does. **Do** add comments for non-obvious
  bug-fix lines so future agents don't revert them (e.g.,
  `// strip font-family from SerializeAddon output, otherwise courier-new wins`).
- **File length**: `server.js` and `App.jsx` are long but single-file is
  intentional — each fits in one mental model. Don't split unless you
  genuinely benefit.
- **Telemetry**: All backend events go through `debugLog()` which writes to
  `ssr_debug.log`. Add `[CATEGORY] ...` lines for new flows.

## What "done" looks like

A change is done when:

1. `cd frontend && npm run test:all` is green (both visual AND e2e suites).
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
7. If the change introduces a new feature, behavior, or visible UI element,
   update the relevant docs:
   - User-visible behavior → `README.md` feature list.
   - Architecture / data flow → `docs/architecture.md`.
   - Subtle bug fix → `docs/decisions.md`.
   - New testing approach → `docs/testing.md`.
   - New trap / known issue → `docs/known-issues.md`.

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
- **Ad-hoc drivers deleted after use**: writing `_drive_foo.mjs`, using
  it once to verify a fix, deleting it. The next agent reinvents the
  same test. **Always promote into `tests/e2e/`.**
- **Aspirational docs**: writing what the system *will* do instead of
  what it *does*. The original `docs/earlier-design-notes.md` describes the
  intended state from before the recent fixes; the actual state is in
  `docs/architecture.md`.
- **Heuristic-driven UX**: trying to detect "is this an inline TUI?" via
  cursor-move counting and opening a modal automatically. The user said
  no, and the right answer was simpler (passthrough mode on every
  running command).

If you find yourself writing test_v2.js, stop and use Playwright in a
single deterministic spec under `tests/e2e/`.

## Emergency contacts

This is a personal project. There are no contacts. If the user says
something is broken, drive the app yourself, take screenshots, find the
cause, fix it, prove the fix. Don't ask them to repro unless absolutely
necessary.
