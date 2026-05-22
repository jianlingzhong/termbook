# Testing guide

Canonical reference for writing and running tests in Termbook. Use this
as the source of truth for:
- Which test tier a given change belongs in
- Helper APIs for each tier
- How to manage golden screenshots
- Why we structure tests the way we do

Pairs with [AGENTS.md](../AGENTS.md) (rules + what "done" looks like)
and [development.md](development.md) (dev loop + recipes).

## Two tiers

| Tier | Path | Run cmd | Time | What it catches |
|---|---|---|---|---|
| **Visual / regression** | `frontend/tests/visual/*.spec.mjs` | `npm run test:visual` | ~3 min | Single-defect regressions; motion flashes (sampling-based). Fast unit-of-fix tests. |
| **End-to-end (E2E)** | `frontend/tests/e2e/*.spec.mjs` | `npm run test:e2e` | ~6 min | Full user workflows; screenshots + screencasts; pixel goldens. Includes 16 SSH tests that spin up a userspace sshd on `127.0.0.1:2222` via `tests/e2e/ssh-global-setup.mjs` (reused across runs). |

`npm run test:all` runs both. Always pass `101/101` (≈) before
claiming done — one e2e test skips when WebGL isn't available, so
headless without GPU shows `100 passed + 1 skipped`; real users always
have WebGL.

### Visual / regression tier

Two files:
- **`motion.spec.mjs`** — for transient flashes, layout jumps, focus
  losses. The kind of bug that's invisible to "screenshot at end" tests.
  Uses property-sampling at 30ms intervals.
- **`regression.spec.mjs`** — for any specific defect you just fixed.
  One test per defect. Each test corresponds to a real bug shipped to
  the user.

### E2E tier

One spec file per workflow area:

| File | Workflow |
|---|---|
| `01_dev_workflow.spec.mjs` | realistic dev session — pwd, git, ls, cat, Ctrl+R, Cmd+K, full-screen |
| `02_interactive_commands.spec.mjs` | passthrough mode — cat, read, arrows, Ctrl+C/D/U, Tab, backspace |
| `03_alt_screen_tui.spec.mjs` | vim opens modal, exits cleanly; not passthrough |
| `04_persistence.spec.mjs` | backend restart mid-test, cells survive |
| `05_motion_stability.spec.mjs` | flash detection via 30ms sampling |
| `06_visual_snapshots.spec.mjs` | pixel-diff golden PNGs (welcome, palette, history search, cells) |
| `07_scroll_behavior.spec.mjs` | 19-test scroll matrix (submit, switch, restore, bounce, vim, passthrough) |

When adding a new feature, prefer to extend the most relevant existing
spec rather than create a new file. Create a new spec only for a
genuinely new workflow area.

## Helpers reference

### `tests/visual/helpers.mjs`

- `INPUT` — selector for the chat textarea
- `VIEWPORT` — `{ width: 1600, height: 900 }`
- `BASE_URL` — defaults to `http://localhost:4000`
- `waitInputReady(page)` — wait until the chat input is enabled
- `runCommand(page, cmd, waitMs)` — fill + Enter + wait
- `gotoFreshSession(page)` — visit `?new_session=true`, wait for ready
- `cellHeights(page)` — array of cell-output heights
- `lastCellText(page)` — trimmed text of the last cell
- `maxCellHeightDuring(page, ms)` — poll cell height; return max seen

### `tests/e2e/helpers.mjs`

Richer than visual helpers. Use these for E2E:

- `VIEWPORT`, `BASE_URL` — same as visual
- `waitInputReady(page, { waitForCommandReady })` — also accepts
  `waitForCommandReady: true` to wait through passthrough/tui state
- `runCommand(page, cmd, { afterWaitMs, timeoutMs })` — submit + wait for
  cell to FINISH (no longer running). Throws on timeout.
- `startCommand(page, cmd)` — submit but do NOT wait for finish. Used for
  interactive commands the test will then talk to.
- `waitForPassthrough(page)` — wait until the chat input has
  `.is-passthrough` class
- `waitForIdle(page)` — wait until no cell is running AND no passthrough/tui
- `gotoFreshSession(page)`
- `sendKeystrokes(page, steps)` — send a sequence (strings get typed,
  objects with `.press` get keypressed)
- `shot(page, testInfo, label)` — take a labeled screenshot, attach to
  the HTML report. Files numbered `00_label.png`, `01_...`, etc.
- `sampleDuring(page, evaluatorFn, ms)` — sample a JS value at 30ms
  intervals; returns the array of samples
- `cellCount(page)`, `lastCellInfo(page)` — inspection helpers
- `scrollGeometry(page)` — comprehensive scroll geometry (uses
  `offsetTop`, not `getBoundingClientRect`, which lies inside scroll
  containers)
- `assertLatestCellAtTop(page, anchorPx, tolerancePx)` — overflow-aware
  assertion that the latest cell is at viewport top
- `userScrollUp / userScrollDown / userScrollTo` — programmatic scrolls
  that count as user-initiated (wheel + setScrollTop pattern)
- `newSession(page)` — click + button, wait, returns sidebar count
- `switchToSessionByIndex(page, idx)` — click sidebar item N

## The motion test pattern

The reason this codebase has a motion test tier is because end-state
screenshots miss transient bugs. Sample a layout property during the
transition.

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

    expect(maxH).toBeLessThan(200);
});
```

For arbitrary properties (not just heights), use `sampleDuring`:

```javascript
import { sampleDuring } from './helpers.mjs';

const samples = sampleDuring(page, () => {
    const el = document.querySelector('.chat-input-wrapper');
    return el?.classList.contains('is-passthrough') ? 1 : 0;
}, 2500);
// ... cause the transition ...
const results = await samples;
expect(results[results.length - 1].v).toBe(0);
```

**Before claiming a motion fix works**:
1. Add a failing test that proves the bug.
2. Confirm it FAILS on current code.
3. Apply the fix.
4. Confirm the test PASSES.
5. Temporarily revert the fix; confirm the test FAILS again.
6. Restore the fix.

Skipping step 5 has bitten us. The test "pwd doesn't flash a 480px box"
was developed exactly this way.

## The E2E test pattern

```javascript
import { test, expect } from '@playwright/test';
import {
    VIEWPORT, gotoFreshSession, runCommand, shot, lastCellInfo,
} from './helpers.mjs';

test.use({ viewport: VIEWPORT });

test('git workflow: status, log, branch chip', async ({ page }, testInfo) => {
    await gotoFreshSession(page);
    await shot(page, testInfo, 'welcome');

    await runCommand(page, 'pwd');
    await runCommand(page, 'git status');
    await shot(page, testInfo, 'after_git_status');

    const last = await lastCellInfo(page);
    expect(last.cmd).toContain('git status');
    expect(last.isSuccess).toBe(true);
    expect(last.gitChip).toBeTruthy();
});
```

Each test produces, under `frontend/test-results/<test-name>/`:
- `video.webm` — full screencast. The video IS the audit artifact.
- `<NN>_<label>.png` — labeled screenshots from `shot()` calls
- `trace.zip` — Playwright trace; open with `npx playwright show-trace`

The HTML report at `playwright-report-e2e/index.html` collects everything.

## Pixel golden snapshots

`tests/e2e/06_visual_snapshots.spec.mjs` and `07_scroll_behavior.spec.mjs`
(G1/G2) use `expect(page).toHaveScreenshot('name.png', { ... })`. The
golden lives at `<spec>.mjs-snapshots/name-chromium-darwin.png`.

### Volatile UI must be masked

Session IDs, timestamps, durations change every run. Mask them with
`mask: [page.locator('.sidebar ul li'), page.locator('.cell-time'),
page.locator('.cell-duration')]` so the diff ignores them. The masked
regions render as solid magenta in the golden.

### Regenerating goldens

After an intentional UI change:

```bash
cd frontend
npm run test:e2e:update
```

Then **visually inspect every regenerated golden** in
`tests/e2e/*-snapshots/`. Use the `read` tool — it accepts PNGs.

Only commit goldens that match your intended change. If a golden
changed in a way you didn't expect, that's a real visual regression you
introduced and need to fix.

### Tolerance

`maxDiffPixelRatio: 0.02, threshold: 0.2` (in `playwright.e2e.config.js`).
This allows tiny rendering differences (anti-aliasing, font hinting,
sub-pixel rounding) while catching real layout shifts.

## When tests fail

```bash
# the test name + line in the error gives you the spec file
# open the HTML report
open frontend/playwright-report-e2e/index.html

# OR find the specific test-results dir
find frontend/test-results -type d -name "*<test-keyword>*"

# watch the screencast
open frontend/test-results/<test-dir>/video.webm

# step through the trace
npx playwright show-trace frontend/test-results/<test-dir>/trace.zip
```

For pixel-golden failures, the report shows side-by-side diff: expected
| actual | diff. The diff overlay highlights changed pixels in red/green.

## Anti-patterns

- **`waitForTimeout` as a synchronization primitive.** Use
  `waitForPassthrough`, `waitForIdle`, `waitInputReady` instead. Fixed
  timeouts hide race conditions.
- **Asserting things only after the transition.** Some bugs only exist
  *during* the transition. Use sampling helpers.
- **Hardcoded scrollTop values across runs.** Cell sizes can vary by
  ~10-20px between runs (font rendering, resize timing). Use relative
  values (`atTop`, `viewportTop < tolerance`) instead.
- **`querySelector('.notebook-cell:last-of-type')`.** The notebook
  renders a sentinel `<div>` after the cells; `:last-of-type` picks it.
  Use `querySelectorAll + index` or the `queryLastCell` helper.
- **Deleting an E2E driver after one use.** If you wrote a Playwright
  driver to investigate a problem, it's already 90% of an E2E test.
  Promote it into `tests/e2e/`. The graveyard of `_drive_foo.mjs` files
  is documented as an anti-pattern in [AGENTS.md](../AGENTS.md).
- **Mocking the backend.** These are E2E tests — they must hit a real
  backend, a real PTY, a real SQLite. If you need unit tests, those
  would live elsewhere (and don't exist yet, on purpose; see
  [known-issues.md](known-issues.md)).

## Adding tests for new features

A new user-visible feature should ship with:
1. **One E2E test** in the most relevant `tests/e2e/*.spec.mjs` walking
   the full workflow.
2. **Optionally** a golden screenshot if there's a meaningful new UI.
3. **Optionally** a focused regression test in `tests/visual/regression.spec.mjs`
   if there's a specific edge case worth pinning.

A bug fix should ship with:
1. **One regression test** in `tests/visual/regression.spec.mjs` that
   fails without the fix.
2. **Maybe** an E2E test if the bug was about a workflow (e.g., session
   switch behavior).
3. **Maybe** a golden update if the fix is visual.

## Test running tips

- The `webServer` config in `playwright.visual.config.js` (gated on
  `TERMBOOK_CI=1`) auto-starts servers for hermetic runs. The default
  (no env var) assumes servers are already running, which is faster.
- The `playwright.e2e.config.js` does NOT auto-start servers — always
  run `bash scripts/restart_servers.sh` first.
- Tests are run with `workers: 1` (sequential) because both suites share
  one backend / one database / one PTY. Parallel runs would race.
- The `04_persistence.spec.mjs` test calls `scripts/restart_servers.sh`
  mid-test. If you run that test in isolation, your other open Termbook
  tabs will reload.
