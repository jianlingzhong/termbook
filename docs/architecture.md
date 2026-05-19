# Architecture

How Termbook actually works today (post-`de72756`). This is descriptive,
not aspirational. If something in this document doesn't match the code,
the code is right and this doc is stale — fix the doc.

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
4. **PTY** runs `pwd`, emits `/Users/.../termbook\r\n` on stdout.
5. **Backend** (`ptyProcess.onData`) for every chunk:
   - Appends to `session.tailBuf`
   - Writes to `session.headlessTerminal` (shadow buffer)
   - Detects `\x1b[?1049h`/`l` (TUI enter/exit) and broadcasts `tui_enter`/`tui_exit`
   - Counts cursor-positioning escapes for inline-TUI detection
   - Calls `parseOutput(tailBuf, promptSalt)` looking for the prompt
     completion marker
6. **Shell prompt fires**, emitting:
   ```
   \x1b]133;D;0;<promptSalt>\x07\x1b]7;file://localhost/Users/.../termbook\x07
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

## TUI mode

A TUI is detected when the PTY output contains `\x1b[?1049h` (enter
alt-screen). When this happens:

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

- No backend tests (the `backend/package.json` has Jest configured but no
  actual test files). All testing is end-to-end via Playwright.
- No backend logging beyond `ssr_debug.log` and stdout.
- No queue/db/caching infrastructure.
- No authentication. Anyone who reaches `:4001` gets a shell.
- No TypeScript. Backend is plain CommonJS, frontend is JSX.
- No build step for the backend. `node server.js` and you're running.
