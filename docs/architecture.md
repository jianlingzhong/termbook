# Architecture

How Termbook actually works today. This is descriptive, not aspirational.
If something in this document doesn't match the code, the code is right
and this doc is stale — fix the doc.

## Two processes, one WebSocket

```
┌─────────────────────┐         WebSocket           ┌──────────────────────┐
│  Frontend (Vite)    │ ◄──────── /ws ────────────► │  Backend (Node)      │
│  :4000              │                              │  :4001               │
│  React + xterm.js   │       HTTP /api/sessions    │  Express + ws        │
│                     │ ────────────────────────►   │  node-pty            │
└─────────────────────┘                              └──────────┬───────────┘
                                                                │ stdin/stdout
                                                                ▼
                                                       ┌─────────────────┐
                                                       │  PTY: /bin/bash │
                                                       │  (per session)  │
                                                       └─────────────────┘
```

That's the whole topology. No queue, no database, no extra services.

## Key data: a "session"

A session is a long-lived bash PTY plus metadata. Sessions outlive
WebSocket connections (the "tmux model") — closing your browser tab does
not kill the shell.

Lives in `backend/server.js`:

```js
session = {
  id,                       // sess-<timestamp>-<rand>
  ptyProcess,               // node-pty handle
  activeCellId,             // command currently running (or null between)
  isPtyReady,               // true after first prompt marker seen
  tailBuf, sentPos,         // ring buffer of PTY output, position last forwarded
  clients: Set<WebSocket>,  // connected viewers (can be many)
  cells: [],                // notebook cells (one per command)
  pwd,                      // tracked from OSC 7
  rcPath,                   // path to per-session bashrc temp file
  isTuiActive,              // \x1b[?1049h flipped this on
  pendingQueue: [],         // commands waiting for the active one
  headlessTerminal,         // @xterm/headless — the shadow buffer
  serializeAddon,           // serialize headless state to ANSI
  promptSalt,               // UUID injected into PS1, validates 133;D markers
  createdAt, lastActivity,  // for idle GC
}
```

## A command's lifecycle

This is the most important sequence in the system. Knowing it makes the
code obvious.

1. **User types** `pwd` and presses Enter in the React `<textarea>`.
2. **Frontend** (`App.jsx:handleCommand`) creates a `cell` object locally
   with a fresh `cell-<timestamp>` id, sets `isRunning=true`, calls
   `setSessionRunning(...)`, then sends WebSocket:
   ```json
   { "type": "start", "cellId": "cell-1779...", "data": "pwd" }
   ```
3. **Backend** (`server.js` `start` handler):
   - If `session.activeCellId` is already set, the command is pushed onto
     `pendingQueue` (fast-typer race protection).
   - Otherwise calls `startCommand(session, cellId, "pwd")` which:
     - Records `session.activeCellId = cellId`
     - Appends a cell to `session.cells`
     - Broadcasts `new_cell` to all clients (so other tabs see it too)
     - Writes `pwd\r\n` to the PTY
     - Logs `[COMMAND_START]`
4. **PTY** runs `pwd`, emits `/path/to/cwd\r\n` on stdout.
5. **Backend** (`ptyProcess.onData`) for every chunk:
   - Appends to `session.tailBuf`
   - Writes to `session.headlessTerminal` (shadow buffer)
   - Detects `\x1b[?1049h`/`l` (TUI enter/exit) and broadcasts `tui_enter`/`tui_exit`
   - Accumulates an `_ansiScore` (cursor moves, clear ops, hide-cursor)
     which only affects snapshot rendering at cell close (high score →
     "Interactive session ended" placeholder instead of the messy
     redrawn-in-place snapshot)
   - Calls `parseOutput(tailBuf, promptSalt)` looking for the prompt
     completion marker
6. **Shell prompt fires**, emitting:
   ```
   \x1b]133;D;0;<promptSalt>\x07\x1b]7;file://localhost/path/to/cwd\x07
   ```
   (set via `PROMPT_COMMAND` injected by our rcfile)
7. **Parser** returns `{exitCode, pwd, before, firstIndex, matchEnd}`.
8. **Backend**:
   - Sends `output` with the bytes BEFORE the marker (so client doesn't
     see the marker itself)
   - Sets `cell.isRunning = false`
   - Schedules `exitHandler` after 300ms (lets late output flush)
   - `exitHandler` serializes the headless buffer → `snapshotAnsi`,
     stores it on the cell, broadcasts `exit` with the snapshot, exit code,
     pwd, and `snapshotCols`/`snapshotRows`
   - Logs `[CELL_CLOSE]`
   - If `pendingQueue` is non-empty, starts the next command
9. **Frontend** receives `exit`:
   - Updates the cell to `isRunning=false`, stores `snapshotAnsi` etc.
   - `NotebookCell` swaps from live xterm rendering to snapshot HTML rendering
   - The cell's height transitions from "live size" to "hugged-to-content"

## Rendering: live vs snapshot

A cell goes through two visual states:

- **Live** (`isRunning=true`, no `snapshotAnsi` yet):
  - An xterm.js Terminal is mounted in the cell's `.live-terminal` div
  - Output streams to it via `terminal.write(data)`
  - Cell height is computed from `liveContentRows` (polled every 80ms from
    the xterm buffer's cursor position) so the cell hugs content as it grows
- **Snapshot** (`snapshotAnsi` present):
  - A throwaway xterm.js Terminal is created with `cols/rows` from the
    backend, the snapshot ANSI is written to it, then `serializeAsHTML()`
    produces a static HTML string
  - The HTML is injected via `dangerouslySetInnerHTML` into `.snapshot-output`
  - The live xterm terminal is disposed (WebGL context recovery)
  - `trimSnapshotRows` strips leading/trailing empty rows
  - For TUI commands (used alt-screen OR many cursor escapes), the snapshot
    is replaced with a small "Interactive session ended" placeholder
    because the post-TUI screen state is usually garbage

## TUI mode (alt-screen)

A TUI is detected when the PTY output contains `\x1b[?1049h` (enter
alt-screen). vim, top, htop, less, etc. all do this. When detected:

1. Backend sets `session.isTuiActive = true`, marks `cell.usedTui = true`,
   broadcasts `tui_enter` with `cellId`.
2. Frontend lifts the cell's xterm.js Terminal element out of the cell
   and into a full-screen `TuiModal`. The same xterm instance is reused
   so no state is lost.
3. `TuiModal` calls `fitAddon.fit()` (not just `proposeDimensions()`) on
   resize, which actually resizes the local xterm AND emits `requestResize`
   to grow the PTY to match the modal.
4. Keystrokes in the modal are forwarded to the PTY via `input` messages.
5. When PTY emits `\x1b[?1049l` (exit alt-screen), backend broadcasts
   `tui_exit`, cell goes back into the notebook, then (typically) the
   shell's prompt marker fires and the cell completes normally.

## Inline interactive commands (passthrough mode)

Many modern CLIs (gemini-cli, claude-cli, ink-based apps, plus simple
ones like `cat`, `read`, `python` REPL) are interactive but **do NOT** use
the alt-screen buffer. They render inline at the bottom of the terminal,
scrolling normally, and read keystrokes one at a time.

For those, we do NOT open the TUI modal. Instead the cell renders inline
as usual, and the chat input enters **passthrough mode**: every keystroke
is sent directly to the running command's PTY as a raw byte sequence.

Detection: there is none. **Whenever a command is running and the TUI
modal isn't open, the chat input is in passthrough mode** (`isPassthrough
= sessionRunning[id] && !activeTuiState`). No heuristics, no per-program
detection. This is what the user wants 100% of the time.

Key translations in `App.jsx` `handleCommand`:

```
printable char    → as-is
Enter             → '\r'
Backspace         → '\x7f'
Tab               → '\t'
Escape            → '\x1b'
ArrowUp/Down/L/R  → '\x1b[A' / '\x1b[B' / '\x1b[D' / '\x1b[C'
Ctrl+letter       → '\x01' .. '\x1a'
```

The chat input gets `.is-passthrough` class (cyan ring) and a
"Sending keystrokes to running command…" placeholder. When the cell
exits, `isPassthrough` flips back to false and the input returns to
normal command-entry mode.

Cmd+K, Ctrl+R, and Cmd+Shift+F still work in passthrough mode (they
bypass the keystroke forwarding).

This is also what makes `cat` (no args) usable: type lines, press Ctrl+D
to send EOF, cat exits cleanly.

## SSH integration ("Path B by default")

When the user runs `ssh user@host` (interactive, not single-shot, not
`--no-termbook`), Termbook lets SSH connect normally, then once the
remote prompt is visible, it injects a salted shell-integration snippet
into the remote shell. From that point each remote command becomes its
own Termbook cell — with REAL remote pwd, git branch, exit code,
host, etc.

Backend state machine (`backend/server.js`, SSH helpers ~line 297):

```
idle ──[ssh cmd submitted]──> pending
pending ──[remote prompt + 600ms idle]──> injecting
injecting ──[salted marker arrives]──> active
active ──[which='ssh' finish]──> next remote cell
active ──[which='local' finish]──> idle (ssh process exited)
```

The injected snippet (built by `backend/ssh.js:buildRemoteIntegration`)
installs `__tb_remote_prompt()` as the remote shell's PROMPT_COMMAND
(bash) and/or precmd_functions[] (zsh). The function emits OSC 133 / OSC
7 / OSC 1338 markers with a per-SSH salt. The parser is given
`[localSalt, sshSalt]`; the `which` field of the finish match tells the
server whether the close was for the local shell (outer ssh exiting) or
the remote shell (a remote command finishing).

While `sshActive`, the parser is invoked with `allowUnsalted: false` —
this is what makes Path B safe: a malicious or buggy remote command
emitting an unsalted `\033]133;D;0\007` cannot close cells.

Each remote-issued cell carries `remoteHost` so the frontend renders an
orange `🔌 user@host` chip in `cell-header-right`, distinct from the
cyan pwd-breadcrumb and purple git chip.

Opt-out per command: `ssh --no-termbook host` (or `--no-tb`) keeps the
cell in Path A mode (one big cell, full passthrough). Single-shot
`ssh host 'cmd'` is detected and never injected. Nested ssh: only the
outermost gets integration; inner is treated as a normal remote command.

If injection doesn't produce a salted marker within 8 s
(non-bash/zsh remote shell, output suppressed, etc.), `sshState='failed'`
and Termbook degrades to today's "leaky Path B" behavior automatically.

**Remote Tab completion**: chat input's Tab routes through the remote
shell via a salted PTY-RPC (the `__tb_complete` function installed by
the bootstrap). Backend's `/api/complete` checks `session.sshActive`
and either calls `requestRemoteCompletion` (RPC over the existing PTY,
600ms timeout, response markers stripped from the broadcast stream)
or falls back to the local completion module. Completion candidates
reach the user normally; the user is unaware whether the source was
local or remote.

**Control-key forwarding** when chat input is idle in Path B:
- Ctrl+D at empty input → `\x04` to remote PTY → remote bash EOFs → ssh
  exits → session ends (matches every-terminal-ever expectation).
- Ctrl+C with content → `\x03` to remote PTY + clear chat input locally
  (clears any partial line on remote's line editor too).
- Ctrl+L kept LOCAL (clear notebook history).

Frontend tracks `sessionSshActive[id]` driven by `session_init.sshActive`
on join and `'ssh_state'` WS messages on transitions.

Tested by `frontend/tests/e2e/08_ssh_session.spec.mjs` (16 tests
covering happy path, remote pwd/git/exit, vim TUI over SSH,
--no-termbook opt-out, nested ssh, the security regression for
unsalted-marker spoofing, remote Tab completion with cycling, Ctrl+C /
Ctrl+D forwarding, the local prompt prefix showing actual hostname,
and the input-prefix host badge + sidebar SSH indicator).

## Scroll behavior

Two interacting requirements:

1. **After submit**: the new cell's top edge should sit at the top of the
   viewport (matching Warp / Jupyter feel).
2. **On session switch**: by default the same — latest cell at top. BUT
   if the user had explicitly scrolled the source session before
   switching away, restore that scroll position on return.

Implementation in `App.jsx`:

- `sessionScrollMemoRef.current = { [sessionId]: { scrollTop, userScrolled } }`
- A scroll event is treated as "user-initiated" ONLY if a wheel /
  touchmove / scroll-related key (PageUp/Down, Home, End, Arrow when
  NOT in a text input) fired within the last 500ms. Generic scroll
  events (from layout shifts, cell renders, fit-addon resizes, session
  swap DOM churn) do NOT count — they constantly fire and would
  pollute the memo.
- Effect order matters: the `activeSessionId` useEffect is declared
  BEFORE the cells useEffect so React runs it first on session switch.
  It sets `pendingScrollRef.current = { kind: 'restoreMemo' | 'latestAtTop' }`
  AND resets `lastCellCountRef.current`. The cells useEffect then
  consumes the pending action across a few rAFs (cells may still be
  mounting when the first rAF fires).
- CSS `.notebook-content { overflow-anchor: none; }` — disables the
  browser's scroll-anchoring feature, which otherwise nudges scrollTop
  during layout shifts and fights our explicit restoration.

Use `queryLastCell(scrollContainer)` (in `App.jsx`) to find the last cell
— NOT `:last-of-type`. The notebook renders a sentinel `<div>` after the
cells (the 240px bottom padding that lets the latest cell scroll to the
top of the viewport) and `:last-of-type` is tag-based, so it picks the
sentinel.

The 19-test scroll behavior matrix is in
`frontend/tests/e2e/07_scroll_behavior.spec.mjs`. Add to it when you
touch any of: scroll memo, session switch, submit anchor, sentinel,
overflow-anchor.

## Prompt marker mechanics

This is the trickiest part. Termbook needs to know when a command finishes
so it can close the cell and capture the snapshot. We use **OSC 133;D**
(VT100 shell-integration sequence; iTerm/Warp use the same).

Mechanism:
1. On session create, backend generates `promptSalt = uuidv4()` and writes
   a per-session bashrc:
   ```bash
   export PS1=' '
   export PROMPT_COMMAND='printf "\033]133;D;%s;%s\007\033]7;file://localhost%s\007" "$?" "<salt>" "$PWD"'
   ```
2. Bash spawns with `--rcfile <our_file>`.
3. After every user command, bash runs PROMPT_COMMAND which emits the
   marker with the exit code and pwd.
4. `parser.js` regex-matches the salted marker, returns `{exitCode, pwd, ...}`.
5. Backend trims the marker from the visible output and closes the cell.

**Why the salt?** Without it, any user command that does
`echo -e "\x1b]133;D;0\x07"` would falsely close its own cell. The salt
makes the marker unguessable.

**Why we ALSO accept unsalted markers**: oh-my-zsh / powerlevel10k /
iterm2-shell-integration all emit OSC 133;D without our salt. Rejecting
unsalted markers means heavy zsh setups don't work. So `parser.js` first
tries the salted regex; if no match, falls back to any 133;D. This is a
small security tradeoff for compatibility. See `parser.js:6-15`.

**Why we accept both BEL (`\x07`) and ST (`\x1b\\`) as OSC terminators**:
the OSC spec allows both. powerlevel10k specifically uses ST. Without
this, the pwd-marker regex would consume the trailing 133;D marker as
"pwd content" and surface `]133;D;0` in the breadcrumb. See `parser.js:7`.

## User aliases & login shell

Termbook always spawns `/bin/bash` (not the user's `$SHELL`) because the
deterministic prompt control needed for OSC 133 markers is incompatible
with heavy prompt themes (powerlevel10k actively fights `precmd_functions`
overrides). But we DO want the user's aliases (`ll`, `gst`, etc.).

The compromise: on backend startup, `extractUserAliases()` parses
`~/.bashrc`, `~/.zshrc`, `~/.aliases`, `~/.bash_aliases`,
`~/.bash_profile`, `~/.profile` looking for lines matching
`^alias <name>=<value>`. Those lines are deduplicated by alias name and
appended verbatim to every session's bashrc. So `ll` works, but you don't
get your fancy prompt or shell-specific functions.

See `backend/server.js:32-65` (`extractUserAliases`) and `buildBashRc`.

## Width and resize

Three places need to agree on terminal dimensions; mismatched values
cause `ls` to format for the wrong width and look broken.

1. **Frontend on join**: `App.jsx` `ws.onopen` computes
   `Math.floor(cellPxWidth / 8.5) - 4` from the notebook-content's pixel
   width and sends it in `join_session`. This sizes the PTY before the
   first command runs.
2. **Frontend on resize**: each live `NotebookCell` runs a `ResizeObserver`
   that calls `fitAddon.fit()` and sends `requestResize` to the backend.
   Per-session dedupe in `App.jsx` `requestResizeFor` drops redundant
   identical dimensions to prevent the SIGWINCH storm.
3. **Backend `handleResize`**: takes the **minimum** cols/rows across all
   connected clients (multi-tab resize-war arbitration) and resizes both
   the PTY and the headless terminal.
4. **Backend on exit**: includes `snapshotCols`/`snapshotRows` in the exit
   message. The frontend's snapshot-rendering temp Terminal uses those
   instead of a hardcoded 120 so wide output isn't re-wrapped at 120 cols.

If any of these is wrong, the user sees stale formatting. See
[`docs/decisions.md#width`](decisions.md#width) for the full history.

## Process & file lifecycle

- **Backend spawn**: per session, `pty.spawn('/bin/bash', ['--rcfile', rcPath, '-i'], ...)`
- **rcfile**: written to `backend/termbook_bashrc_<sessionId>` at session create
- **Session destroy** (idle timeout, user delete, or process exit):
  - `ptyProcess.kill('SIGKILL')`
  - `headlessTerminal.dispose()`
  - `fs.unlinkSync(rcPath)`
  - WebSocket broadcast `session_destroyed`
- **Server SIGINT/SIGTERM**: `cleanupZombies()` iterates all sessions and
  destroys them; also runs on `process.on('exit')` as a backstop.

## Persistence

Sessions and finished cells are persisted to a SQLite database
(`termbook.db` at the repo root, override via `TERMBOOK_DB_PATH=`).
Schema in `backend/persistence.js`:

- `sessions(id, pwd, created_at, last_activity)`
- `cells(id, session_id, command, snapshot_ansi, snapshot_cols, snapshot_rows, exit_code, pwd, executable_pwd, used_tui, started_at, finished_at, position)`

On backend startup, all sessions and their cells are loaded into the
in-memory `sessions` Map, with `ptyProcess: null`. A new PTY is spawned
lazily on the first `join_session` for a hydrated session (see
`spawnPtyForSession()` in `server.js`). The PTY starts in the session's
last known `pwd` so the user lands where they left off.

Writes happen at:
- session create (`createSession()`)
- pwd change (in the cell-finish path of `attachPtyHandlers()`)
- cell create (`startCommand()`)
- cell close (`exitHandler` inside `attachPtyHandlers()`)
- session destroy (`destroySession()` cascades to `cells`)

**What's NOT persisted**: in-flight commands (their cells are marked
non-running on hydration), live PTY state (env vars set via `export`,
shell functions, subprocess state), and the raw command history (kept
in the frontend's localStorage instead, last 500).

Reset the DB by deleting `termbook.db*` or running
`node backend/server.js --reset-db`.

`GET /api/sessions` lists hydrated+live sessions for the sidebar.
`GET /api/sessions/:id` returns a single session with its cells (used on
page reload to hydrate). `DELETE /api/sessions/:id` destroys a session
in memory AND removes it from the DB.

## Tab completion

`backend/completion.js` exposes a stateless `complete(input, cwd, aliases)`
function that returns a list of candidates. The frontend calls
`GET /api/complete?input=...&sessionId=...` on Tab keypress.

Two modes, chosen by token position:

- **First token** (no whitespace yet typed): unioned set of bash
  builtins + user aliases + executables on `$PATH`, filtered by prefix.
  `$PATH` is scanned once and cached for 30s (`PATH_CACHE_MS`).

- **Later tokens** (or current token contains `/`): filesystem listing
  of `dirname(token)` inside the session's `pwd`, with `~`-expansion.
  Directories are sorted first and suffixed with `/`. Hidden files are
  shown only when the token starts with `.`.

The frontend (`App.jsx`) on Tab:

1. If we already have a multi-candidate state, advance to the next
   candidate (cycle).
2. Otherwise call `/api/complete`. If 1 candidate, accept (append space
   if it's a file). If many, replace input with the first and store the
   list in `completionState`; the next Tab cycles.
3. Any non-Tab keypress clears `completionState`.

The hint UI (`.completion-hint`) shows up to 8 candidates inline above
the input with the active one highlighted and "Tab to cycle" affordance.

## Environment awareness (git / venv / conda chips)

Each closed cell displays up to three small chips next to its pwd
breadcrumb: git branch (purple), Python venv (yellow), conda env (green).

- **Git branch**: `backend/env_detect.js` runs `git rev-parse --abbrev-ref HEAD`
  in the cell's `pwd`, with a 5s in-memory cache to avoid fork-bombing git.
  Detached-HEAD becomes `(<short-sha>)`. Synchronous + cheap.
- **venv / conda**: `VIRTUAL_ENV` and `CONDA_DEFAULT_ENV` live inside the
  PTY shell, invisible to the parent backend. We add a second OSC marker
  (`OSC 1338 ;TBENV; key=val;key=val BEL`) to `PROMPT_COMMAND`, emitted
  BEFORE the OSC 133;D finish marker. `parser.js` parses it and the
  `finishMatch.env` field carries `{ venv, conda }` into the cell.

Critical ordering note: the env marker MUST be emitted BEFORE the OSC
133;D finish marker. `parseOutput` slices the tailBuf immediately when
it sees 133;D, so an env marker arriving in a later chunk would be
discarded.

We also export `VIRTUAL_ENV_DISABLE_PROMPT=1` and `CONDA_CHANGEPS1=false`
in our bashrc so the activate scripts don't mutate PS1 (which would leak
`(venv) ` prefix into cell snapshots).

Schema (SQLite): cells table has `git_branch`, `virtual_env`, `conda_env`
columns (added via idempotent ALTER TABLE migration in
`backend/persistence.js`).

## Cmd+K action palette

VS Code-style fuzzy-searchable command palette. Pressing Cmd+K (or
Ctrl+K) opens a centered modal listing all in-app actions:

- Search command history
- Clear terminal output (Cmd+L)
- New session (Cmd+N hint)
- Re-run last command (shows the actual cmd inline)
- Delete current session
- Switch session (when there's more than one)
- Copy last cell output (to clipboard)
- Toggle full screen (Cmd+Shift+F)

Defined as a static array in `App.jsx`. Each action is
`{ id, label, hint, run }`. Fuzzy filtering uses `fuzzyScore()`:
exact match > startsWith > word-boundary > substring > char-by-char.

The overlay reuses the `.history-search-overlay` CSS for visual
consistency, with `.palette-modal` for label+hint two-column layout.

## Full-screen workspace mode (Cmd+Shift+F)

Cmd+Shift+F (or Ctrl+Shift+F, or the maximize icon next to "Clear
History") toggles full-screen mode: the sidebar and top header hide
(`.app-container.is-maximized`), giving the notebook the full viewport.
A floating exit-fullscreen button at top-right (subtle 0.35 opacity,
1.0 on hover) is the safety hatch.

Preference persists in `localStorage` as `termbook_maximized`.

The keyboard shortcut is bound ONLY at the window-level handler, not
also in the input's handleCommand. Binding both would call
`toggleMaximized()` twice (preventDefault doesn't stop propagation),
netting zero state change. Cmd+K survives the same dual-binding because
`setPaletteOpen(true)` is idempotent; toggle is not.

PTY width updates automatically: the per-cell `ResizeObserver` already
observes layout changes and re-emits a resize to the backend.

## Desktop notifications

When a command takes >5s (`NOTIFY_THRESHOLD_MS`) AND the user is not
looking at the Termbook tab, fire a native `Notification`:

- exit 0 → `Termbook: command finished` + the command string
- exit !0 → `Termbook: command failed (exit N)`

Detection: `document.visibilityState !== 'visible'` OR
`!document.hasFocus()`. Both required — if the tab is visible AND
focused, the user can already see the cell finish on screen.

Permission flow:
- `Notification.permission === 'granted'` → fire immediately
- `'default'` → request, then fire if user accepts
- `'denied'` → silently skip

`tag: 'termbook-cmd'` replaces stale notifications so multiple
finishing commands don't pile up.

## Ctrl+R fuzzy history search

Bash-style reverse-i-search. Pressing Ctrl+R (or Cmd+R) on the input
opens a centered modal overlay. The data source is the frontend
`history` state (last 500 commands, deduped by recency, kept in
`localStorage` under `termbook_history`).

Scoring (in `App.jsx` `fuzzyScore`): exact substring match wins
(higher score for earlier indexOf); otherwise each character of the
query must appear in order in the candidate, with adjacent-char hits
scoring bonus points. No external dependency.

The overlay supports:
- type to filter
- ↑/↓ to navigate
- Ctrl+R to go to the next match
- Enter to insert the selected command into the input (then close)
- Esc or outside-click to dismiss
- mouse hover to preview, click to select

CSS classes: `.history-search-overlay`, `.history-search-modal`,
`.history-search-row.active`.

## Telemetry

`debugLog()` in `server.js` appends to `ssr_debug.log` (in the project
root). It's tagged like `[CATEGORY] message`. Useful tags to grep for:

- `[SESSION_CREATE]`, `[SESSION_DESTROY]`
- `[WS_JOIN]`, `[WS_LEAVE]`
- `[COMMAND_START]`, `[CELL_CLOSE]`
- `[RESIZE]`
- `[FINISH]` (parser match)
- `[ALIASES]` (count imported at startup)
- `[SHELL_DETECT]` (user's default shell, informational)

The file is appended forever — never rotated. `: > ssr_debug.log` before
reproducing a bug, then read the tail.

## Why bash, not zsh?

`process.env.SHELL` is detected and logged for visibility, but Termbook
always launches `/bin/bash` for the PTY. This is a deliberate tradeoff
documented in [`docs/decisions.md`](decisions.md#shell). The short version:
elaborate zsh setups (powerlevel10k, p10k-instant-prompt, oh-my-zsh) own
the prompt rendering pipeline and aggressively reinstall their own
`precmd_functions`, which prevents our marker from firing reliably. Bash
with a custom rcfile is the only way we found to guarantee the marker
fires on every prompt.

The user pays a small cost (no zsh-specific functions) for big wins
(reliable cell completion, no spurious prompt leaks into cells).

## What's NOT here

- **No backend unit tests.** All testing is end-to-end via Playwright;
  see [testing.md](testing.md).
- **No backend logging** beyond `ssr_debug.log` and stdout.
- **No queue/caching infrastructure** beyond the SQLite persistence
  layer for sessions and cells.
- **No authentication.** Anyone who reaches `:4001` gets a shell. See
  [SECURITY.md](../SECURITY.md).
- **No TypeScript.** Backend is plain CommonJS, frontend is JSX.
- **No build step for the backend.** `node server.js` and it's
  running.
