# End-to-end tests

These tests **drive the running app like a human user**: click, type, wait,
scroll, screenshot. They are the source of truth for "Termbook works end
to end" and they protect every behavior we care about from silent
regressions.

## Layout

```
tests/e2e/
├── helpers.mjs                      # shared waiters, key helpers, shot()
├── 01_dev_workflow.spec.mjs         # pwd → git → ls → cat → history → palette → fullscreen
├── 02_interactive_commands.spec.mjs # passthrough: cat, read, arrows, Ctrl+C/D/U, Tab, backspace
├── 03_alt_screen_tui.spec.mjs       # vim modal lifecycle
├── 04_persistence.spec.mjs          # backend restart → cells survive
├── 05_motion_stability.spec.mjs     # sampling-based flash detection
├── 06_visual_snapshots.spec.mjs     # pixel-diff against golden PNGs
├── 07_scroll_behavior.spec.mjs      # 19-test scroll matrix (submit/switch/restore/bounce/vim/passthrough)
├── 08_ssh_session.spec.mjs          # SSH Path B: remote pwd/git/exit, Tab, Ctrl+D, chips, vim over SSH
├── ssh-global-setup.mjs             # spawns userspace sshd on 127.0.0.1:2222
└── ssh-global-teardown.mjs
```

For the full helper API reference and conventions, see
[`docs/testing.md`](../../../docs/testing.md). For agents working on this
codebase, also see
[`docs/skills/termbook-e2e/SKILL.md`](../../../docs/skills/termbook-e2e/SKILL.md).

## Running

Before any run: the backend AND frontend must be live (`bash
scripts/restart_servers.sh` from the repo root).

```bash
cd frontend
npm run test:e2e                 # all e2e specs
npm run test:e2e -- -g "vim"     # filter by name
npm run test:e2e:headed          # watch the browser drive itself
npm run test:e2e:update          # regenerate golden screenshots
```

## What each test produces

Every test run leaves behind, under `test-results/<test-name>/`:

- `video.webm` — full screencast of the test (the screencast IS the
  audit artifact for motion/timing bugs)
- `<00..NN>_<label>.png` — labeled screenshots at every meaningful step
  (welcome, after_git_status, palette_open, etc.)
- `trace.zip` — full Playwright trace; open with
  `npx playwright show-trace test-results/.../trace.zip`

The HTML report at `playwright-report-e2e/index.html` collects everything
into a browsable dashboard.

## Golden screenshots (visual snapshots)

`06_visual_snapshots.spec.mjs` and `07_scroll_behavior.spec.mjs` (G1/G2)
use `expect(page).toHaveScreenshot(name)`, which diffs against stored
PNGs under `tests/e2e/<spec>.mjs-snapshots/`.

- **First run**: the golden is created. Inspect it manually, then commit
  it.
- **Subsequent runs**: pixel-by-pixel diff with `maxDiffPixelRatio: 0.02`
  tolerance (set in `playwright.e2e.config.js`).
- **After intentional UI changes**: regenerate with `npm run
  test:e2e:update` AND visually inspect the diff before committing the
  new goldens.

Volatile UI (session IDs, timestamps, durations) is masked via
`mask: [...]` per snapshot.

## When to add a new e2e test

Add one whenever you:

1. **Ship a user-visible feature.** The new feature gets one e2e that
   walks through the full workflow.
2. **Fix a bug a user reported.** Add an e2e that fails without the fix
   and passes with it. Bonus: a `06_visual_snapshots` entry of the
   fixed UI.
3. **Find a flash, focus loss, or timing glitch.** Add a
   `05_motion_stability` test that samples the relevant property
   during the transition.

## Anti-patterns

- **Don't write spec files outside `tests/e2e/` for ad-hoc debugging.**
  If a problem is worth investigating, write the spec here so future
  agents and contributors inherit your work. One-off `_drive_*.mjs`
  scripts in the repo root or in `frontend/` get forgotten and
  reinvented; specs in `tests/e2e/` get run on every CI.
- **Don't rely on fixed `waitForTimeout(N)` for "settled" state.** Use
  `waitForIdle`, `waitForPassthrough`, or `waitInputReady`. Race
  conditions hide in arbitrary sleeps.
- **Don't mock the backend.** These are E2E tests — they must hit a
  real backend, a real PTY, a real SQLite db. Unit tests live elsewhere.
