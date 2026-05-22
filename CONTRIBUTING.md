# Contributing to Termbook

Termbook is a self-hosted notebook-style web terminal. Bug reports,
small fixes, and focused feature PRs are welcome. The project is in
**maintenance mode** (see [README — Status](README.md#status)) — large
new features are unlikely to be merged.

## Before opening an issue

1. **Search existing issues** — many "bugs" are documented limitations
   in [`docs/known-issues.md`](docs/known-issues.md).
2. **Reproduce locally** — Termbook is browser+Node, so behavior can
   depend on your shell config (zsh customizations especially affect
   the SSH "Path B" integration). Try with `bash -i` for a clean
   repro.
3. **Read [AGENTS.md](AGENTS.md)** — it explains how the project is
   organized and where to look for things. It's targeted at AI coding
   agents but is the best onboarding doc for humans too.

For frontend bugs (cell stuck, modal won't open, etc.), include the
output of `__tbDebug()` from your browser's DevTools console. For
backend bugs, include the tail of `ssr_debug.log` (repo root). See
[AGENTS.md → Bug reports](AGENTS.md#bug-reports).

## Before opening a PR

1. **Run the full test suite**: from `frontend/` run
   `npm run test:all`. You should see `100 passed + 1 skipped` (the
   WebGL test skips in headless environments without GPU). All 100
   must stay green.
2. **If you fixed a regression, add a regression test.** This is a
   firm expectation in this codebase — see
   [`docs/testing.md`](docs/testing.md) and the "Anti-patterns
   to avoid" section of [AGENTS.md](AGENTS.md). PRs that fix a bug
   without a test will be asked to add one before merge.
3. **Match the existing commit style.** Run `git log --oneline` and
   imitate. Format: `type(scope): summary` with a body that explains
   *why* (the diff already shows *what*).

## Development setup

```bash
# install
cd backend && npm install && cd ..
cd frontend && npm install && cd ..

# run both servers (in tmux)
bash scripts/restart_servers.sh
# or run them in two terminals:
#   cd backend  && node server.js          # port 4001
#   cd frontend && npm run dev             # port 4000

# open
open http://localhost:4000
```

Requirements:
- **Node.js 22 or newer** (tested through 26)
- **macOS or Linux** (Windows is untested; node-pty has known Windows
  issues — use WSL2)
- **bash or zsh** as the user shell. Termbook always spawns bash
  internally regardless, but imports aliases from the user's
  `.bashrc` / `.zshrc` / `.aliases` etc.

For the SSH test suite (`08_ssh_session.spec.mjs`), the test setup
spawns a userspace sshd on `127.0.0.1:2222` automatically on first
run. See `frontend/tests/e2e/ssh-global-setup.mjs`.

## Code style

- Match what's already there. No prettier/eslint config is
  authoritative; the existing files are the spec.
- Comments should explain **why**, not what. The code already shows
  what; the comment should explain the non-obvious reason it's
  written that way (especially for bug fixes — see the in-source
  comments referencing `docs/decisions.md`).
- File length: `backend/server.js` (~1100 lines) and
  `frontend/src/App.jsx` (~1300 lines) are long but coherent
  single files. Don't split for cosmetics.

## Reporting security issues

See [SECURITY.md](SECURITY.md) for the threat model and reporting
process.

## License

By submitting a contribution, you agree it will be released under the
[MIT License](LICENSE).
