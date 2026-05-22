# Known issues & tradeoffs

Current limitations of Termbook. Some are bugs that haven't been
fixed; others are deliberate tradeoffs that won't be fixed without a
strong reason. Read this before reporting "X is broken" — it might be
intentional.

For the historical bug list (what's already been fixed and why), see
[decisions.md](decisions.md).

---

## Deliberate tradeoffs (won't fix without strong reason)

### No authentication

Termbook accepts any WebSocket connection on `:4001/ws` and gives it a
shell as the server user. There is no auth check.

**Rationale**: it's a localhost dev tool. Adding auth (token? OAuth?
basic auth?) is non-trivial and out of scope. If you want to expose
Termbook over a network, put it behind a reverse proxy with auth (e.g.,
nginx with basic auth, or Tailscale's `serve` with identity).

**If you do nothing**: the backend binds to `127.0.0.1` by default
(loopback only) so Termbook is unreachable from the LAN out of the
box. If you set `TERMBOOK_BIND=0.0.0.0` or run it behind a
container/Codespaces port-forward that proxies external traffic to
loopback, you've opened a shell to whoever can reach that endpoint —
put auth in front.

### Always `/bin/bash` regardless of user shell

Termbook detects the user's `$SHELL` (logged as `[SHELL_DETECT]`) but
always spawns bash. Aliases are imported but functions, fancy prompts,
and shell-specific features aren't.

**Rationale**: see [decisions.md](decisions.md#shell). Powerlevel10k
and similar zsh prompt themes actively fight the OSC 133 marker
injection. Bash with a controlled rcfile is the only setup that proved
reliable.

### PTY processes die on server restart (cells survive)

Restart the backend → the live PTYs themselves are gone (their child
processes can't be re-attached). But session metadata and finished
cells **are persisted to `termbook.db` (SQLite)** and reload
automatically on next page load. The user sees their history; a fresh
PTY is spawned lazily when they next interact with the session.

**What's still lost on restart**: in-flight commands (anything that
was running when the backend went down), shell environment (env vars
set with `export`, things piped through `source`, etc.), and the
current working directory drift inside the lost PTY. The session's
`pwd` is restored from the DB (last finished cell's `pwd`).

**Rationale for not preserving more**: serializing a live PTY's state
is genuinely hard (scrollback, env vars, half-typed input,
subprocesses). For now, finished cells + last pwd is the right
trade-off. Use `scripts/restart_servers.sh` so restarts are rare.

The DB lives at repo-root `termbook.db` (override with
`TERMBOOK_DB_PATH=`). Reset with `node backend/server.js --reset-db`
or just `rm termbook.db*`.

### No backend unit tests

All testing is end-to-end through Playwright. There is no Jest or
similar unit-test runner configured.

**Rationale**: the backend's logic (PTY wrangling, OSC parsing) is
hard to unit-test in isolation — most bugs are about how it interacts
with real shells. E2E catches those; unit tests would be theater.

If you change `parser.js` and want quick feedback,
`grep -E "FINISH|MARKER" ssr_debug.log` after a real session is faster
than writing a unit test.

### No TypeScript

Plain JavaScript / JSX everywhere. Backend uses CommonJS, frontend uses
ESM.

**Rationale**: backend is ~1100 lines, frontend is ~1300 lines. TS
overhead isn't worth the safety at this size. If the codebase doubles,
revisit.

### `xterm.js` WebGL renderer with DOM fallback

`App.jsx` loads `@xterm/addon-webgl` and activates it when WebGL is
available. When it's not (older browsers, headless Chromium without
GPU, software-rendered VMs), xterm silently falls back to the DOM
renderer.

**Why WebGL**: the DOM renderer's font-metric cellWidth is fractional
(e.g. ~7.81px for JetBrains Mono 13px). The absolutely-positioned
cursor overlay drifts off-grid after many cursor moves in apps like
nvim. WebGL draws every cell at integer pixel boundaries, so the
cursor stays aligned.

**Cost of WebGL**: contexts are limited (browsers cap around 16
simultaneous WebGL contexts). Each notebook cell that's ever been
"live" needs an xterm instance. Termbook disposes the live xterm when
a cell finishes (the snapshot is rendered to HTML), keeping the active
WebGL count low — but if a single session keeps many cells alive at
once (e.g. several long-running commands in parallel), context
exhaustion is theoretically possible.

---

## Bugs we know about but haven't fixed

### Some TUI apps render small inside the generous modal

Apps that center themselves in a fixed-size UI box (regardless of
terminal dimensions) leave empty padding inside Termbook's modal. The
modal sizes the PTY up to 1800×1200; if the app draws into only 80×24
of that, the rest stays empty.

**Not Termbook's bug**: it's the app's UI design choice. Termbook
gives it the full modal area to work with.

### Background jobs leak output into the next cell

```bash
ping 8.8.8.8 &      # cell A finishes, ping keeps running
ls                  # cell B — but ping's output bleeds in
```

The PTY is shared across cells. Backgrounded processes still own
stdout. There's no way to redirect their output to a "background"
buffer because bash has one stdout per process.

**Workarounds**: redirect explicitly
(`ping 8.8.8.8 > /tmp/ping.log &`) or accept the leak.

Detecting mid-cell output that doesn't follow a `start` and routing it
elsewhere is possible but gnarly, and the use case is edge-y.

### Long-running commands stream nothing for a few seconds

Output is buffered up to ~64KB before being flushed. For commands that
emit slowly (`while true; do echo foo; sleep 1; done`), this is fine.
For commands that emit a steady stream of small writes, nothing
appears for a while, then a burst.

**Cause**: node-pty's default buffering + a ~50ms throttle in the
`onData` handler.

**Not fixed because**: tightening the throttle generates more
WebSocket traffic per cell and the SIGWINCH-storm prevention work is
delicate. Not worth touching without a real complaint.

### SSH Path B: cosmetic prompt residue in remote cell snapshots

When Path B is active, each remote-issued cell's snapshot tail often
contains an extra line or two of the remote shell's prompt re-rendering
(e.g. p10k's right-side prompt drawing). The cell's exit code, pwd, and
git chip are all correct; this is purely visual noise at the bottom of
the snapshot.

**Cause**: `__tb_remote_prompt` runs as `precmd` / `PROMPT_COMMAND`
BEFORE the next prompt prints, but the remote shell typically also has
its own prompt-drawing logic that writes a line of output. The
snapshot is captured at the next salted finish marker, which includes
any output the remote shell wrote between the previous command and the
marker.

**Not fixed because**: stripping prompt artifacts heuristically risks
chopping legitimate trailing output. Cosmetic; ignored for v1.

### SSH Path B: per-SSH salt is plaintext on the remote

The `sshSalt` is injected into the remote shell's environment as part
of PROMPT_COMMAND. Any process on the remote that can read the shell's
environment (e.g. `cat /proc/$$/environ` on Linux, or `ps eww` viewing
your own process env) can read the salt and forge cell-close markers.

**Threat model**: Termbook targets local / dev / self-owned hosts. If
you SSH into a truly untrusted shared host, use `ssh --no-termbook` to
disable the integration.

**Same model** as the local salt — also plaintext in `PROMPT_COMMAND`
of your local bash; any local process can read it. Documented for
completeness.

### SSH Path B: nested SSH only injects on the outermost

`ssh host1`, then on host1 `ssh host2` — only host1 gets the salted
integration. The inner ssh is treated as a normal remote command from
Termbook's POV. Inner commands run inside one wrap-cell with no
per-command boundaries.

**Could be fixed** by detecting `ssh` commands typed INSIDE an active
Path B session and re-running the inject machinery for the inner
shell. Punted for v1; not a common-enough workflow to justify the
state-machine complexity.

### SSH Path B: integration fails silently after 12 seconds

If the remote shell isn't bash or zsh, or has output suppression that
swallows the salted printf, the inject won't yield a salted marker.
`SSH_INJECT_TIMEOUT` fires and `sshState='failed'`. The session
degrades to the pre-feature behavior (one big cell, unsalted markers
from remote may close cells). No user-visible error.

**Should** surface this as a small UI indicator (e.g. "integration
off" chip with a tooltip explaining how to retry). Not done in v1.

### No mobile layout

`@media (max-width: 768px)` rules exist in `index.css` and hide the
sidebar, but the layout hasn't been carefully tested on phones. Touch
interactions (especially the input textarea with iOS Safari's
keyboard) might be janky.

**Not fixed because**: Termbook's value proposition isn't great on a
6" screen anyway.

### Windows is untested

`node-pty` has known Windows quirks (ConPTY vs Cygwin PTY, prebuild
issues). Termbook has never been tried on Windows.

**If you're on Windows**: WSL2 is the recommended path — run Termbook
inside the WSL Linux environment and access it from a Windows browser
at `http://localhost:4000`.

---

## What would change priorities

If any of the following becomes a real ask, the corresponding "won't
fix" entry should be reconsidered:

- **Auth becomes needed** → token-in-URL is the easiest minimum.
- **Insistence on the user's actual shell** → revisit the marker
  injection via an `LD_PRELOAD`-style approach, or wrap the shell in a
  tiny Rust/Go binary that always emits the marker.
- **Live PTY persistence (not just cell metadata)** → spawn shells
  under a session manager (tmux/screen) and reattach on restart. The
  current SQLite layer covers finished cells + last pwd, which has
  been sufficient.
