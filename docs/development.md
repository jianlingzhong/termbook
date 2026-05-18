# Development

How to actually work on Termbook day-to-day. Pairs with
[AGENTS.md](../AGENTS.md) (which has more rules; this doc has more
recipes).

## Dev loop

```bash
# fresh start (kills any stale processes, removes orphan rcfiles, starts both servers in tmux)
bash scripts/restart_servers.sh
```

Servers are now in two tmux sessions:
- `tb-be` — backend, output also tee'd to `/tmp/termbook-backend.log`
- `tb-fe` — frontend, output also tee'd to `/tmp/termbook-frontend.log`

Attach with `tmux attach -t tb-be` / `tb-fe` if you want to watch live.

Restart pattern when you change backend code:
```bash
bash scripts/restart_servers.sh
```
There's no nodemon — the script kills and respawns. Frontend Vite has
HMR **disabled** (see [AGENTS.md](../AGENTS.md) for why) so frontend
changes also need a hard reload in the browser:

> **Cmd+Shift+R** (Chrome) or **Cmd+Option+R** (Safari) — drops cached JS.

## Driving the app from a script

Don't manually click around to verify your change works. Use Playwright.
Pattern:

```javascript
import { chromium } from '@playwright/test';
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();

await page.goto('http://localhost:4000/?new_session=true', { waitUntil: 'networkidle' });
await page.waitForTimeout(800);

const inp = page.locator('.chat-input-wrapper textarea').first();
await inp.fill('ls -al');
await inp.press('Enter');
await page.waitForTimeout(2000);

await page.screenshot({ path: '/tmp/my-shot.png' });
await browser.close();
```

Save as `frontend/_scratch.mjs`, run with
`cd frontend && node _scratch.mjs`. **Delete it before committing.**

Useful helpers (and the canonical patterns) live in
`frontend/tests/visual/helpers.mjs`:
- `gotoFreshSession(page)` — open `?new_session=true` and wait for ready
- `waitInputReady(page)` — wait until the input is enabled
- `runCommand(page, cmd, waitMs)` — submit + wait
- `maxCellHeightDuring(page, ms)` — poll cell height for transient flashes

## Recording videos for motion bugs

```bash
# in your driver script
const ctx = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
  recordVideo: { dir: '/tmp/my-recording', size: { width: 1600, height: 1000 } },
});
// ... drive the app ...
await ctx.close();   // important — flushes the video file

# extract frames
ffmpeg -i /tmp/my-recording/*.webm -vf fps=10 /tmp/frames/f%03d.png

# look at a specific frame
# (use Read tool with path /tmp/frames/f015.png — it accepts PNGs)
```

10fps is usually enough. Bump to 20fps for sub-100ms transitions.

## Inspecting backend behavior

```bash
# truncate the log to remove noise from earlier runs
: > ssr_debug.log

# trigger the bug (in your browser or test)

# read the tail
tail -50 ssr_debug.log

# grep for specific events
grep -E "COMMAND_START|CELL_CLOSE|RESIZE" ssr_debug.log | tail -20
```

Common tags: `[SESSION_CREATE]`, `[WS_JOIN]`, `[COMMAND_START]`,
`[CELL_CLOSE]`, `[FINISH]`, `[RESIZE]`, `[ALIASES]`, `[SHELL_DETECT]`,
`[SESSION_DESTROY]`.

## Running tests

```bash
cd frontend
npm run test:visual          # 20 tests, ~100s
npm run test:motion          # 8 motion tests (~40s)
npm run test:regression      # 12 regression tests (~60s)

# single test
npx playwright test --config playwright.visual.config.js \
    -g "does not flash"

# debug a failing test interactively
npx playwright test --config playwright.visual.config.js \
    -g "pwd" --debug

# after failure, watch the recorded video
open frontend/test-results/<test-dir>/video.webm

# open the failure trace
npx playwright show-trace frontend/test-results/<test-dir>/trace.zip
```

## Common pitfalls

### "It worked in my test but the user says it's broken"

Almost always one of:

- Browser cached old JS. The user needs Cmd+Shift+R.
- Backend wasn't restarted after your `server.js` edit.
- Your test ran at 1600x1000 but the user is on a 2560 ultrawide.

When you make a change that depends on viewport, **test at multiple
viewports**. See the `_widthdiag.mjs` pattern in
[`docs/decisions.md#width`](decisions.md#width).

### Stale sessions during testing

If you create many sessions during testing, they pile up (idle GC is
1 hour). To clear them all immediately:

```bash
# kill servers, remove orphan rcfiles
tmux kill-session -t tb-be 2>/dev/null
tmux kill-session -t tb-fe 2>/dev/null
pkill -f "node server.js"
pkill -f vite
rm -f backend/termbook_bashrc_*
sleep 1
bash scripts/restart_servers.sh
```

Or just `bash scripts/restart_servers.sh` — it does the kill + cleanup
for you.

### Vite HMR causing weird state

If frontend behaves erratically (terminals showing stale state, cells
duplicated, etc.), check `frontend/vite.config.js` — HMR should be
disabled. If it's been re-enabled, **disable it again**. xterm.js's
internal renderer state survives HMR component swaps and gets corrupted
mid-session.

### `node-pty` `posix_spawnp failed`

```
chmod +x frontend/node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper
chmod +x frontend/node_modules/node-pty/prebuilds/darwin-x64/spawn-helper
```

(Replace `darwin-arm64` with `linux-x64` etc. as appropriate.)

`npm install` sometimes doesn't preserve the exec bit on the prebuilt
helper binary. Symptom: backend crashes with `Error: posix_spawnp
failed` whenever a session is created.

### "My change works but the test still fails"

The test might be testing the wrong thing. Read its assertion carefully.
Several motion tests assert *during* the transition; if your fix only
holds AFTER the transition completes, the test rightly fails.

If you genuinely believe the test is wrong, update it — but only after
confirming with the user. The motion tests were written deliberately to
catch specific user-reported flashes.

## Where things live

```
backend/server.js
├── ~line 13–30   debug log, debugLog()
├── ~line 32–65   extractUserAliases()
├── ~line 67–82   detectUserShell() + USER_SHELL constant
├── ~line 100–115 buildBashRc()
├── ~line 117–225 createSession() — PTY spawn, env, header
├── ~line 230–245 onData handler (TUI detection + parser)
├── ~line 246–310 cell close handler, snapshot capture
├── ~line 380–410 destroySession(), idle GC
├── ~line 360–445 WebSocket message handler

frontend/src/App.jsx
├── ~line 30–95   state declarations
├── ~line 55–92   focus management effects
├── ~line 95–165  scroll behavior (auto-scroll, jump-to-bottom)
├── ~line 185–215 createNewSession, deleteSession, requestResizeFor
├── ~line 270–340 WebSocket message handler (output/exit/tui_*/etc.)
├── ~line 370–400 handleCommand (submit)
├── ~line 460–510 render() for cells
├── ~line 511–540 render() for input bar

frontend/src/NotebookCell.jsx
├── ~line 25–47   trimSnapshotRows helper
├── ~line 64      component signature (note the prop list)
├── ~line 79–95   snapshot render effect (uses snapshotCols)
├── ~line 110–170 live xterm mount + resize + content-rows poll
├── ~line 175–225 render JSX: header + body + buttons
```

These line numbers will drift as the code changes. Use them as a
starting point, not gospel.

## How to add a new visual test

1. Decide if it's motion or functional. If you're catching something
   that's only visible *during* a transition (flash, intermediate
   state, layout jump), it's motion. Otherwise it's regression.

2. Open `frontend/tests/visual/motion.spec.mjs` or `regression.spec.mjs`.

3. Use helpers from `./helpers.mjs`. Don't import Playwright fixtures
   directly — the helpers handle the input-disabled-during-command
   nuance.

4. For motion tests, use `maxCellHeightDuring()` or write your own
   polling loop. Don't rely on `expect(page.locator(...).toHaveScreenshot())`
   alone — too brittle.

5. Verify your test fails without the fix, passes with it. See
   [`docs/decisions.md`](decisions.md) ("Motion tests must verify the
   test catches the bug").

6. `cd frontend && npm run test:visual` should pass 20/20 (now 21/21
   with your addition).

## Commit style

Match what's already there. Run `git log --oneline` and look at recent
commits.

- `feat(scope): summary` — new behavior
- `fix(scope): summary` — bug fix
- `refactor(scope): summary` — no behavior change
- `test(scope): summary` — test changes only
- `docs(scope): summary` — doc changes only

Body should explain **why** the change is needed, not what the diff
already shows. Reference the file/line numbers of the affected code.
Recent examples are in `git log` and they're worth imitating.

Commit in logical chunks. A single commit that touches backend,
frontend, tests, AND docs is too big — split it.
