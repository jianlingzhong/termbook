# Known issues & tradeoffs

Current limitations of Termbook. Some of these are bugs we haven't
fixed; others are deliberate tradeoffs that we won't fix without a
strong reason. Read this before reporting "X is broken" — it might be
intentional.

For the historical bug list (what we've already fixed and why), see
[decisions.md](decisions.md).

---

## Deliberate tradeoffs (won't fix without strong reason)

### No authentication

Termbook accepts any WebSocket connection on `:4001/ws` and gives it a
shell as the server user. There is no auth check.

**Rationale**: it's a localhost dev tool. Adding auth (token? OAuth?
basic auth?) is non-trivial and out of scope. If you want to expose
Termbook over a network, use a reverse proxy with auth in front (e.g.,
nginx with basic auth, or Tailscale's `serve` with identity).

**If you do nothing**: don't bind Termbook to a public IP. The default
binds to all interfaces, which is fine for `localhost` but dangerous on
e.g. a Codespaces port forward.

### Always `/bin/bash` regardless of user shell

We detect the user's `$SHELL` (logged as `[SHELL_DETECT]`) but always
spawn bash. Aliases are imported but functions, fancy prompts, and
shell-specific features aren't.

**Rationale**: see [decisions.md](decisions.md#shell).
Powerlevel10k and similar zsh prompt themes actively fight our marker
injection. Bash with a controlled rcfile is the only setup we found
reliable.

### PTY processes die on server restart (cells survive)

Restart the backend → the live PTYs themselves are gone (their child
processes can't be re-attached). But session metadata and finished
cells **are persisted to `termbook.db` (SQLite)** and reload
automatically on next page load. The user sees their history; a
fresh PTY is spawned lazily when they next interact with the session.

**What's still lost on restart**: in-flight commands (anything that
was running when the backend went down), shell environment (env vars
set with `export`, things piped through `source`, etc.), and the
current working directory drift inside the lost PTY. The session's
`pwd` is restored from the DB (last finished cell's `pwd`).

**Rationale for not preserving more**: serializing a live PTY's state
is genuinely hard (scrollback, env vars, half-typed input,
subprocesses). For now, finished cells + last pwd is the right
trade-off. Use `scripts/restart_servers.sh` so restarts are rare.

DB lives at repo-root `termbook.db` (override with
`TERMBOOK_DB_PATH=`). Reset with `node backend/server.js --reset-db`
or just `rm termbook.db*`.

### No backend tests

The Jest setup in `backend/package.json` is unused. All testing is
end-to-end through Playwright.

**Rationale**: the backend's logic (PTY wrangling, OSC parsing) is
hard to unit-test in isolation — most bugs are about how it interacts
with real shells. E2E catches those; unit tests would be theater.

If you change `parser.js` and want quick feedback, the
`grep -E "FINISH|MARKER" ssr_debug.log` after a real session is faster
than writing a Jest test.

### No TypeScript

Plain JavaScript / JSX. The `typescript` devDep in `backend/package.json`
is unused.

**Rationale**: backend is ~450 lines, frontend is ~1300 lines. TS
overhead isn't worth the safety at this size. If the codebase doubles,
revisit.

### `xterm.js` DOM renderer, not WebGL

`App.jsx` doesn't pass `rendererType: 'webgl'` to xterm. We use the
default DOM renderer.

**Rationale**: WebGL is faster but browsers cap WebGL contexts at ~16.
Every notebook cell that's ever been "live" needs its own xterm
instance; with WebGL, opening 20 cells exhausted contexts and crashed
the GPU. DOM renderer is slightly slower but doesn't have the cap.

For typical use (echo/ls/cat) the difference is invisible. For real-
time TUIs (vim/top), there can be visible lag on very large terminals
(>200 cols × 60 rows). Acceptable trade.

---

## Bugs we know about but haven't fixed

### opencode-google looks tiny in modal

opencode's TUI centers itself in any terminal size. Our modal gives it
1800×1200 (max) but opencode draws its UI in a fixed-size box in the
middle, with empty padding around it.

**Not our bug**: it's opencode's UI design choice. If you want their UI
to fill the modal, take it up with the opencode-google project. We
give them all the room.

### Background jobs leak output into the next cell

```bash
ping 8.8.8.8 &      # cell A finishes, ping keeps running
ls                  # cell B — but ping's output bleeds in
```

The PTY is shared across cells. Backgrounded processes still own stdout.
There's no way to redirect their output to a "background" buffer because
bash has one stdout per process.

**Workarounds**: redirect explicitly (`ping 8.8.8.8 > /tmp/ping.log &`)
or accept the leak.

We could detect mid-cell output that doesn't follow a `start` and route
it elsewhere, but the implementation is gnarly and the use case is
edge-y.

### Long-running commands stream nothing for a few seconds

Output is buffered up to ~64KB before being flushed. For commands that
emit slowly (`while true; do echo foo; sleep 1; done`), this is fine.
For commands that emit a steady stream of small writes, the user sees
nothing for a while, then a burst.

**Cause**: node-pty's default buffering + our ~50ms throttle in the
`onData` handler.

**Not fixed because**: tightening the throttle generates more
WebSocket traffic per cell and the SIGWINCH-storm prevention work
became delicate. Not worth touching without a real complaint.

### SSH Path B: cosmetic prompt residue in remote cell snapshots

When Path B is active, each remote-issued cell's snapshot tail often
contains an extra line or two of the remote shell's prompt re-rendering
(e.g. p10k's right-side prompt drawing). The cell's exit code, pwd, and
git chip are all correct; this is purely visual noise at the bottom of
the snapshot.

**Cause**: `__tb_remote_prompt` runs as `precmd` / `PROMPT_COMMAND` BEFORE
the next prompt prints, but the remote shell typically also has its own
prompt-drawing logic that writes a line of output. We capture the snapshot
at the next salted finish marker, which includes any output the remote
shell wrote between the previous command and our marker.

**Not fixed because**: stripping prompt artifacts heuristically risks
chopping legitimate trailing output. Cosmetic; ignored for v1.

### SSH Path B: per-SSH salt is plaintext on the remote

The `sshSalt` is injected into the remote shell's environment as part of
PROMPT_COMMAND. Any process on the remote that can read the shell's
environment (e.g. `cat /proc/$$/environ` on Linux, or `ps eww` viewing
your own process env) can read the salt and forge cell-close markers.

**Threat model**: Termbook targets local / dev / self-owned hosts. If you
SSH into a truly untrusted shared host, use `ssh --no-termbook` to disable
the integration.

**Same model** as the local salt — also plaintext in `PROMPT_COMMAND` of
your local bash; any local process can read it. Documented for
completeness.

### SSH Path B: nested SSH only injects on the outermost

`ssh host1`, then on host1 `ssh host2` — only host1 gets the salted
integration. The inner ssh is treated as a normal remote command from
Termbook's POV. Inner commands run inside one wrap-cell with no
per-command boundaries.

**Could be fixed** by detecting `ssh` commands typed INSIDE an active
Path B session and re-running the inject machinery for the inner shell.
Punted for v1; not a common-enough workflow to justify the state-machine
complexity.

### SSH Path B: integration fails silently after 8 seconds

If the remote shell isn't bash or zsh, or has output suppression that
swallows our salted printf, the inject won't yield a salted marker.
`SSH_INJECT_TIMEOUT` fires and `sshState='failed'`. The session degrades
to the pre-feature behavior (one big cell, unsalted markers from remote
may close cells). No user-visible error.

**Should** surface this as a small UI indicator (e.g. "integration off"
chip with a tooltip explaining how to retry). Not done in v1.

---

## Recently resolved (kept here briefly for context)

### ✅ `cat` (no args) used to hang — now works

Used to be: `cat` blocked forever because there was no way to send
stdin to a running command from Termbook.

Resolved by passthrough mode (see [decisions.md#passthrough](decisions.md#passthrough)).
Type lines, press Ctrl+D, cat exits.

### ✅ gemini-cli used to exit immediately with "No input via stdin"

Used to be: gemini-cli detected `CI=true` (inherited from the shell
that launched the backend) and went into headless mode, then errored
because there was no piped input.

Resolved by stripping CI-detection env vars from the PTY spawn
(see [decisions.md#ci-strip](decisions.md#ci-strip)).

### ✅ "Inline TUI" cells used to have no way to interact

Used to be: gemini-cli, claude-cli, ink-based CLIs rendered inline in
the cell, but the chat input was disabled while the command ran. The
user could see the prompt but couldn't type into it.

Resolved by passthrough mode (see [decisions.md#passthrough](decisions.md#passthrough)).
Whenever a non-alt-screen command is running, the chat input forwards
every keystroke (including Enter, arrows, Ctrl+C/D, etc.) to the
running command's PTY.

### ✅ SSH used to be "leaky Path B" with wrong chip data

Used to be: `ssh user@host` worked thanks to remote shells emitting OSC
133;D markers (p10k, atuin) — but those markers were unsalted, so the
parser fell back to the "anyExitRegex" path. Each remote command became
a cell with LOCAL pwd / LOCAL git branch chips, even though the cell ran
remotely. Tab completion and ArrowUp history also used local state.
Worst of all: any remote command could spoof cell boundaries by emitting
its own `\033]133;D;0\007`.

Resolved by SSH Path B integration (see
[decisions.md#ssh-path-b](decisions.md#ssh-path-b)) — Termbook now
auto-injects a salted shell-integration into the remote shell, so each
remote command becomes a proper cell with REAL remote pwd / git / exit.
Unsalted markers are explicitly rejected while in an active SSH session.

---

## Repo hygiene issues (planned cleanup, not yet done)

These will get a dedicated cleanup commit when an agent has the
focus. Documented here so the next agent knows they're known.

### ~1800 audit PNGs and ~50 abandoned `.spec.js` files

The repo root and `frontend/tests/` contain a huge volume of leftover
debugging artifacts from the original SSR architecture rewrite.
Examples:

- `gemini_tui_frame_*.png` × dozens at repo root
- `gemini_tui_screencast*.webm` × several
- `audit_dir/`, `check_frames/`, `colfix_frames/`, `final_fixed_frames/`,
  `frames_audit/`, `offbyone_frames/`, `screenshots/`
- `frontend/tests/*.spec.{js,ts}` × ~50 files

None of these are referenced by current code or tests. They're
preserved because they're evidence of past debugging work and the user
hasn't asked to delete them. **An agent should NOT delete them without
explicit permission.**

### Old `docs/` files are stale

`docs/architecture_plan.md`, `docs/architecture_critique.md`,
`docs/refactor_plan.md`, `docs/progress_report.md`,
`docs/architecture_suggestions.md`, `docs/gemini_tui_analysis_report.md`
predate the current architecture. They describe planned/proposed
designs, some of which were implemented and most of which weren't.

The current docs of record are:
- [architecture.md](architecture.md)
- [decisions.md](decisions.md)
- [development.md](development.md)
- this file

Leave the old `*_plan.md` / `*_critique.md` / `*_report.md` / etc. in
place for now. They might be useful historical reference.

### `backend/server.js` is one big file

~450 lines, all in one file: session management, WS handling, PTY
spawning, parser invocation, GC, REST endpoints. Could be split into
`session.js`, `ws.js`, `pty.js`, etc.

**Not split because**: at 450 lines, the whole thing fits in one
mental model. Splitting introduces import bookkeeping without making
anything clearer. Revisit if it crosses ~1000 lines.

### No mobile layout

`@media (max-width: 768px)` rules exist in `index.css` and hide the
sidebar, but the layout hasn't been carefully tested on phones.
Touch interactions (especially the input textarea with iOS Safari's
keyboard) might be janky.

**Not fixed because**: nobody has reported using Termbook on mobile.
Termbook's value proposition isn't great on a 6" screen anyway.

---

## What would change priorities

If any of the following becomes a real ask, the corresponding "won't
fix" entry should be reconsidered:

- **Auth becomes needed** → token-in-URL is the easiest minimum.
- **User insists on their actual shell** → revisit the marker injection
  via a `LD_PRELOAD`-style approach, or wrap the shell in a tiny
  Rust/Go binary that always emits the marker.
- **Live PTY persistence (not just cell metadata)** → spawn shells
  under a session manager (tmux/screen) and reattach on restart. The
  current SQLite layer covers finished cells + last pwd, which has
  been sufficient.
