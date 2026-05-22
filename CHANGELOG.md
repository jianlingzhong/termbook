# Changelog

All notable changes to Termbook are documented here. Format is loosely
[Keep a Changelog](https://keepachangelog.com/). Versions follow
[Semantic Versioning](https://semver.org/).

## [1.0.0]

### Highlights

- **Cell model**: every shell command is a notebook cell with
  command, output, exit code badge, duration, pwd, git/venv/conda
  chips, and copy/rerun actions.
- **SSH integration**: typing `ssh user@host` auto-injects a salted
  shell integration so each REMOTE command becomes its own cell with
  real remote pwd / git / exit code. Tab completion routes to the
  remote shell. The host appears next to the input prompt so you
  can't accidentally type thinking you're local. `--no-termbook` opts
  out per command. Absolute paths like `/usr/bin/ssh` are recognized
  too (helpful when the system `ssh` is shadowed).
- **TUI auto-promotion**: vim, nvim, htop, less, lazygit, tig,
  brew/npm installers with progress UIs — all detected by behavior
  (alt-screen + mouse mode + cursor positioning patterns), not by
  name. Modal opens automatically; main-screen output before/after
  is preserved.
- **Sessions survive page reloads AND backend restarts** via
  SQLite persistence. Multiple browser tabs share a session live.
- **WebGL renderer** for pixel-perfect cursor alignment (falls back
  to DOM where WebGL is unavailable, with a known minor cursor
  sub-pixel drift in nvim navigation on the fallback path).
- **Cmd+K palette**, **Ctrl+R history search**,
  **Cmd+Shift+F maximize**, desktop notifications when long
  commands finish in a background tab.
- **101 automated tests** across motion-regression and full e2e
  workflow suites (40 visual + 60 e2e + 1 WebGL test that skips
  when GPU is unavailable, totalling 101). The e2e suite includes
  16 SSH integration tests against a userspace sshd.

### Known limitations

See [`docs/known-issues.md`](docs/known-issues.md). Notably:

- **Localhost only. No authentication.** Don't expose to a network.
- **Windows is untested.** Use WSL2.
- The WebGL renderer silently falls back to DOM if GPU is
  unavailable, reintroducing minor cursor sub-pixel drift in nvim
  navigation.
- The SSH integration's salted shell snippet is plaintext in the
  remote shell's environment — same threat model as the local salt.
