# Changelog

All notable changes to Termbook are documented here. Format is loosely
[Keep a Changelog](https://keepachangelog.com/). Versions follow [Semantic
Versioning](https://semver.org/).

## [1.0.0] — initial public release

**Scope**: feature-complete personal terminal-as-a-notebook. Active
development paused after this release; bug fixes welcome.

### Highlights

- **Cell model**: every shell command is a notebook cell with command,
  output, exit code badge, duration, pwd, git/venv/conda chips, and
  copy/rerun actions.
- **SSH "Path B" integration**: typing `ssh user@host` auto-injects a
  salted shell integration so each REMOTE command becomes its own cell
  with real remote pwd / git / exit code. Tab completion routes to the
  remote shell. The host appears next to your input prompt so you can't
  accidentally type thinking you're local. `--no-termbook` opts out.
- **TUI auto-promotion**: vim, nvim, htop, less, lazygit, tig, brew/npm
  installers with progress UIs — all detected by behavior (alt-screen +
  mouse mode + cursor positioning patterns), not by name. Modal opens
  automatically; main-screen output before/after is preserved.
- **Sessions survive page reloads AND backend restarts** via SQLite
  persistence. Multiple tabs share a session live.
- **WebGL renderer** for pixel-perfect cursor alignment.
- **Cmd+K palette**, **Ctrl+R history search**, **Cmd+Shift+F maximize**,
  desktop notifications when long commands finish in background.
- **100 automated tests** across motion regression and full e2e
  workflow suites (40 visual + 60 e2e, plus 1 WebGL test that skips
  when no GPU is available — 101 in total). The e2e suite includes
  16 SSH Path B tests against a userspace sshd.
- **Absolute-path `ssh` invocations are recognized**: `/usr/bin/ssh
  user@host` engages Path B just like bare `ssh`. Useful when the
  user's PATH has a wrapper (e.g. corp-managed gnubby-ssh) and they
  want to bypass it.

### Known limitations

See [`docs/known-issues.md`](docs/known-issues.md). Notably:

- Localhost only. No authentication. Don't expose to a network.
- node-pty issues mean Windows support is untested and likely broken.
- The WebGL renderer silently falls back to DOM if GPU is unavailable,
  reintroducing minor cursor sub-pixel drift in nvim navigation.
- SSH "Path B" salted integration is plaintext in the remote shell's
  environment — same threat model as the local salt.

### Not in v1.0 (no plans to add)

- AI integration. The structured cell data would be perfect for an LLM,
  but is not built. Termbook leaves you to use Warp or paste cells into
  your tool of choice.
- Multi-user / sharing / collaboration.
- Native packaging (electron, etc.). It's a browser app.
- A settings UI. Configuration is in `app_config.json`.

---

Pre-1.0 history is in the git log. The project went through several
major architectural iterations (frontend-only xterm → server-side
shadow buffer → current hybrid). Most of that history is preserved in
commits prior to `0656f44`.
