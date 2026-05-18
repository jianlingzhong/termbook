# Termbook

A notebook-style web terminal. Each shell command becomes a "cell" with its own
status, output, timestamp, and history — like Jupyter, but for bash/zsh.

Self-hosted, localhost-only. Open-source.

![termbook screenshot placeholder](screenshots/.gitkeep)

## What it is

- One persistent shell session per "session" tab (think tmux session).
- Every command you type creates a notebook cell. The cell shows the command,
  its output, exit code, duration, and a colored status icon.
- TUIs (vim, top, opencode, gemini-cli) open in a full-screen modal that
  resizes the underlying PTY to fill the modal.
- Sessions survive page reloads — close the tab, come back, your shell is
  still alive with all its environment.
- Multiple browser tabs can share the same session and see each other's
  commands in real time.

## What it isn't

- Not a replacement for Warp/iTerm/your daily terminal — no AI, no themes,
  no settings UI.
- Not multi-user — anyone who can reach `localhost:4001` gets a shell. There
  is no authentication. Do not expose it beyond localhost.
- Not a Jupyter kernel — it's just bash/zsh in a PTY.

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

```bash
cd frontend
npm run test:visual         # full suite, expects servers already running
npm run test:visual:ci      # starts servers itself (slower, hermetic)
npm run test:motion         # motion-flash tests only (~40s)
npm run test:regression     # functional regression only (~60s)
```

See [`frontend/tests/visual/README.md`](frontend/tests/visual/README.md)
for what each test catches and how to add new ones.

## Documentation

- [AGENTS.md](AGENTS.md) — operating manual for AI coding agents working on
  this repo. **Read this first if you're an agent.**
- [docs/architecture.md](docs/architecture.md) — how it actually works today.
- [docs/decisions.md](docs/decisions.md) — every shipped fix with rationale
  and `file:line` references.
- [docs/development.md](docs/development.md) — dev loop, debugging recipes,
  common pitfalls.
- [docs/known-issues.md](docs/known-issues.md) — current limitations and
  tradeoffs we accept.

## Status

- ✅ Daily-driver usable for short commands, long output, TUIs (vim/top/etc),
  and multi-tab live sync.
- ⚠️ No auth. Localhost only.
- ⚠️ Repo has ~1800 leftover audit PNGs and ~50 abandoned `.spec.js` files
  from earlier debugging marathons. Not yet cleaned up — see
  [`docs/known-issues.md`](docs/known-issues.md).

## License

Not licensed for distribution. Personal project.
