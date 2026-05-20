# Termbook

A notebook-style web terminal. Each shell command becomes a "cell" with its own
status, output, timestamp, and history — like Jupyter, but for bash/zsh.

Self-hosted, localhost-only. Open-source.

![termbook screenshot placeholder](screenshots/.gitkeep)

## What it is

- One persistent shell session per "session" tab (think tmux session).
- Every command you type creates a notebook cell. The cell shows the command,
  its output, exit code, duration, and a colored status icon.
- Cells carry env-awareness chips: git branch (purple), Python venv (yellow),
  conda env (green).
- TUIs (vim, top, htop) — anything that uses the alt-screen buffer — open in
  a full-screen modal that resizes the underlying PTY to fill the modal.
- Interactive commands (gemini-cli, claude-cli, `cat`, `read`, Python REPL) run
  inline in their cell. The chat input enters "passthrough mode" and forwards
  every keystroke to the running command's PTY (Enter as `\r`, arrow keys,
  Ctrl+C/D, etc.). When the command exits, normal mode resumes.
- Sessions survive page reloads AND backend restarts — finished cells are
  persisted to SQLite (`termbook.db`); on restart the history reloads and
  a fresh PTY is spawned lazily on next interaction.
- Multiple browser tabs can share the same session and see each other's
  commands in real time.
- Tab completion: file/dir paths and `$PATH` executables, with cycle-through
  for multiple candidates (Tab again to cycle).
- Ctrl+R fuzzy history search overlay — type to filter, Enter to use,
  Esc to cancel.
- Cmd+K action palette — fuzzy-searchable list of all in-app actions
  (new session, clear output, re-run last command, search history, copy
  last output, toggle full-screen, etc.).
- Cmd+Shift+F to maximize the workspace (hide sidebar + top header).
  Preference persists across reloads.
- Desktop notifications when a long-running command finishes in a
  background tab.
- Scroll behavior:
  - After submit, the new cell sits at the top of the viewport.
  - On session switch, by default the latest cell is at the top.
  - If you had scrolled a session before switching away, your scroll
    position is restored on return.

## What it isn't

- Not a replacement for Warp/iTerm/your daily terminal — no AI, no themes,
  no settings UI.
- Not multi-user — anyone who can reach `localhost:4001` gets a shell. There
  is no authentication. Do not expose it beyond localhost.
- Not a Jupyter kernel — it's just bash in a PTY.

## Quickstart

Requirements: Node 22+ (works through 26), macOS or Linux.

```bash
# install
cd backend && npm install && cd ..
cd frontend && npm install && cd ..

# run (both at once via the helper)
bash scripts/restart_servers.sh

# or run them in two terminals
cd backend  && node server.js          # :4001
cd frontend && npm run dev             # :4000

# open
open http://localhost:4000
```

`mprocs.yaml` is also provided if you prefer `mprocs`.

## Testing

There are two test tiers:

```bash
cd frontend

npm run test:visual         # 40 functional + motion regression tests (~3 min)
npm run test:e2e            # 40 end-to-end human-workflow tests with
                            # screenshots + screencasts + pixel goldens (~5 min)
npm run test:all            # both, in sequence
npm run test:e2e:update     # regenerate golden screenshots
npm run test:e2e:headed     # watch the browser drive itself
```

Servers must be running first (`bash scripts/restart_servers.sh`). The
`test:visual:ci` variant starts them itself but is slower.

See [`docs/testing.md`](docs/testing.md) for when to add what kind of test
and how. See [`frontend/tests/e2e/README.md`](frontend/tests/e2e/README.md)
and [`frontend/tests/visual/README.md`](frontend/tests/visual/README.md)
for layout and conventions.

## Documentation

- [AGENTS.md](AGENTS.md) — operating manual for AI coding agents working on
  this repo. **Read this first if you're an agent.**
- [docs/architecture.md](docs/architecture.md) — how it actually works today.
- [docs/decisions.md](docs/decisions.md) — every shipped fix with rationale
  and `file:line` references.
- [docs/development.md](docs/development.md) — dev loop, debugging recipes,
  common pitfalls.
- [docs/testing.md](docs/testing.md) — when to write which kind of test,
  helper APIs, golden-screenshot workflow.
- [docs/known-issues.md](docs/known-issues.md) — current limitations and
  tradeoffs we accept.
- [docs/skills/termbook-e2e/SKILL.md](docs/skills/termbook-e2e/SKILL.md) —
  loadable skill (for OpenCode/Claude/etc.) on driving Termbook E2E tests.

## Status

- ✅ Daily-driver usable for short commands, long output, alt-screen TUIs
  (vim/top/etc), inline interactive CLIs (gemini/cat/REPLs), multi-tab live
  sync, and full session persistence across backend restarts.
- ⚠️ No auth. Localhost only.
- ⚠️ Repo has ~1800 leftover audit PNGs and earlier ad-hoc `.spec.js` files
  from earlier debugging marathons. Not yet cleaned up — see
  [`docs/known-issues.md`](docs/known-issues.md).

## License

Not licensed for distribution. Personal project.
