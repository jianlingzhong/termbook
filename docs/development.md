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

There are **two test tiers**. `npm run test:all` runs both.

```bash
cd frontend

npm run test:visual          # 40 functional + motion tests (~3 min)
npm run test:e2e             # 40 end-to-end tests with screenshots/video (~5 min)
npm run test:all             # both, in sequence

# regenerate pixel goldens after intentional UI change
npm run test:e2e:update

# watch the browser drive itself
npm run test:e2e:headed

# focused runs
npm run test:motion          # motion subset of visual
npm run test:regression      # functional subset of visual

# single test by name pattern
npx playwright test --config playwright.e2e.config.js \
    -g "passthrough"

# debug a failing test interactively
npx playwright test --config playwright.e2e.config.js \
    -g "vim" --debug

# after failure, watch the recorded video
open frontend/test-results/<test-dir>/video.webm

# open the failure trace
npx playwright show-trace frontend/test-results/<test-dir>/trace.zip
```

When to use which:

- **`tests/visual/regression.spec.mjs`**: a single, focused regression
  for a specific bug. Fast. Add an entry whenever you fix something.
- **`tests/visual/motion.spec.mjs`**: a flash/jump/focus-loss that's
  only visible *during* a transition. Use `maxCellHeightDuring()` or
  similar polling.
- **`tests/e2e/*.spec.mjs`**: full user workflows that span multiple
  commands / sessions / pages. These produce screencasts + labeled
  screenshots automatically. Use `shot(page, testInfo, 'label')` to
  attach milestone screenshots to the HTML report.
- **`tests/e2e/06_visual_snapshots.spec.mjs`** and **`07_scroll_behavior.spec.mjs`**
  (G1/G2): pixel-level snapshot tests. Diffs against committed PNGs.
  After an intentional UI change, regenerate with `npm run test:e2e:update`
  AND visually inspect every regenerated golden before committing.

See [`docs/testing.md`](testing.md) for the full guide.

## Common pitfalls

### "It worked in my test but the user says it's broken"

Almost always one of:

- Browser cached old JS. The user needs Cmd+Shift+R.
- Backend wasn't restarted after your `server.js` edit.
- Your test ran at 1600x1000 but the user is on a 2560 ultrawide.

When you make a change that depends on viewport, **test at multiple
viewports** (e.g. write a quick Playwright driver that runs the same
command at 1280, 1600, 2560, and 3440 widths and screenshots each).
See [`docs/decisions.md#width`](decisions.md#width) for the three
layers that have to agree on terminal dimensions.

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

```bash
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

If you genuinely believe a test assertion is wrong, change it
deliberately and document why in the commit message. The motion tests
were written to catch specific user-reported flashes; weakening one
without understanding the original bug is how regressions ship.

## Where things live

Rather than cite line numbers (which drift), search by symbol name.
Useful entry points:

```text
backend/server.js
├── debugLog()                       debug log writer
├── extractUserAliases()             parses ~/.bashrc etc. at startup
├── detectUserShell()                informational; we always spawn bash
├── buildBashRc()                    per-session rcfile generator
├── createSession()                  session object + PTY spawn
├── attachPtyHandlers()              onData (parser + TUI detection)
│                                    + cell-close + snapshot capture
├── handleResize()                   min-of-clients arbitration
├── destroySession()                 cleanup (kill PTY, dispose, rm rc)
├── idleGc()                         idle-session sweeper
├── ws.on('message')                 WebSocket message handler

backend/ssh.js
├── parseSshCommand()                SSH-integration opt-in detection
├── buildRemoteIntegration()         injected snippet for remote shell

backend/parser.js
├── parseOutput()                    OSC 133;D + OSC 7 + OSC 1338 matcher

frontend/src/App.jsx
├── state declarations               near top of <App> component
├── focus management useEffect       global keydown for focus return
├── scroll behavior useEffect        auto-scroll + restore on switch
├── createNewSession, deleteSession  session lifecycle (+ requestResizeFor)
├── ws.onmessage handler             output/exit/tui_*/ssh_state/etc.
├── handleCommand                    chat-input submit + passthrough
├── render()                         cells + input bar

frontend/src/NotebookCell.jsx
├── trimSnapshotRows                 strip leading/trailing empty rows
├── snapshot render useEffect        uses snapshotCols from exit msg
├── live xterm useEffect             mount + resize + content-rows poll
├── render JSX                       header + body + buttons
```

Search the file (`grep -n 'symbolName' backend/server.js`) for the
current location. The symbol names are stable across refactors;
line numbers are not.

## How to add a new test

Decision flow:

1. Is the test about a single defect / regression you just fixed? Add
   to `frontend/tests/visual/regression.spec.mjs`. Fast, focused.
2. Is it about a *transient* flash / focus loss / layout jump? Add to
   `frontend/tests/visual/motion.spec.mjs` (use `maxCellHeightDuring()`
   or `sampleDuring()`).
3. Is it a multi-step user workflow (open session, run commands, switch
   sessions, etc.)? Add to `frontend/tests/e2e/*.spec.mjs`. These
   automatically produce a screencast and labeled screenshots.
4. Is it about pixel-perfect appearance? Add a `toHaveScreenshot()`
   assertion in `tests/e2e/06_visual_snapshots.spec.mjs` or
   `07_scroll_behavior.spec.mjs`. The golden goes in
   `<spec>.mjs-snapshots/` and is committed.

For ALL of them: verify the test fails without your fix, passes with
it. See [`docs/decisions.md`](decisions.md) ("Motion tests must verify
the test catches the bug").

Use helpers from `helpers.mjs` in each test directory. Don't import
Playwright fixtures directly — the helpers handle the
input-disabled-during-command nuance.

Full pattern docs and helper reference: [`docs/testing.md`](testing.md).

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
