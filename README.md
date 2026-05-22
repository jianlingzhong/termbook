# Termbook — a notebook-style web terminal for bash, zsh, and SSH

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)](CHANGELOG.md)
[![Tests](https://img.shields.io/badge/tests-101%20passing-brightgreen.svg)](frontend/tests/)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-blue.svg)](backend/package.json)
[![Status: feature-complete](https://img.shields.io/badge/status-feature--complete-success.svg)](#status)

Termbook is a self-hosted, browser-based terminal that turns every shell
command into a notebook cell — like Jupyter, but for bash, zsh, and remote
SSH sessions. Each cell shows the command, output, exit code, duration,
working directory, and git/venv/conda context. TUI apps (vim, nvim, htop,
less, lazygit, tig) open in a clean full-screen modal. SSH sessions get
per-remote-command cells with the real remote pwd, git branch, and exit
code. Built with xterm.js, React, node-pty, and SQLite. Localhost-only,
single-user, MIT licensed.

![Termbook screencast: running shell commands as notebook cells, opening vim in a modal, switching between sessions, on a dark cyan-accented UI](docs/termbook-demo.gif)

## What it is

- One persistent shell session per "session" tab (think tmux session).
- Every command you type creates a notebook cell. The cell shows the command,
  its output, exit code, duration, and a colored status icon.
- Cells carry env-awareness chips: git branch (purple), Python venv (yellow),
  conda env (green), and remote SSH host (orange).
- **SSH-aware:** type `ssh user@host` and Termbook automatically injects a
  salted shell-integration into the remote shell. From that point each
  REMOTE command becomes its own Termbook cell with the real remote pwd,
  git branch, and exit code. Tab in the chat input completes against the
  REMOTE filesystem (paths AND command names on PATH); Ctrl+D cleanly
  ends the SSH session (synthesizes a visible `exit` cell, works on any
  remote shell regardless of `^D` binding). While in SSH the host is
  shown in three deliberate places — the input prompt prefix becomes
  an orange `🖥 host ❯` badge right where you type (so you never
  accidentally type thinking you're local), the sidebar marks the
  session with a Server icon, and each remote cell carries an orange
  host chip in its header. The local prompt prefix shows your actual
  hostname (e.g. `your-mac.local ❯`) when not in SSH. Append
  `--no-termbook` to opt out per-command and get a plain passthrough
  terminal.
- **TUI apps work out of the box:** vim, nvim, emacs, htop, less, tig,
  lazygit, ranger, etc. open in a full-screen modal automatically.
  Detection is content-based (mouse mode + cursor positioning patterns)
  rather than a hardcoded list, so any TUI app you run is handled
  correctly without configuration. Modern neovim — which doesn't emit
  the standard alt-screen escape in many configurations — is supported
  via the same mechanism.
- Interactive commands (gemini-cli, claude-cli, `cat`, `read`, Python REPL)
  run inline in their cell. The chat input enters "passthrough mode" and
  forwards every keystroke to the running command's PTY (Enter as `\r`,
  arrow keys, Ctrl+C/D, etc.). When the command exits, normal mode resumes.
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
- WebGL renderer for pixel-perfect cursor alignment (falls back to DOM
  renderer where WebGL is unavailable).

## What it isn't

- Not a replacement for Warp/iTerm/your daily terminal — no AI
  integration, no themes, no settings UI.
- Not multi-user — anyone who can reach `localhost:4001` gets a shell.
  There is no authentication. **Do not expose it beyond localhost.**
  See [SECURITY.md](SECURITY.md).
- Not a Jupyter kernel — it's just bash/zsh in a PTY.

## Quickstart

Requirements: Node 22+ (works through 26), macOS or Linux. Windows
support is untested — node-pty has known Windows issues.

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

`mprocs.yaml` is also provided if you prefer
[mprocs](https://github.com/pvolok/mprocs).

## Testing

```bash
cd frontend

npm run test:visual         # 40 functional + motion regression tests (~3 min)
npm run test:e2e            # 60 end-to-end human-workflow tests with
                            # screenshots + screencasts + pixel goldens
                            # (includes 16 SSH Path B tests that spin up
                            # a userspace sshd on 127.0.0.1:2222) (~6 min)
npm run test:all            # both, in sequence
npm run test:e2e:update     # regenerate golden screenshots
npm run test:e2e:headed     # watch the browser drive itself
```

Servers must be running first (`bash scripts/restart_servers.sh`).

See [`docs/testing.md`](docs/testing.md) for when to add what kind of test
and how. See [`frontend/tests/e2e/README.md`](frontend/tests/e2e/README.md)
and [`frontend/tests/visual/README.md`](frontend/tests/visual/README.md)
for layout and conventions.

## Documentation

- [AGENTS.md](AGENTS.md) — operating manual for AI coding agents working on
  this repo. The most thorough onboarding doc; **start here** even if
  you're a human.
- [docs/architecture.md](docs/architecture.md) — how it actually works
  today (data flow, state machines, SSH Path B, TUI lifecycle).
- [docs/decisions.md](docs/decisions.md) — every shipped fix with rationale
  and `file:line` references. The "why" of the codebase.
- [docs/development.md](docs/development.md) — dev loop, debugging
  recipes, common pitfalls.
- [docs/testing.md](docs/testing.md) — when to write which kind of test,
  helper APIs, golden-screenshot workflow.
- [docs/known-issues.md](docs/known-issues.md) — current limitations and
  tradeoffs we accept.
- [docs/skills/termbook-e2e/SKILL.md](docs/skills/termbook-e2e/SKILL.md) —
  loadable skill (for OpenCode/Claude/etc.) on driving Termbook E2E tests.
- [CONTRIBUTING.md](CONTRIBUTING.md) — how to contribute.
- [SECURITY.md](SECURITY.md) — threat model and reporting policy.
- [CHANGELOG.md](CHANGELOG.md) — release notes.

## Status

Termbook is **v1.0** — feature-complete and in **maintenance mode**.
Bug fixes are welcome via PR (see [CONTRIBUTING.md](CONTRIBUTING.md));
large new features are unlikely to be merged.

If you're looking for a more actively developed terminal-with-AI or
terminal-with-blocks, consider [Warp](https://www.warp.dev/) (Mac,
commercial), [Wave Terminal](https://www.waveterm.dev/) (cross-platform,
open source), or your editor's built-in terminal (Cursor, Zed, etc.).
Termbook fills a different niche: a self-hosted, browser-based,
SSH-with-cell-semantics notebook that runs anywhere a browser can
reach.

## License

[MIT](LICENSE) — © 2026 Jianling Zhong.
