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

### Sessions die on server restart

Restart the backend → all sessions and their PTYs are gone. The
sidebar will show them as missing on next page load.

**Rationale**: serializing a live PTY's state is genuinely hard
(scrollback, current working dir, environment variables, half-typed
input, subprocesses…). We don't try. Use mprocs or a stable
`scripts/restart_servers.sh` invocation so restarts are rare.

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

### "Command running…" forever for non-alt-screen TUIs

If you run `gemini-cli` (or anything that takes over the screen WITHOUT
using `\x1b[?1049h`), the cell stays in "running" state until you quit.
No way around this from the backend — there's no protocol signal that
says "I'm waiting for input vs. still computing".

**Workaround**: just type Ctrl+C / `/quit` when you're done. The cell
will close normally.

We do detect heavy cursor-positioning usage and mark the cell as
"inline TUI-like" so the snapshot after exit is a compact placeholder
instead of a messy half-redrawn snapshot. But the spinner during the
session can't go away without a protocol signal.

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

### `cat` (no args) hangs the cell forever

`cat` with no args reads from stdin. Termbook's UI has no way to send
stdin to a running command other than typing into the TUI modal — which
only opens on alt-screen TUIs, which `cat` doesn't trigger.

**Workaround**: Ctrl+D / Ctrl+C via the modal? No, the modal isn't
open. You'd have to delete the session.

**Real fix**: support a "send raw input to active cell" path even
without TUI mode. Not implemented; medium priority.

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
- **Persistence across server restart** → spawn shells under a session
  manager (tmux/screen) and reattach on restart.
