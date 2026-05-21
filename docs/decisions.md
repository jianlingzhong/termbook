# Decisions

Why the code is the way it is. Each entry describes a bug or design
question, the chosen solution, and the file/line where it lives. Read
this before changing anything in the named files — you'll otherwise
re-introduce a bug we already fixed.

Entries are ordered by topic, not chronology. For chronological order
see `git log --oneline`.

---

## Backend

### node-pty (not the old Python wrapper)

**Was**: `backend/pty_wrapper.py` (deleted) — spawned via
`child_process.spawn('python3', ...)` with a custom fd-3 JSON protocol
for resize.

**Why removed**: extra Python process per session, ~50–100ms startup
penalty, no SIGCHLD handling in the wrapper, `winsize` was hardcoded
24×80 regardless of client request, and the parent Node would crash
with `read EIO` on PTY shutdown.

**Now**: `pty.spawn('/bin/bash', ['--rcfile', rcPath, '-i'], {...})` via
`node-pty` (already a dep). `ptyProcess.onExit` and `onData` handle
lifecycle and stream. See `backend/server.js:178-200`.

**Trap**: `node-pty`'s prebuilt binary at
`node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper` may not be
marked executable after `npm install` on some setups. If `pty.spawn`
returns `posix_spawnp failed`, `chmod +x` it.

---

### User's default shell (informational, not used) {#shell}

**Decision**: Detect the user's shell via `$SHELL` → `dscl` (macOS) →
`getent passwd` (Linux), log it, but **always spawn `/bin/bash`** for
the PTY.

**Why not honor `$SHELL`**: zsh users almost universally run
oh-my-zsh / powerlevel10k / p10k-instant-prompt. These prompt frameworks
own the `precmd_functions` array and aggressively reinstall their own
hooks, overwriting our `__termbook_precmd`. Result: our OSC 133;D
marker never fires, every cell hangs in "running" forever.

We tried (in order): `precmd_functions=(__termbook_precmd)`,
`add-zsh-hook precmd __termbook_precmd`, removing the prompt theme
with `prompt off`. P10k re-wires itself each prompt cycle.

**The compromise**: spawn `/bin/bash` with a clean rcfile we fully
control, but **import the user's `alias` lines** from their rc files so
commands like `ll` work.

See `backend/server.js`:
- `detectUserShell()` ~line 67
- `extractUserAliases()` ~line 32 (parses `~/.bashrc`, `~/.zshrc`,
  `~/.aliases`, etc.)
- `buildBashRc()` ~line 100 (builds the per-session rcfile)

If a future change makes the marker robust under p10k, we can revisit
launching the user's actual shell.

---

### Salted prompt marker + conditional unsalted fallback {#salted-marker}

**Decision**: `PROMPT_COMMAND` emits `\033]133;D;<exitCode>;<promptSalt>\007`.
Parser accepts an array of salts (currently `[localSalt, sshSalt]` after
the SSH Path B feature landed). The `allowUnsalted` opt-in flag controls
whether bare `\033]133;D;<n>\007` markers also close cells.

**Today's policy** (`backend/server.js`):

| Context | `allowUnsalted` | What closes a cell |
|---|---|---|
| Normal local cell | `true` | localSalt, or unsalted (legacy) |
| Active SSH cell (Path B) | `false` | localSalt or sshSalt only — NO unsalted |
| Bootstrap (pre-`isPtyReady`) | `true` | Used just to learn initial pwd |

**Why salt**: without it, a malicious or careless command could spoof the
marker via stdout and prematurely close its own cell. E.g.
`echo -e "\x1b]133;D;0\x07"` would falsely terminate. This is the exact
shell-injection vector called out in
[`docs/architecture_critique.md:230`](architecture_critique.md).

**Why still allow unsalted in local mode**: many shell-integration setups
(iTerm2, oh-my-zsh, p10k, the `foot` plugin) emit OSC 133;D **without**
our salt. Termbook currently leans on this so per-command cell boundaries
work even before users explicitly do anything SSH-related. (Strict opt-in
to "salt only" everywhere is a future hardening.)

**Why forbidden during SSH**: see [#ssh-path-b](#ssh-path-b) below. A
remote shell with its own p10k integration would otherwise close the SSH
cell prematurely the moment it printed its first prompt.

See `backend/parser.js` (lines 27-43) and call sites at
`backend/server.js:483`.

---

### OSC terminators: BEL **and** ST

**Decision**: parser regexes accept both `\x07` (BEL) and `\x1b\\` (ST)
as OSC string terminators.

**Why**: powerlevel10k emits OSC 7 (`\e]7;file://...`) with ST, not BEL.
The pwd-capture regex was greedy-stopping at the first `\x07`, which
sometimes wasn't the actual end of the pwd marker — so it consumed
trailing bytes including the next `\e]133;D;0\e\` and surfaced
`]133;D;0` in the breadcrumb UI.

See `backend/parser.js:7-9`.

---

### Per-cell headless terminal reset

**Decision**: in `startCommand`, dispose any existing `headlessTerminal`
and create a fresh one. Don't reuse across cells.

**Why**: the headless terminal is the source of truth for the cell's
snapshot. If you reuse it, the previous cell's content bleeds into the
next snapshot. Originally we did reuse it to "save state across cells"
which was nonsense — each cell's snapshot should reflect only its own
output. See `backend/server.js:178-186`.

---

### Inline-TUI detection (the gemini fix)

**Decision**: while a cell is running, count cursor-positioning escape
sequences (`\e[H`, `\e[A/B/C/D`, `\e[J`, `\e[K`, `\e[?25l`). If the
total exceeds 40, mark `cell.inlineTuiLike = true`. On cell exit, treat
inline-TUI-like cells the same as alt-screen-buffer ones: send empty
`snapshotAnsi` and let the frontend show the "Interactive session
ended" placeholder.

**Why**: tools like `gemini-cli` don't use the alt-screen buffer
(`\e[?1049h`) but DO heavily repaint the screen in-place during their
interactive session. When they exit, the post-quit terminal state is a
messy mix of half-redrawn UI + goodbye text. Trying to render that as
a faithful snapshot looks broken (overlapping bars, mid-screen text,
fragments of the UI). The compact placeholder is just nicer.

See `backend/server.js:230-242`.

---

### Sessions are in-memory only

**Decision**: `sessions = new Map()` in process memory. No SQLite, no
JSON-on-disk, nothing. Sessions die when the server restarts.

**Why**: simplicity. Termbook is a localhost dev tool. If you want
persistence across restarts, that's a substantial feature (serialize
PTY state? Replay terminal output? Re-spawn dead processes?). Not worth
it for the use case.

What IS persisted: snapshots on completed cells, so reload works as
long as the server stays up.

See `backend/server.js:13` and `destroySession()` ~line 380.

---

### Idle session GC

**Decision**: every 5 minutes, sweep sessions; destroy any that have
zero connected clients AND no active cell AND haven't seen activity in
`TERMBOOK_IDLE_TIMEOUT_MS` (default 1 hour).

**Why**: without it, every browser tab you ever opened leaves a bash
process and a `termbook_bashrc_*` rcfile forever. Eventually you get
hundreds of orphan processes.

See `backend/server.js:399-410`.

---

### PTY stderr/stdio error handlers

**Decision**: every `pty.spawn()` result gets explicit
`.on('error', () => {})` handlers on stdout, stderr, and the (now-unused)
resize pipe.

**Why**: when the PTY child exits abruptly, node-pty propagates a
`read EIO` error event from the stream. With no handler, Node crashes
the entire backend with "unhandled 'error' event". One-line fix that
prevents the entire app dying.

See `backend/server.js:202-205`.

---

## Frontend

### `liveContentRows` for cell sizing

**Was**: cell-output had inline `style={{ height: '480px', minHeight: '480px' }}`
unconditionally when not yet rendered as a snapshot. Tiny commands like
`pwd` flashed a 480px black box for 200–300ms before snapping to a
50px snapshot. The user reported this as a flash.

**Why was it 480px**: the xterm.js Terminal element has its own natural
size (24 rows × 19px ≈ 456px). Whatever you put around it, it'll render
at that size. To make the cell hug content, we need to know how many
rows xterm has actually written to, and size the container to that.

**Now**: a `setInterval(updateContentRows, 80)` polls
`terminal.buffer.active.cursorY + baseY` to compute used rows, sets
`liveContentRows` state. The cell-output `style` computes height as
`max(1, liveContentRows) * 22 + 12` px capped at 80vh.

See `NotebookCell.jsx:144-158` (poll) and `NotebookCell.jsx:232-250`
(style).

**Don't**: hardcode `height: '480px'` back. There's a regression test
in `frontend/tests/visual/motion.spec.mjs` ("short command (pwd) does
not flash a 480px live box") that polls and asserts max height < 200px.

---

### Plain-HTML placeholder for snapshot loading

**Was**: when a cell hydrates from `snapshotAnsi`, the
ANSI→HTML rendering is async (xterm's `write(data, cb)` is callback-
based). Between mount and the callback firing, `renderedSnapshot` was
null, so the cell fell into the live-terminal branch and rendered an
empty 480px box for one frame. Visible as a flash on page reload.

**Now**: `ansiToPlainHtml(snapshotAnsi)` synchronously strips ANSI
escapes and produces a `<pre>` of plain text. `displaySnapshot =
renderedSnapshot ?? plainPlaceholder`. The cell renders the placeholder
immediately on mount, then seamlessly upgrades to the styled HTML when
ready. No flash.

See `NotebookCell.jsx:21-33` (helpers) and `NotebookCell.jsx:76` (memo).

---

### TUI modal must call `fitAddon.fit()`, not `proposeDimensions()`

**Was**: `TuiModal.jsx` computed dimensions via
`fitAddon.proposeDimensions()` and forwarded them to the backend with
`requestResize`. The PTY got resized correctly (vim/top knew the new
dimensions), but **the local xterm canvas stayed at its old 80×24
size**. Result: vim drew at 80×24 in the top-left of a huge modal,
leaving 75% black space.

**Why**: `proposeDimensions()` is read-only — it returns suggested dims
without applying them. `fitAddon.fit()` actually calls `terminal.resize()`.

**Now**: TuiModal calls `fitAddon.fit()` first, then reads
`terminal.cols`/`rows`, then sends to backend. Local xterm and PTY stay
in sync.

See `TuiModal.jsx:23-36`.

---

### Field name: `activeCellId` vs `cellId` on `tui_enter`

**Was**: backend `server.js` sent `{ type: 'tui_enter', cellId: ... }`.
Frontend read `msg.activeCellId`, which was always `undefined`. Result:
`activeTuiState.cellId = undefined`, `getOrCreateTerminal(sessionId,
undefined)` keyed a different terminal instance than the one receiving
output. The modal mounted but never showed any vim content — blank.

**Now**: frontend reads `msg.activeCellId ?? msg.cellId` for safety. We
also normalized `session_init` the same way.

See `App.jsx:299` (session_init) and `App.jsx:319` (tui_enter).

---

### Don't call `terminal.reset()` on `\x1b[2J`

**Was**: in the WS `output` handler, we previously did:
```js
if (msg.data.includes('\x1b[2J') || msg.data.includes('\x1b[3J')) {
    termData.terminal.clear();
    termData.terminal.reset();
}
```
This was defensive but **`reset()` exits the alt-screen buffer** on
xterm.js. Vim sends both `\x1b[?1049h` (enter alt) AND `\x1b[2J`
(clear screen) in its startup sequence. Our `reset()` undid the alt-
enter, so vim's drawing went to the normal buffer which wasn't visible.

**Now**: removed the reset entirely. xterm.js handles `\x1b[2J` correctly
by itself (clears the current buffer, doesn't switch buffers).

See `App.jsx:328-336`.

---

### Width — three places must agree {#width}

The fix that took the most iteration. There are **three** places that
each independently affect output width; any one being wrong wastes
horizontal space.

1. **PTY initial cols** — `App.jsx` `ws.onopen` computes:
   ```js
   const cellPxWidth = scrollRef.current.clientWidth - 96;
   const cols = Math.max(40, Math.min(500, Math.floor(cellPxWidth / 8.5) - 4));
   ws.send({ type: 'join_session', sessionId, cols, rows: 24 });
   ```
   **Before this**: hardcoded `cols: 120`. So at 2560px viewport, `ls`
   would format for 120 cols → 2 columns of files even though the cell
   could fit 5.

2. **Per-cell resize via fitAddon** — `NotebookCell.jsx` emitResize uses
   `fitAddon.fit()` (not `proposeDimensions`!) and forwards cols/rows to
   the backend. Multi-cell dedupe in `App.jsx` `requestResizeFor`
   prevents the SIGWINCH storm.

3. **Snapshot rendering cols** — `NotebookCell.jsx` snapshot renderer
   creates a temp Terminal with `cols: snapshotCols, rows: snapshotRows`
   from the backend's exit message (defaults 80×24 if missing). **Before
   this**: hardcoded 120×24. So when a 220-col snapshot was rendered to
   a 120-col temp xterm, output wrapped at 120 and looked broken.

**Plus** the CSS:
- `.notebook-content` has no `max-width` cap. Was capped at 1800px
  centered, wasting up to 663px/side on 3440px displays.
- `.chat-input-wrapper` has `width: calc(100% - 80px)`. Was capped at
  1600px.

See `App.jsx:308-313`, `NotebookCell.jsx:115-138`,
`NotebookCell.jsx:79-92`, `backend/server.js:299` (sends
snapshotCols/Rows), `frontend/src/index.css:26` and `:118`.

If a user reports `ls` showing too few columns: check all three layers.

---

### Width — safety margin and SerializeAddon font {#width-safety}

Even after the three-layer fix above, the rendered snapshot still
left empty space on the right on wide displays. Two compounding bugs:

1. **Over-aggressive safety margin in fitAddon.** `NotebookCell.jsx`
   emitResize was emitting `dims.cols - 4` to avoid a horizontal
   scrollbar. On a 1920px display that wasted 4 columns × ~9px ≈ 36px,
   PLUS prevented `ls` from picking a 3-column layout it would otherwise
   have chosen. Reduced to `dims.cols - 1`. 1 column is still enough
   slack to avoid sub-pixel rounding triggering a scrollbar.

2. **SerializeAddon bakes in `courier-new` 15px via inline styles.**
   The temp Terminal renders the snapshot HTML with inline
   `font-family: courier-new, courier, monospace; font-size: 15px`
   embedded in every row's outer `<div>`. Courier-new is wider than our
   CSS-declared `JetBrains Mono` 13px, and the inline style overrides
   the CSS. Result: a 145-col snapshot rendered to ~1450px instead of
   ~1250px... and then on a 1500px-wide cell, looked like wasted space
   to the right because the chars were oversized but the row count was
   fixed by the PTY cols.

   Fix: strip `font-family:` and `font-size:` from the SerializeAddon
   HTML during cleanup, so the snapshot inherits the parent's
   `JetBrains Mono` 13px.

**Don't**: bump the safety margin back up. There's a regression test
("PTY uses available horizontal space (ls fills width)") in
`regression.spec.mjs` that asserts a 1600-viewport `ls` snapshot has
rows ≥140 chars wide.

See `NotebookCell.jsx:123-138` (safety margin) and
`NotebookCell.jsx:95-104` (font stripping).

---

### Welcome state must not be pushed off-screen by the bottom-sentinel {#welcome-sentinel}

**Was**: a 240px bottom-sentinel `<div>` was rendered unconditionally
inside `.notebook-content` so the latest cell could always scroll to
viewport top. On an empty session (no cells), the centered welcome
block + sentinel together overflowed the viewport, and the page
auto-scrolled to the bottom — so the user saw only the "Try: [chips]"
footer of the welcome with the logo/title/tips off-screen above.

**Now**: render the sentinel **only when at least one cell exists**.
On empty sessions, the welcome state fills the natural flow without a
forced overflow.

See `App.jsx` `(sessionCells[activeSessionId] || []).length > 0 && <div ... />`.

---

### "Show all (N lines)" hint must sit above the input gradient {#overflow-hint-z}

**Was**: long cells were capped at `max-height: 80vh`. A "Show all
(N lines)" hint sat at the bottom of the cell-output-wrap. With cells
extending past the visible area, the hint frequently landed *inside*
the bottom region that the chat-input gradient covers (the input has
`z-index: 200` and a ~100px upward gradient), making the hint
invisible.

**Now**:
1. Cap reduced to `calc(80vh - 100px)` to leave room for the input.
2. Hint's `z-index: 250` to sit above the input gradient.
3. Tightened the input container padding (`16px 40px 24px`, was `40px`
   uniform) and steepened the top gradient stop to reduce intrusion.

See `NotebookCell.jsx` (display-snapshot maxHeight) and `index.css`
(`.cell-overflow-hint { z-index: 250 }`).

---

### Cell header should hug single-line content {#cell-header-hug}

**Was**: `.cell-header` had `min-height: 56px` + `padding: 16px 20px` +
`align-items: flex-start`. A one-line command like `pwd` produced ~89px
of header with ~50px of empty dark space below the text — looked like
a vertical gap before the output, which a user reported.

**Now**: `min-height` removed, padding reduced to `8px 20px`,
`align-items: center`. Single-line commands produce ~55px headers
(content height + 2×padding). Multi-line commands still grow naturally
via `height: auto` and scroll within `max-height: 200px`.

Regression test: "cell header hugs single-line command" asserts header
height < 64px for a single-line `pwd`.

See `frontend/src/index.css:41-56`.

---

### Auto-scroll new cells to viewport top

**Was**: when user submitted a command, the new cell's output rendered
at the **bottom** of the visible area. User had to scroll up to read
the cell header. Felt off — every chat/notebook UI puts the new content
at the top of the viewport.

**Now**: after submit, `App.jsx` `handleCommand` queues a
`requestAnimationFrame` that sets `scrollRef.current.scrollTop =
newCell.offsetTop - 16`. The cell's header lands at the viewport top.

To make this actually possible (the latest cell needs room ABOVE it to
sit at the top), the bottom of the scrollable area has `height: calc(100vh - 240px)`
of padding so the latest cell can always reach the top.

See `App.jsx:387-400` (scroll on submit) and `App.jsx:500` (padding).

---

### Focus management

**Was**: input lost focus after every command. User reported as their
top UX complaint.

**Why was it lost**: while a command runs, `<textarea disabled>` —
disabled elements cannot receive focus. When the cell finished and
`disabled` became false, there was no `focus()` call. The textarea
was un-disabled but un-focused.

**Now**: an `isInputUsable` effect calls `inputRef.current.focus()`
whenever the input transitions from unusable → usable (page load, cell
exit, session switch, new session, etc.). Plus a window keydown
listener: pressing any printable key when the input isn't focused
auto-focuses it. Plus Escape always focuses.

See `App.jsx:55-92` (focus effect + keydown listener).

---

### Resize storm prevention

**Was**: each cell's `ResizeObserver` fired on every layout micro-shift
(including the layout shift caused by the cell switching from live to
snapshot). Each fire sent a `resize` WebSocket message. A single
`pwd` could generate 5–10 resize events with identical dims.

**Now**: per-cell debounce (200ms) AND per-session dedupe (drop if
`lastCols === cols && lastRows === rows`). See `NotebookCell.jsx:135-138`
and `App.jsx` `requestResizeFor` ~line 209.

---

### Cell content does not bleed between cells

**Was**: `headlessTerminal` was created once per session and reused for
every command. Snapshots of cell N included leftover state from cell
N−1. Visible as text fragments from previous commands appearing at the
top of new snapshots.

**Now**: `startCommand` disposes the old headless terminal and creates
a fresh one (`backend/server.js:178-186`). Each cell's snapshot is its
own output only.

There's a regression test for this in `tests/visual/regression.spec.mjs`
("cells do not bleed").

---

### Trim trailing/leading empty rows in snapshot HTML

`xterm`'s `serializeAsHTML()` always produces a full `<div>` per row of
the buffer (e.g., 24 divs for a 24-row terminal), even if only the
first 2 rows have content. Without trimming, a `pwd` cell renders as
2 rows of content + 22 empty rows, making the cell visibly oversized.

`trimSnapshotRows()` in `NotebookCell.jsx:25-47` walks the rows,
finds the first and last with non-whitespace content, and clips
everything outside that range.

---

### Sidebar session ID uniqueness

**Was**: `sess-` + `Date.now()` + `Math.floor(Math.random()*1000)`.
Under React StrictMode (double-mount in dev), two sessions would be
created in the same millisecond with potentially-colliding random
suffixes. Sidebar showed duplicate entries.

**Now**: `sess-` + `Date.now()` + `crypto.randomUUID().slice(0,8)`. Plus
a `bootstrappedRef` to prevent StrictMode from creating two sessions
in the first place.

See `App.jsx:185-198`.

---

### Empty state only shows for truly-empty sessions

**Was**: empty state check was `(sessionCells[activeSessionId] || []).length === 0`,
which was truthy for unloaded sessions. When you clicked into a session
in the sidebar, the welcome page flashed for a moment before the cells
loaded.

**Now**: `Array.isArray(sessionCells[activeSessionId]) &&
sessionCells[activeSessionId].length === 0`. Empty state only shows for
confirmed-empty sessions (the API set it to `[]`), not loading ones.

See `App.jsx:521`.

---

## Tests

### Why a separate Playwright config

`frontend/playwright.config.ts` exists (from the original project) and
targets `tests/**/*.spec.{js,ts}`. That directory has ~50 abandoned
audit scripts from earlier debugging that don't pass and shouldn't run.

`frontend/playwright.visual.config.js` targets `tests/visual/*.spec.mjs`
specifically. The `.mjs` extension keeps it cleanly separated from the
legacy `.js`/`.ts` specs.

See [`frontend/tests/visual/README.md`](../frontend/tests/visual/README.md).

---

### Motion tests must verify the test catches the bug

For any motion-spec test you add: temporarily revert the fix it's
testing for, run the test, **confirm it fails**, then restore the fix.
Otherwise you have a test that always passes regardless of correctness.

The author of this codebase has been bitten by this. The `pwd does not
flash` test was developed by:
1. Writing the test.
2. Running it (passed — suspicious).
3. Reverting the live-cell-hug fix.
4. Running it (failed — good, the test actually catches the bug).
5. Restoring the fix.
6. Running it (passed — fix verified).

---

## Persistence

### SQLite, not in-memory only {#persistence}

**Was**: sessions and cells lived in a JS `Map<sessionId, session>`,
in-memory only. Backend restart wiped every cell.

**Now**: `backend/persistence.js` (better-sqlite3) persists sessions +
finished cells to `termbook.db` at the repo root.

Schema:
```
sessions(id, pwd, created_at, last_activity)
cells(id, session_id, command, snapshot_ansi, snapshot_cols,
      snapshot_rows, exit_code, pwd, executable_pwd, used_tui,
      started_at, finished_at, position, git_branch, virtual_env,
      conda_env)
```

Lifecycle:
- **Startup**: load all sessions + cells into in-memory Map with
  `ptyProcess: null`.
- **join_session for hydrated session**: lazily spawn a fresh PTY in
  the session's last-known `pwd`.
- **cell create**: upsertCell at position.
- **cell close**: upsertCell with snapshot + exit code + finished_at +
  env fields.
- **pwd change**: upsertSession with new pwd.
- **session destroy**: cascades to cells.

What's NOT persisted: in-flight commands (cells marked non-running on
hydration), live PTY env vars / shell functions / subprocess state.

DB path overridable via `TERMBOOK_DB_PATH=`. Reset with
`node backend/server.js --reset-db` or `rm termbook.db*`.

Migration: new columns are added via idempotent `ALTER TABLE ... ADD
COLUMN` in `openDb()` after a `PRAGMA table_info` check. No external
migration tool.

See `backend/persistence.js`, `backend/server.js` `spawnPtyForSession`
and `attachPtyHandlers`.

---

## Tab completion

### Heuristic-free completion {#completion}

**Decision**: `backend/completion.js` exposes a stateless `complete(input, cwd, aliases)`
function. The frontend calls `GET /api/complete?input=...&sessionId=...`
on Tab keypress.

Two modes, chosen by token position:
- **First token**: union of bash builtins + user aliases + executables
  on `$PATH` (cached 30s).
- **Later tokens**: filesystem listing of `dirname(token)` in the
  session's `pwd`, with `~`-expansion. Dirs sorted first, suffixed `/`.
  Hidden files only when token starts with `.`.

On Tab: 1 candidate → accept (append space for files). N candidates →
replace input with first, store list in `completionState`; next Tab
cycles. Any non-Tab keypress clears the cycle state.

See `backend/completion.js`, `App.jsx` `handleCommand` Tab branch.

---

## Ctrl+R history search

### Frontend-only, simple fuzzy scoring {#history-search}

**Decision**: bash-style reverse-i-search modal. Data source is the
frontend `history` state (last 500 commands, deduped by recency, kept
in `localStorage` as `termbook_history`).

Scoring (`App.jsx` `fuzzyScore`):
- exact match → 10000
- startsWith(query) → 5000 - text.length
- word-boundary match → 2000 - indexOf
- substring match → 1000 - indexOf
- otherwise: each query char appears in order (with adjacent-char bonus)

The ordering matters — without word-boundary > substring, "history"
would pull "Clear history" (where "history" appears at index 6) over
"Search command history" (where it appears at index 15).

No external library. ~20 LOC.

---

## Cmd+K action palette

### Reuses history-search overlay; static action array {#palette}

**Decision**: Cmd+K opens a fuzzy-searchable list of in-app actions.
Reuses `.history-search-overlay` CSS for visual consistency, with
`.palette-modal` for label+hint two-column layout.

Actions are a static array of `{ id, label, hint, run }` defined in
`App.jsx`. Filtering uses the same `fuzzyScore()` from history search.

**Don't**: bind Cmd+K AND Cmd+Shift+F in BOTH the window-level keydown
listener AND the input's `handleCommand`. The events fire on both
(preventDefault doesn't stop propagation), so the handler runs twice.
For idempotent actions (setPaletteOpen(true), setHistorySearch({}))
this is harmless. For TOGGLES (toggleMaximized), the double-call cancels
itself out — net zero state change. Cmd+Shift+F is therefore bound ONLY
at the window level.

---

## Full-screen workspace mode

### Cmd+Shift+F toggles sidebar + header visibility {#fullscreen}

**Decision**: Cmd+Shift+F (or Ctrl+Shift+F, or the maximize icon in
the top header) toggles `.app-container.is-maximized`. The CSS rule
`.is-maximized .sidebar, .is-maximized .top-header { display: none }`
hides the chrome. A floating exit-fullscreen-floating button at
top-right (opacity 0.35 idle, 1.0 on hover) is the safety hatch.

Why Cmd+Shift+F (not Cmd+F): Cmd+F is browser find. Cmd+Ctrl+F is
macOS browser fullscreen. Cmd+Shift+F is unused. Free real estate.

Preference persists as `localStorage.termbook_maximized = '1' | '0'`.

PTY width updates automatically: per-cell `ResizeObserver` re-emits
resize when the layout shifts.

See `App.jsx` `isMaximized` state and `toggleMaximized` + `.is-maximized`
CSS in `index.css`.

---

## Desktop notifications

### Long-running, unfocused-tab only {#notifications}

**Decision**: when a command takes >5s (`NOTIFY_THRESHOLD_MS`) AND the
tab is not focused, fire a `new Notification(...)`. The threshold +
focus check together ensure we only notify when the user actually needs
the alert — short commands don't ping you, and if you're already
watching the cell finish, you don't need a desktop pop.

Permission flow: granted → fire; default → request, then fire if
accepted; denied → silently skip.

`tag: 'termbook-cmd'` replaces stale notifications so multiple finishing
commands don't pile up.

See `App.jsx` `maybeNotifyCommandFinished`.

---

## Environment awareness (git / venv / conda chips)

### OSC 1338 TBENV marker for shell-only env vars {#env-awareness}

**Was**: cells had no awareness of git branch, Python venv, or conda
env. Every modern terminal prompt shows these — Termbook felt blind.

**Now**: each finished cell shows up to three chips:
- Purple `⎇ main` — git branch (or `(<short-sha>)` for detached HEAD)
- Yellow `📦 myenv` — Python venv basename
- Green `myenv` — conda env name (skipped if `base`)

Git branch is detected backend-side via `git rev-parse --abbrev-ref HEAD`
in the cell's `pwd`, with a 5-second cache in `backend/env_detect.js`.
Cheap and synchronous.

Venv and conda env are different — they live inside the PTY shell, not
the parent process. We can't read them from `process.env`. To surface
them, we added a custom OSC marker to `PROMPT_COMMAND`:

```
\033]1338;TBENV;venv=myenv;conda=other\007
```

Critical ordering: this marker is emitted BEFORE the OSC 133;D finish
marker. `parseOutput` slices the tailBuf as soon as it sees 133;D, so
an env marker arriving in a later chunk would be discarded. Emit env
first, finish marker second.

**Don't**: use `$(basename "$VIRTUAL_ENV")` inside the single-quoted
PROMPT_COMMAND. Escaping `\"` inside the basename call inside the
single-quoted command produces trailing-quote artifacts on macOS bash 3.
Use bash parameter expansion `${VIRTUAL_ENV##*/}` instead.

Also: export `VIRTUAL_ENV_DISABLE_PROMPT=1` and `CONDA_CHANGEPS1=false`
so the activate scripts don't mutate PS1 and leak `(venv) ` prefix into
cell snapshots.

See `backend/server.js` `buildBashRc` (the env marker construction),
`backend/parser.js` (env regex), `backend/env_detect.js` (git detection),
`backend/persistence.js` (schema migration).

---

## Inline interactive commands

### Passthrough mode, no detection {#passthrough}

**Was**: I tried two wrong approaches:
1. Disable the chat input whenever a command was running. Users had no
   way to type into gemini-cli, cat, read, python REPL, etc.
2. Add heuristic detection ("count cursor moves; if >60, open the TUI
   modal"). The modal was the wrong container for inline TUIs — gemini
   deliberately doesn't use alt-screen, and putting it in a modal felt
   like vim taking over the screen.

**Now**: NO detection. **Whenever a command is running and the TUI
modal isn't open, the chat input enters passthrough mode** (`isPassthrough
= sessionRunning[id] && !activeTuiState`). Every keystroke is forwarded
to the running command's PTY as raw bytes:

```
printable char  → as-is
Enter           → '\r'
Backspace       → '\x7f'
Tab             → '\t'
Escape          → '\x1b'
ArrowUp/Down/L/R → '\x1b[A' / '\x1b[B' / '\x1b[D' / '\x1b[C'
Ctrl+letter     → '\x01' .. '\x1a'
```

Cmd+K, Ctrl+R, Cmd+Shift+F still work in passthrough (bypassed at the
top of `handleCommand`).

Visual: `.chat-input-wrapper.is-passthrough` (cyan ring), placeholder
`Sending keystrokes to running command…`.

**Don't** re-add an "inline TUI heuristic" that promotes inline-rendered
commands to a modal. Users were explicit about this — gemini, claude-cli,
ink-based CLIs should stay inline.

See `App.jsx` `handleCommand` passthrough branch (~line 490).

---

## Backend env stripping

### Strip CI=true and friends from PTY child env {#ci-strip}

**Symptom**: `gemini` (Google internal CLI) exited with `Exit 42` and
"No input provided via stdin" when run from Termbook.

**Cause**: gemini-cli (and many modern tools — Ink-based CLIs, chalk,
npm) check `process.env.CI` and switch to non-interactive "headless"
mode when it's set. If the user launched the backend from a shell that
had `CI=true` exported (a common dev workflow footgun), it propagated
all the way through to the PTY children.

**Fix**: `spawnPtyForSession` strips a known list of CI-detection vars
from the env it passes to `pty.spawn`:

```js
['CI', 'CONTINUOUS_INTEGRATION', 'GITHUB_ACTIONS', 'BUILDKITE',
 'RUN_ID', 'GITLAB_CI', 'JENKINS_URL', 'NO_COLOR']
```

Also identifies us as `TERM_PROGRAM=termbook` so apps can opt into
richer integrations.

See `backend/server.js` `spawnPtyForSession` env block.

---

## `\r` vs `\r\n` to the PTY

### `\r` only — TTY's ICRNL handles the rest {#crlf}

**Was**: `session.ptyProcess.write(commandData + '\r\n')`.

**Symptom**: `read X; echo $X` returned instantly with empty `$X`. `cat`
(no args) hung "forever" because Ctrl+D wasn't being respected... no,
actually `cat` hung because we sent `\r\n` after the command and an
extra `\n` was left in the input queue. The next program reading stdin
consumed it as an empty line.

**Now**: `session.ptyProcess.write(commandData + '\r')`. The TTY line
discipline (ICRNL on by default) maps `\r → \n` when bash needs to
execute. Sending `\r\n` leaves a stray `\n` in the queue.

This fix also resolved the documented "`cat` (no args) hangs forever"
known issue — it now works (type lines, Ctrl+D exits).

See `backend/server.js` `startCommand`.

---

## Scroll behavior

### Latest-cell-at-top on submit AND on session switch (with memo) {#scroll}

**Was**: session switch scrolled to `scrollHeight` (very bottom of the
notebook). Latest cell was pushed up off-screen. User had to scroll
manually to see what they last ran.

**Now**: unified contract:
1. After submit, latest cell sits at the top of the viewport.
2. On session switch, by default the same — latest at top.
3. EXCEPT: if the user had explicitly scrolled the source session
   before switching away, restore that scroll position on return.

Implementation in `App.jsx`:

- `sessionScrollMemoRef = { [sessionId]: { scrollTop, userScrolled } }`.
- A scroll event counts as user-initiated ONLY if a wheel / touchmove /
  scroll-key event (PageUp/Down, Home, End, Arrow when NOT in a text
  input) fired within the last 500ms. Generic scroll events (layout
  shifts, cell renders, fit-addon resizes, session swap DOM churn) do
  NOT count.
- Effect order matters: `useEffect(..., [activeSessionId])` is declared
  BEFORE `useEffect(..., [cells, activeSessionId])`. React runs effects
  in declaration order. The activeSessionId effect sets up
  `pendingScrollRef` and resets `lastCellCountRef` BEFORE the cells
  effect sees the new cells. Otherwise the cells effect's
  `if (cellCount > prevCount)` branch would misfire on session swap
  (prevCount was from the prior session) and trigger an unwanted
  submit-scroll-to-top.
- The cells effect consumes `pendingScrollRef` across up to 8 rAF
  retries (cells may not be fully mounted on the first frame).
- CSS `.notebook-content { overflow-anchor: none }` disables the
  browser's scroll-anchoring feature, which otherwise nudges scrollTop
  during layout shifts and fights our explicit restoration.

**Don't** use `querySelector('.notebook-cell:last-of-type')` — the
notebook renders a sentinel `<div>` after the cells (the 240px bottom
padding) and `:last-of-type` is tag-based, picking the sentinel.
Use `queryLastCell()` (querySelectorAll + index).

19 e2e tests cover this matrix in
`frontend/tests/e2e/07_scroll_behavior.spec.mjs`. If you change anything
about scroll behavior, run them and update them.

---

## SSH integration ("Path B by default")

### Auto-injected remote shell integration {#ssh-path-b}

**Decision**: when the user runs an interactive `ssh user@host`, Termbook
silently injects a salted shell-integration snippet into the remote shell
once its prompt is visible. From that point each remote command becomes
its own Termbook cell with the **real remote pwd, git branch, and exit
code** in the chips.

The injected snippet (built by `backend/ssh.js:buildRemoteIntegration`)
installs `__tb_remote_prompt()` as the remote shell's `PROMPT_COMMAND`
(bash) and/or `precmd_functions` (zsh). The function emits:

- `OSC 133;D;<exit>;<sshSalt>` — finish marker with remote exit code
- `OSC 7;file://<remote-host>/<pwd>` — remote pwd
- `OSC 1338;TBENV;branch=<>;venv=<>;conda=<>;host=<>` — env chips

The `sshSalt` is a per-SSH-session UUID, distinct from the local bash
salt. The parser is given `[localSalt, sshSalt]` and returns a `which`
field naming which salt matched — that's how the backend knows whether
a finish marker came from the LOCAL bash (outer ssh process exiting)
or the REMOTE bash (a remote command finished).

**State machine** (see `backend/server.js` SSH helpers section, ~line 297):

```
  idle ──[user submits `ssh host`]──> pending
  pending ──[remote prompt + 600ms idle]──> injecting
  injecting ──[salted marker arrives]──> active
  active ──[which='ssh' finish]──> next remote cell
  active ──[which='local' finish]──> idle (ssh process exited)
```

If injection doesn't yield a salted marker within 8 s, `sshState='failed'`
and Termbook degrades silently to the pre-feature behavior (one big SSH
cell with passthrough; cells may be unsalted-marker-driven from remote's
own integration).

**Per-invocation opt-out**: `ssh --no-termbook user@host` (or `--no-tb`)
skips injection entirely. Useful when injecting would break the workflow
(e.g. piping ssh stdin, restricted shells, or just preferring a vanilla
remote terminal).

**Single-shot ssh is left alone**: `ssh host 'echo hi'` has no interactive
remote shell to inject into. `parseSshCommand` flags this as
`isSingleShot=true` and Termbook treats the cell as any other one-shot.

**Nested ssh**: only the OUTERMOST ssh gets Path B integration. An inner
`ssh host2` from inside the outer remote shell runs as a normal remote
command from Termbook's POV. This keeps the implementation simple and
avoids fighting recursive shell-integration semantics.

**Security**: the per-SSH salt is plaintext inside the remote shell's
environment, so any process running on the remote with read access to
the running shell's PROMPT_COMMAND can in principle spoof markers — same
security model as the local salt. Acceptable for the use cases this app
targets (your own machines / dev hosts), but documented in
[`docs/known-issues.md`](known-issues.md).

**Tested by** `frontend/tests/e2e/08_ssh_session.spec.mjs` (10 tests
covering happy path, remote pwd/git/exit, vim TUI over SSH, --no-termbook
opt-out, single-shot pass-through, nested, and a regression test that
asserts unsalted markers from remote do NOT close Path B cells).

See:
- `backend/parser.js` — dual-salt parser with `which` field
- `backend/ssh.js` — command parser, integration builder, prompt detector
- `backend/server.js` — state machine + cell tagging (~lines 297-470)
- `frontend/src/NotebookCell.jsx` — orange SSH chip + session placeholder
- `frontend/src/index.css` — `.cell-env-chip-ssh` styling

**Don't** call `parseOutput` without explicitly passing the salt array —
the back-compat string form still works but loses the `which` field that
the SSH state machine depends on.

**Don't** re-introduce the implicit unsalted fallback during `sshActive`.
That defeats the salt's purpose and reopens the spoofing hole.

---

### Why Path B by default (not Path A) {#ssh-path-b-rationale}

**Was considered**: Path A (one SSH = one big cell with full passthrough,
no remote cells). Safe, simple, predictable. The earlier "leaky Path B"
(remote shells with their own OSC 133 markers accidentally driving cell
boundaries with WRONG chip data) was the worst of both worlds.

**Why Path B won**: each remote command being a proper cell with real
remote pwd / git / exit code is dramatically more useful in everyday
notebook workflows — you can copy commands, re-run them, see exit codes,
search history by remote command, etc. The injection is reliable enough
for bash/zsh (the vast majority of remote shells in practice). When it
fails, we degrade to Path A automatically — no worse than where we
started.

**Why per-cell, not per-host configuration**: simpler. `--no-termbook` on
the command line is one decision point, immediately visible in the
history. A global "blocklist of hosts" would be another piece of state
that diverges between users + machines.

---

### Remote Tab completion via PTY-RPC {#ssh-tab-completion}

**Decision**: When in an active Path B SSH session, the chat input's Tab
key routes through the REMOTE shell instead of local `/api/complete`.

**Why**: Local completion runs on the BACKEND's filesystem at
`session.pwd`. Even though `session.pwd` mirrors the remote pwd via OSC
7, the LOCAL filesystem rarely has the same paths as the remote — on
real remote hosts, Tab returns nothing useful. Loopback (127.0.0.1) hid
this in the e2e setup.

**How** (see `backend/ssh.js:buildRemoteIntegration` for the
`__tb_complete` function and `backend/server.js:requestRemoteCompletion`
for the client side):

1. The bootstrap snippet now defines a remote `__tb_complete <reqId>
   <prefix>` function. Uses shell-agnostic globbing (works in bash + zsh
   with `setopt no_nomatch`). Output is wrapped in salted
   `OSC 1339;TBCMP;<reqId>;<salt>;<count>` ... `TBCMPEND;<reqId>;<salt>`
   markers.
2. Backend's `/api/complete` checks `session.sshActive`. If active, it
   calls `requestRemoteCompletion(session, input)` which generates a
   per-request `reqId`, writes `\x15__tb_complete '<reqId>' '<prefix>'\r`
   to the PTY (the leading Ctrl+U clears any partial line on the remote
   line editor), and awaits the salted response with a 600ms timeout.
3. In `onData`, BEFORE appending to tailBuf, any complete TBCMP/TBCMPEND
   range is parsed out, candidates resolved to the matching Promise, and
   the entire marker range is **stripped** from the chunk so it never
   reaches headlessTerminal or the broadcast stream. Cross-chunk markers
   are handled by a 16 KB `completionLeftover` buffer.
4. Per-SSH salt prevents a remote process from spoofing fake completion
   responses (same threat model as the cell-close salt).

**Tested by** `frontend/tests/e2e/08_ssh_session.spec.mjs` test K (3-way
cycle + no marker leakage assertion).

**Don't** rely on the local /api/complete fallback when SSH is active —
that's what caused the original Tab-completion-broken-on-real-remote bug.

**Limitation**: only path-style completion (glob expansion). First-token
COMMAND completion (`gi<Tab>` → `git`) still falls through to local PATH.
Future work: have `__tb_complete` dispatch based on token position.

---

### Control-key forwarding from chat input in Path B {#ssh-ctrl-forwarding}

**Decision**: When `sessionSshActive[active] === true` AND not in
passthrough, the chat input forwards Ctrl+C / Ctrl+D to the remote PTY:

- **Ctrl+D at empty input** → `\x04` to PTY → remote bash EOFs → ssh
  exits → session cleanly closes. Matches every-terminal-ever muscle
  memory.
- **Ctrl+C with any input** → `\x03` to PTY (clears any partial line on
  the remote shell's line editor) AND clears the chat input locally.
- **Ctrl+L** → kept LOCAL (clear notebook history). Forwarding to remote
  would just trigger a prompt redraw with no useful change to the
  notebook display.

**Plumbing**:
- Backend's `session_init` includes `sshActive` (bool) so reconnecting
  clients sync immediately.
- New `ssh_state` WS message broadcast on the two transitions (active /
  inactive) so client state stays current without polling.

**Don't** add Ctrl+Z forwarding without implementing SIGTSTP-aware job
tracking on the remote side — bare `\x1a` would suspend the shell
without our state machine knowing.

See `frontend/src/App.jsx:handleCommand` (the new Ctrl-key branch after
the Tab handler) and tests L, M in `08_ssh_session.spec.mjs`.

---

### Trailing-prompt snapshot trim for remote cells {#ssh-snapshot-trim}

**Decision**: when `remoteHost` is set on a cell, the frontend
`trimSnapshotRows` helper strips trailing rows that are recognizably
prompt-only. Done on the frontend, not the backend.

**Why frontend**: the backend captures the snapshot ~300ms after the
salted finish marker (the cell-close timer), by which time p10k has
already redrawn the next prompt. Snapshotting EARLIER (synchronously at
finishMatch) means xterm.js's async write queue may not have processed
the just-written output bytes yet — we tried this and broke 6 visual
tests because cells came out empty. Defer the strip to the frontend
where the rendered HTML is in hand.

**Heuristic** (intentionally narrow, see `NotebookCell.jsx:trimSnapshotRows`):

A row is "prompt-like" only when **all three** hold:
1. `stripTrailingPrompt: true` was passed (only true when `remoteHost` is set).
2. The row contains a STRONG prompt signal — at least one of:
   - Powerline / Nerd-font glyph icon (Unicode private-use areas
     U+E000..F8FF or U+F0000..10FFFD)
   - `user@host` pattern (matches p10k right-side prompt)
   - A prompt character (`❯`, `$`, `#`, `%`)
3. After removing every known prompt fragment (user@host, prompt char,
   glyphs, lone `~`, whitespace), nothing meaningful remains.

The strong-signal requirement is what prevents false positives: a row
that's just `/tmp` (legitimate `pwd` output) doesn't match because it
has no strong signal. A row that's just `~` doesn't match either (no
signal). Only rows that visibly look like a prompt get stripped.

**Don't** strip generic "looks like a path" rows — they're often
legitimate command output (`pwd` printing `/tmp`, `find` printing
`/var/log/...`).

**Don't** use `String.trim()` to normalize whitespace — JS trim() does
NOT strip U+00A0 (NBSP), which `serializeAsHTML` emits for column-align
padding. Use the explicit `replace(/[\s\u00a0]+/g, ' ').replace(/^ +| +$/g, '')`.

Also in `backend/server.js startCommand`: when starting a new cell while
`inSshContext`, the inter-cell `tailBuf` (containing the remote shell's
between-prompts redraw) is DROPPED instead of written into the new
headlessTerminal. Without this, the LEADING prompt fragment leaked into
each remote cell.

See:
- `frontend/src/NotebookCell.jsx:trimSnapshotRows`
- `backend/server.js:startCommand` (the `if (!inSshContext)` branch
  around line 813)

---

### Always-visible SSH session indicators {#ssh-visibility}

**Decision**: when in an active Path B SSH session, ALWAYS show the
remote host in THREE places, all in the same orange:

1. **Top header**: orange `🖥 user@host` chip next to pwd breadcrumb.
2. **Sidebar**: small orange Server-icon + left border on the active
   session's entry (and any other sidebar entries that are in SSH).
3. **Input prompt prefix**: the generic cyan `termbook ❯` is REPLACED
   with orange `🖥 host ❯`, directly to the left of the typed text.
   The input wrapper border also tints orange.

**Why three**: the per-cell SSH chip is only visible when looking at
cell headers. The top-header chip and sidebar indicator are for
orientation when scanning the workspace. But the user's eyes are on
the INPUT BOX while typing — that's the most important place to show
"this command will be sent to REMOTE, not local". Top-of-screen
indicators don't catch the eye when you're mid-thought typing. The
input-prefix badge is the safety net against accidental "I thought I
was local".

**Implementation**:
- Backend `session_init` includes `sshActive` (bool) and `sshHost`
  (string|null).
- New WS message `ssh_state` broadcast on the two transitions
  (`SSH_INJECT_OK` → active=true, `SSH_END` → active=false).
- Frontend tracks `sessionSshActive[id]` and `sessionSshHosts[id]`.
- Top-header chip renders when both `sshActive && sshHost` for the
  active session.
- Sidebar li gets `className 'in-ssh'` + nested `.session-ssh-indicator`
  when that session is in SSH.
- Chat-input-wrapper gets `className 'is-ssh'` for the orange border
  tint; the prefix slot conditionally renders `.pwd-prompt-prefix-ssh`
  with Server icon + host + ❯.

**Color**: orange (matches the per-cell SSH chip), distinct from cyan
(pwd/git breadcrumb and the local prompt prefix) and purple (git chip).
The shared orange across all four placements creates a unified visual
language for "remote".

---

### First-token Tab completion via remote PATH {#ssh-tab-cmd}

**Decision**: the `__tb_complete` remote integration function dispatches
on token position. First token (no spaces in input) = completing a
COMMAND name → walk `$PATH` for executables + merge shell builtins,
aliases, functions. Later tokens = path glob in remote cwd.

**Why**: previously `__tb_complete` only globbed `${prefix}*` in cwd, so
`gi<Tab>` returned nothing because `gi*` doesn't match files in the
current directory. Real terminals always do command completion as the
first token.

**Shell-agnostic mechanism** (see `backend/ssh.js:buildRemoteIntegration`):

For 'cmd' kind:
- Walk colon-separated `$PATH` with a `for ... in` loop and globbing —
  works in bash + zsh without depending on bash-only `compgen`.
- For each entry, check `-x` (executable, not a directory).
- Dedup via a simple `|name|` lookup pattern in a single `__tbc_seen`
  string (avoids associative arrays which behave differently across
  shells).
- Merge in builtins/aliases/functions via:
  - bash: `compgen -bafk -- "$prefix"`
  - zsh: `print -l ${(k)builtins} ${(k)aliases} ${(k)functions} | grep "^$prefix"`

For 'path' kind: unchanged — glob `${prefix}*` in cwd.

The frontend doesn't need any special code path; backend returns
candidates in the same shape as local completion (with `type: 'exec'`
vs `'file'` for diagnostic purposes).

**Don't** add Tab cycling state on the backend — it lives in the
frontend (`completionState` in `App.jsx`) and is shared between local
and remote completion. The backend just returns the candidates.
