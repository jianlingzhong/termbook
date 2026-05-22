# Visual & motion tests

Curated end-to-end test suite for Termbook. Targets motion regressions and
structural invariants — anything that can be checked via a single page state
or via short-window animation sampling.

Two kinds of tests:

| File | Catches |
|---|---|
| `motion.spec.mjs` | Flashes, layout jumps, transient oversized states — defects that only appear *during* a transition and are invisible to "screenshot at the end" tests. |
| `regression.spec.mjs` | Functional defects we've already fixed (cell bleed, missing colors, hydration loss, focus loss, etc.). Each test corresponds to a real bug that was shipped. |

## Running

The tests assume both servers are reachable. There are two convenient ways:

```bash
# Option 1: you already have servers running (e.g. via mprocs / two terminals)
cd frontend
npm run test:visual

# Option 2: let Playwright start servers for you (slower but hermetic)
cd frontend
npm run test:visual:ci
```

Run a single test file:
```bash
cd frontend
npx playwright test --config playwright.visual.config.js tests/visual/motion.spec.mjs
```

Run a single test by name pattern:
```bash
cd frontend
npx playwright test --config playwright.visual.config.js -g "does not flash"
```

## What a failure looks like

When a test fails, Playwright drops:
- The recorded `.webm` video of the failing run → `test-results/<test-name>/video.webm`
- A trace bundle → `test-results/<test-name>/trace.zip` (open with `npx playwright show-trace`)
- A screenshot at the failure point

The motion tests print specific assertion messages like
`pwd cell flashed to 480px during transition` so the failure is obvious
without needing to watch the video.

## Adding a new motion test

The pattern is:
1. Set up a known state (`gotoFreshSession` → run setup commands)
2. Identify the *transition* you want to catch flashes in
3. Use `maxCellHeightDuring(page, ms, selector)` (or write a similar
   poller) to sample the layout at ~30ms intervals during the transition
4. Assert the maximum observed value never exceeds the resting value by
   more than a tolerance

Example:
```javascript
test('seq 1 30 does not flash beyond final height', async ({ page }) => {
    await gotoFreshSession(page);
    const inp = await waitInputReady(page);
    await inp.fill('seq 1 30');
    const measurePromise = maxCellHeightDuring(page, 2500);
    await inp.press('Enter');
    const maxH = await measurePromise;
    // final height should be ~660px (30 lines × 22px); cap is 80vh = 720px
    expect(maxH).toBeLessThan(800);
});
```

## Why a separate Playwright config?

The visual and e2e suites have different concerns:

- **`playwright.visual.config.js`** — runs `tests/visual/*.spec.mjs`,
  fast feedback, video only on failure, no global setup. Good for
  `npm run test:visual` while iterating on a fix.
- **`playwright.e2e.config.js`** — runs `tests/e2e/*.spec.mjs`, video
  always on (the screencast IS the audit artifact), spins up the
  userspace sshd for the SSH suite via `globalSetup`.

Keeping the configs separate lets you run the fast suite without
paying the sshd startup or the e2e video-capture overhead.

## CI tip

`TERMBOOK_CI=1` enables the `webServer` block in the visual config
that auto-starts both servers. In a real CI pipeline, prefer to start
servers yourself (more control over logs) and run with `TERMBOOK_CI`
unset.
