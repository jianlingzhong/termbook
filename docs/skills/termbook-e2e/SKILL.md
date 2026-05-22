---
name: termbook-e2e
description: Drive Termbook end-to-end via Playwright — write E2E tests that capture screenshots + screencasts + pixel goldens. Use whenever fixing a bug or shipping a feature in this repo.
---

## When to use

Load this skill whenever you're working in the Termbook repo and need to:
- Drive the running app to reproduce a reported bug
- Write or extend a test that captures real human interaction
- Verify a UI change pixel-by-pixel against a committed golden
- Catch a transient flash / focus loss / scroll glitch via sampling
- Promote a one-off Playwright driver script into a permanent test

The rules below are mandatory. Skipping them produces the kind of
ad-hoc, never-promoted driver script that becomes a maintenance burden
instead of a regression guard.

## Prerequisites

1. **Both servers running**: `bash scripts/restart_servers.sh` from the
   repo root. Frontend on `:4000`, backend on `:4001`. Verify with
   `lsof -ti:4000 -ti:4001`.
2. **Playwright installed in frontend**: it is, via `@playwright/test`.
   First run downloads browsers if missing.
3. **Read [docs/testing.md](../../testing.md) first.** This skill
   assumes you've skimmed it for helper APIs and tier definitions.

## Core workflow

When investigating any bug or shipping any feature:

```
1. Reproduce live via a driver script (or jump straight to step 2)
2. Write a Playwright spec under tests/e2e/<NN>_<area>.spec.mjs
3. Run it: npm run test:e2e -- <area>
4. Inspect the screenshots/video it produces
5. If you wrote it BEFORE the fix → confirm it fails
6. Apply the fix
7. Confirm the test passes
8. Commit the spec ALONG WITH the fix
```

Never delete the spec after step 7. It IS the test the next agent
needs to prevent the regression.

## File layout

```
frontend/
├── playwright.e2e.config.js          ← config: video always on
├── tests/e2e/
│   ├── helpers.mjs                    ← shared waiters, key helpers, shot()
│   ├── 01_dev_workflow.spec.mjs       ← realistic dev session
│   ├── 02_interactive_commands.spec.mjs ← passthrough (cat, read, arrows)
│   ├── 03_alt_screen_tui.spec.mjs     ← vim modal
│   ├── 04_persistence.spec.mjs        ← backend restart
│   ├── 05_motion_stability.spec.mjs   ← flash detection via sampling
│   ├── 06_visual_snapshots.spec.mjs   ← pixel-diff goldens
│   ├── 07_scroll_behavior.spec.mjs    ← scroll matrix (19 tests)
│   ├── 08_ssh_session.spec.mjs        ← SSH integration (16 tests)
│   ├── ssh-global-setup.mjs           ← userspace sshd spinup
│   └── ssh-global-teardown.mjs
└── test-results/                      ← per-run output (screenshots, video, trace)
```

## Test template

Copy this when starting a new E2E test:

```javascript
import { test, expect } from '@playwright/test';
import {
    VIEWPORT,
    gotoFreshSession,
    runCommand,
    startCommand,
    waitInputReady,
    waitForPassthrough,
    waitForIdle,
    shot,
    lastCellInfo,
    scrollGeometry,
    assertLatestCellAtTop,
    userScrollUp,
    newSession,
    switchToSessionByIndex,
} from './helpers.mjs';

test.use({ viewport: VIEWPORT });

test.describe('my workflow', () => {

    test('user does X then Y, observes Z', async ({ page }, testInfo) => {
        await gotoFreshSession(page);
        await shot(page, testInfo, 'start');

        await runCommand(page, 'pwd');
        await runCommand(page, 'git status');
        await shot(page, testInfo, 'after_git');

        const last = await lastCellInfo(page);
        expect(last.cmd).toContain('git status');
        expect(last.isSuccess).toBe(true);
        expect(last.gitChip).toBeTruthy();
    });
});
```

Save under `frontend/tests/e2e/<NN>_<area>.spec.mjs`. The `NN` numeric
prefix preserves the run order grouping.

## Helper API (cheat sheet)

```javascript
// Session lifecycle
await gotoFreshSession(page);                    // ?new_session=true, wait ready
const inp = await waitInputReady(page);          // wait for enabled input
await waitInputReady(page, { waitForCommandReady: true });
                                                  // also waits for cmd to finish
await newSession(page);                          // click + sidebar button
await switchToSessionByIndex(page, 0);           // click sidebar nth

// Running commands
await runCommand(page, 'echo hi');               // submit + wait for finish
await runCommand(page, 'sleep 5', { timeoutMs: 10000 });
await startCommand(page, 'cat');                 // submit, do NOT wait

// Passthrough (interactive cells)
await waitForPassthrough(page);                  // wait for .is-passthrough
await page.keyboard.type('hello');
await page.keyboard.press('Enter');
await page.keyboard.press('Control+d');          // EOF
await waitForIdle(page);                         // wait for cell finish

// Inspection
const c = await cellCount(page);
const last = await lastCellInfo(page);
   // { cmd, exitBadge, isRunning, isFailed, isSuccess, output,
   //   gitChip, venvChip, condaChip, pwdBreadcrumb }
const g = await scrollGeometry(page);
   // { scrollTop, scrollHeight, clientHeight, atTop, atBottom,
   //   cellCount, cells: [{cmd, offsetTop, viewportTop, ...}],
   //   lastCellOffsetTop, lastCellViewportTop,
   //   scrollContainerTop, scrollContainerBottom }

// Scroll
await userScrollUp(page, 2000);                  // wheel up by 2000px
await userScrollDown(page, 2000);
await userScrollTo(page, 500);                   // set scrollTop=500 (as user)
await assertLatestCellAtTop(page);               // throws if not

// Screenshots (auto-attached to HTML report)
await shot(page, testInfo, 'after_step_X');

// Motion sampling
const samples = await sampleDuring(page, () => {
    return document.querySelector('.cell-output')?.getBoundingClientRect().height;
}, 2500);  // returns array of {t, v}
```

## Running specs

```bash
cd frontend

# all e2e tests
npm run test:e2e

# one spec file (substring of filename)
npm run test:e2e -- 02_interactive

# one test by name (substring of test title)
npx playwright test --config=playwright.e2e.config.js -g "passthrough"

# watch the browser drive itself
npm run test:e2e:headed

# regenerate golden screenshots after intentional UI change
npm run test:e2e:update
```

## Inspecting failures

```bash
# HTML report (best UX)
open frontend/playwright-report-e2e/index.html

# raw video for a specific test
find frontend/test-results -type d -name "*<keyword>*"
open frontend/test-results/<test-dir>/video.webm

# Playwright trace (step-through inspector)
npx playwright show-trace frontend/test-results/<test-dir>/trace.zip
```

For pixel-golden failures, the HTML report shows expected | actual |
diff side-by-side. The diff highlights changed pixels in red/green.

## Pixel goldens

```javascript
await expect(page).toHaveScreenshot('my_state.png', {
    clip: { x: 280, y: 0, width: 1320, height: 400 },  // optional crop
    mask: [
        page.locator('.sidebar ul li'),       // session IDs change
        page.locator('.cell-time'),           // timestamps change
        page.locator('.cell-duration'),       // duration changes
    ],
});
```

Mask volatile UI so the diff ignores it. Masked regions render as
solid magenta in the golden.

Goldens are committed to `tests/e2e/<spec>.mjs-snapshots/`. After
intentional UI changes:

```bash
npm run test:e2e:update
# then visually inspect every regenerated PNG
ls frontend/tests/e2e/*-snapshots/
```

Only commit goldens that match your intended change.

## Promoting a one-off driver into a test

If you wrote `_drive_xxx.mjs` while investigating:

1. Rename to `tests/e2e/<NN>_<area>.spec.mjs` matching the area.
2. Convert from `chromium.launch()` to `test('...', async ({ page })` form.
3. Add `import { test, expect } from '@playwright/test'`.
4. Replace ad-hoc `page.waitForTimeout(N)` with proper waiters
   (`waitInputReady`, `waitForPassthrough`, `waitForIdle`).
5. Add assertions for what you were checking by eye.
6. Add `shot(page, testInfo, 'label')` at key states for audit trail.
7. Delete the original `_drive_*.mjs`.
8. Run it: `npm run test:e2e -- <new_spec>`.

## Common traps

### React rendering causes scroll/layout shifts

The browser fires scroll events as React mounts cells. The scroll
listener filters these out by checking if a user input event happened
in the last 500ms. If you're writing a scroll-related test, use
`userScrollUp/Down/To` from helpers — they precede the scroll with a
wheel event to mark it as user-initiated.

### `:last-of-type` picks the sentinel div, not the cell

The notebook renders a 240px sentinel `<div>` after the cells. Use
`page.locator('.notebook-cell').last()` or
`querySelectorAll('.notebook-cell')` and index the last.

### Sidebar order is chronological (newest last)

`switchToSessionByIndex(page, 0)` selects the OLDEST session. Use
`.last()` or `count() - 1` for the newest.

### Tests that delete sessions affect each other

The `04_persistence.spec.mjs` restarts the backend. The whole DB is
wiped if you ran `--reset-db`. Tests run sequentially (`workers: 1`)
for this reason, but a failing earlier test can leave the DB in an
unexpected state for later tests. If you see cross-test pollution,
add `await gotoFreshSession(page)` at the start of each test (most
already do).

### Pixel goldens are platform-specific

The filename suffix `-chromium-darwin.png` includes browser and OS.
Goldens generated on macOS won't match on Linux. CI would need
per-platform goldens (Playwright handles this automatically).

### SSH tests need the userspace sshd

`tests/e2e/08_ssh_session.spec.mjs` connects to a userspace sshd at
`127.0.0.1:2222` that `ssh-global-setup.mjs` spawns on first test
run. The sshd is left running between runs for speed; override with
`TERMBOOK_E2E_KILL_SSHD=1`. If your environment shadows `ssh` with a
wrapper that requires hardware key taps (e.g. corp-managed
gnubby-ssh), set `TERMBOOK_E2E_SSH_BIN=/usr/bin/ssh` (already the
default in 08_ssh_session.spec.mjs).

## Verification recipe (proves your test catches the bug)

For any new motion or regression test:

```
1. Write the test.
2. Run it: npm run test:e2e -- <name>     → should PASS (suspicious)
3. Temporarily revert the fix in the source code.
4. Run again                              → MUST FAIL
5. Restore the fix.
6. Run again                              → PASSES (now you trust it)
```

A test that's never been seen to fail isn't actually a test — it
might always pass regardless of code state. Skipping step 4 produces
fake test coverage.

## Anti-patterns (do NOT do)

- **Deleting an E2E test as "ad-hoc debug script"**. Promote it.
- **Adding `_drive_*.mjs` to the repo root or `frontend/`**. They get
  forgotten. Promote them to `tests/e2e/`.
- **Using `page.waitForTimeout(N)` for synchronization**. Use the
  proper `waitFor*` helpers. Fixed timeouts hide races.
- **Hardcoded scrollTop values**. Use relative assertions (`atTop`,
  `viewportTop < tolerance`).
- **Mocking the backend in E2E tests**. These are E2E — they hit a
  real backend, real PTY, real SQLite.
- **`querySelector('.notebook-cell:last-of-type')`**. Use
  `querySelectorAll('.notebook-cell')` and index.
- **Skipping the verification recipe**. Tests that have never been
  seen to fail are fake coverage.

## Where to put what

| You're doing... | Put the test in... |
|---|---|
| Fixing a specific defect | `tests/visual/regression.spec.mjs` (or extend it) |
| Catching a transient flash | `tests/visual/motion.spec.mjs` or `tests/e2e/05_motion_stability.spec.mjs` |
| Shipping a new feature with a user-visible workflow | Extend the most relevant `tests/e2e/*.spec.mjs` |
| Pixel-perfect appearance of a new UI element | `tests/e2e/06_visual_snapshots.spec.mjs` + commit a golden |
| Scroll behavior change | `tests/e2e/07_scroll_behavior.spec.mjs` |
| Interactive command behavior (passthrough) | `tests/e2e/02_interactive_commands.spec.mjs` |
| TUI (alt-screen) behavior | `tests/e2e/03_alt_screen_tui.spec.mjs` |
| Backend persistence | `tests/e2e/04_persistence.spec.mjs` |
| SSH integration behavior | `tests/e2e/08_ssh_session.spec.mjs` |

When in doubt: extend an existing spec rather than create a new one.

## Definition of done for this skill

You've used this skill correctly if:
1. You wrote a Playwright spec (NOT a `_drive_*.mjs` script).
2. The spec uses helpers from `tests/e2e/helpers.mjs` (not raw
   `waitForTimeout`).
3. The spec calls `shot(page, testInfo, ...)` at meaningful states.
4. You ran `npm run test:e2e -- <your spec>` and it passes.
5. You ran `npm run test:all` and 101/101 (≈) green. (Or 100 passed +
   1 skipped if WebGL is unavailable — see
   [AGENTS.md](../../../AGENTS.md).)
6. You promoted any ad-hoc driver into a permanent spec; no `_*.mjs`
   files are left in the working tree.
7. You committed the spec ALONGSIDE the fix (one logical commit).
