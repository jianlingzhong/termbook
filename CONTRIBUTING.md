# Contributing to Termbook

Termbook is a personal-project-turned-public terminal-as-a-notebook. The
maintainer (Jianling) ships at a hobbyist pace and is **not actively
soliciting contributions** — but if you find a bug, want a small fix, or
have an idea, you're welcome.

## Before opening an issue

1. **Search existing issues** — many "bugs" are documented limitations
   in [`docs/known-issues.md`](docs/known-issues.md).
2. **Reproduce locally** — Termbook is browser+Node, so behavior can
   depend on your shell config (zsh customizations especially affect
   the SSH "Path B" integration). Try with `bash -i` for clean repro.
3. **Read the [AGENTS.md](AGENTS.md)** — it explains how the project is
   organized and where to look for things. It's targeted at AI coding
   agents but is the best onboarding doc for humans too.

## Before opening a PR

1. **Run the full test suite**: from `frontend/` run `npm run test:all`.
   You should see `100 passed + 1 skipped` (the WebGL test skips in
   headless without GPU). All 100 must stay green.
2. **If you fixed a regression, add a regression test.** This is the
   strict expectation in this codebase — see
   [`docs/testing.md`](docs/testing.md) and the "Anti-patterns"
   section of [AGENTS.md](AGENTS.md). PRs that fix a bug without a
   test will be asked to add one.
3. **Don't restore deleted historical artifacts.** Commit `0656f44`
   removed ~160 files of pre-v1.0 debugging cruft; they're preserved
   in git history but should not come back to the working set.

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

You'll need:
- **Node.js 22 or newer** (tested through 26)
- **macOS or Linux** (Windows untested; node-pty has known Windows
  issues)
- **A login shell with PROMPT_COMMAND support** — bash, zsh, or fish.
  Termbook drops its own rcfile into the spawned shell.

For the SSH test suite (`08_ssh_session.spec.mjs`), the test setup will
spin up a userspace sshd on `127.0.0.1:2222` automatically. You may need
to grant the test your SSH key (the setup script does this on first
run; see `frontend/tests/e2e/ssh-global-setup.mjs`).

## Code style

- Match what's already there. No prettier/eslint config is
  authoritative; the existing files are the spec.
- Comments should explain **why**, not what. The code already shows
  what; the comment should explain the non-obvious reason it's
  written that way (especially for bug fixes — see the dozens of
  in-source comments referencing `docs/decisions.md`).
- File length: `backend/server.js` and `frontend/src/App.jsx` are long
  but coherent single files. Don't split for cosmetics.

## Reporting security issues

See [SECURITY.md](SECURITY.md). Short version: Termbook is
localhost-only by design and has no authentication. Don't expose it to
the network. If you find an issue that could affect even local users
(e.g., a way for a website to reach the local server), email the
maintainer at the address in [package.json](package.json).

## License

By submitting a contribution, you agree it will be released under the
[MIT License](LICENSE).
