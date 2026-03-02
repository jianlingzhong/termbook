# Termbook Architecture: The Hybrid SSR Terminal Model

## 1. Executive Summary
Termbook is migrating from a frontend-driven terminal layout architecture to a Server-Side Rendered (SSR) "Tmux Model". Currently, `xterm.js` on the frontend parses raw ANSI sequences and calculates its own bounds, fighting with the backend PTY over resize events. This creates layout instability (double-wrapping, massive scrollback duplication) when interacting with complex TUIs like the `gemini` CLI or `vim`.

**The Solution:** Move the canonical terminal state to the backend using `xterm-headless`. The backend acts as the absolute authority on the 2D grid dimensions and contents. The frontend `xterm.js` acts solely as a "dumb" WebGL display canvas, receiving pre-calculated grid snapshots and rendering deltas. 

## 2. Core Benefits
1. **Perfect State Hydration**: Reconnecting, refreshing the browser, or joining from a new device instantly loads the exact canonical screen state from the server.
2. **Layout Stability**: Layout bugs (double-wraps, phantom lines) disappear because the frontend no longer unilaterally calculates line wraps or dictates grid boundaries.
3. **Absolute Memory Cleanup**: Memory leaks are isolated and destroyed because the backend generates static snapshots and garbage-collects the renderer per-command.

---


## 2. Context: The Flaws of the Current Architecture

To understand why this architectural shift is necessary, an engineer must understand the deep systemic flaws in the current "frontend-driven" approach.

### Flaw A: The "SIGWINCH Storm" (Infinite Resize Loop)
- **The Symptom:** When a user runs a complex CLI app like `gemini`, the layout flickers wildly, and the terminal output duplicates itself hundreds of times down the page, crashing the browser.
- **The Root Cause:** A devastating feedback loop between the frontend DOM, `xterm.js`, and the backend PTY.
  1. The backend PTY sends text to the frontend.
  2. The frontend `xterm.js` receives the text and tries to render it.
  3. The frontend `ResizeObserver` detects that the DOM container changed shape (e.g., a scrollbar appeared or a line wrapped).
  4. The frontend blindly calls `fitAddon.fit()`, which recalculates the terminal's columns and rows.
  5. The frontend sends these new `cols` and `rows` back to the backend.
  6. The backend sends a `SIGWINCH` (Signal Window Change) to the PTY process.
  7. The CLI app inside the PTY receives the `SIGWINCH` and explicitly *redraws its entire UI* to fit the new size.
  8. This redraw emits more text... which triggers step 2 again. An infinite loop of layout destruction.
- **The Fix:** In the new architecture, the frontend *cannot* initiate a resize based on text flow. The loop is physically severed. The backend dictates the size.

### Flaw B: The Double-Scroll / Line-Wrap Glitch
- **The Symptom:** A TUI app (like a chatbot or progress bar) leaves a permanent "ghost" trail of duplicated lines behind it every time it updates.
- **The Root Cause:** TUI apps often pad their bottom status bars with spaces to exactly match the terminal width (e.g., exactly 120 characters wide). When they finish padding, they send `\r\n` (Carriage Return + Newline).
  - In a native terminal, hitting the exact right margin triggers a "pending wrap" state. The subsequent `\n` simply drops the cursor down one line.
  - In our frontend-driven `xterm.js` setup, because the frontend and backend dimensions were slightly desynchronized by CSS DOM padding, `xterm.js` processed the wrap *and* the newline as two separate vertical movements.
  - The screen advanced by *two* lines instead of one. When the CLI app later sent `ESC[11A` (Move Up 11 Lines) to erase its old UI and redraw, it fell short by 1 line! The top line of the old UI was left permanently stamped on the screen.
- **The Fix:** The backend PTY dictates strict dimensions and enforces a bounding-box safety margin (locking the PTY to `xterm.cols - 1`). The CLI pads to 119 chars, never hits the right margin to trigger the "pending wrap" state, and entirely bypasses the double-scroll bug.

### Flaw C: The Scrollback Leak & Cell Growth Bug
- **The Symptom:** TUI apps that are supposed to stay in one place (like `top` or the `gemini` chat interface) slowly push the terminal history down, generating massive scrollbars and eventually crashing the browser tab.
- **The Root Cause:** Most standard TUIs (like `vim`) use the Alternate Screen Buffer (`\x1b[?1049h`), which `xterm.js` handles nicely. However, some CLIs (like `gemini`) simulate a TUI in the *normal* buffer by using ANSI clear screen (`\x1b[2J`) and cursor home (`\x1b[H`) commands. When our frontend `xterm.js` processes a clear command, it shunts the "cleared" text into its hidden scrollback history. Over a long session, the notebook cell grows infinitely tall.
- **The Fix:** Under the new architecture, the **backend parser** detects TUI takeover sequences (`\x1b[2J`) and emits a `{ type: 'lock_viewport' }` control message. The frontend immediately responds by setting `xterm.options.scrollback = 0` and calling `.clear()`. The cell is physically barred from growing.

### Flaw M: The Multiline Paste Breakage
- **The Symptom:** If a user copies a 3-line bash script (or a multi-line curl command) and pastes it into the Termbook input bar, it executes as a single, broken string.
- **The Root Cause:** The frontend uses an `<input type="text">` element for the command bar. The HTML spec mandates that standard text inputs strip all `\n` characters on paste.
- **The Fix:** Replace the input element with an auto-expanding `<textarea>` that preserves newlines, executing on `Enter` and allowing `Shift+Enter` for manual multiline formatting.

### Flaw N: Infinite DOM Bloat from Historical Cells
- **The Symptom:** After a long 5-hour session of running hundreds of commands, the browser tab becomes incredibly laggy and unresponsive to scrolling.
- **The Root Cause:** While the WebGL context leak was fixed, the React `sessionCells` array continues to grow infinitely. 2,000 historical cells containing massive HTML snapshots will exceed the browser's safe DOM node limits, causing layout thrashing.
- **The Fix:** The frontend must monitor the `sessionCells` array. If it exceeds a threshold (e.g., 500 cells), the UI displays a warning: *"High Memory Usage: X cells loaded. [Clear Oldest Cells]"*, giving the user explicit control over their DOM memory rather than silently destroying their scrollback history.

### Flaw D: The Notebook "Hugging" Paradox vs. Fixed Terminal Grids
- **The Symptom:** Notebook cells are 1D objects that grow vertically to hug their content (e.g., `ls` outputs 3 lines, the cell is 3 lines tall). Terminals are strict 2D boxes (e.g., 120x24). If we blindly enforce a 120x24 backend grid for every cell, a simple `echo hello` command will spawn a giant 24-row black box taking up half the screen.
- **The Fix (The High-Water Mark Logic):** We maintain the backend PTY authority on dimensions (e.g., locking it to 120 columns), but allow the frontend container to dynamically *grow* vertically up to a maximum height (e.g., 24 rows) based on content. The backend PTY size is locked to 120x24, but the frontend React component sets its CSS height dynamically based on `Math.min(xterm.buffer.active.cursorY, MAX_ROWS)`. This achieves the "hugging" notebook feel without triggering `ResizeObserver` loops.

### Flaw E: The "Fast Typer" Concurrency Bug
- **The Symptom:** If a user runs a slow command (like `sleep 10`) and immediately types a second command into the input box before the first one finishes, the frontend sends a `start` payload. In the current architecture, the backend instantly overwrites the `activeCellId` pointer. The PTY output for *both* commands bleeds into the second cell, and the first cell gets "orphaned" in an infinite loading state.
- **The Fix (Command Queuing):** The backend must implement a `pendingQueue` for the PTY session. If a `start` message arrives while a command is actively running (`activeCellId !== null`), the backend pushes it to the queue. When the active command hits the `133;D;` completion marker, the backend closes the cell, pops the next command from the queue, initializes the new cell's `xterm-headless` renderer, and writes the command to the PTY.
### Flaw 4: The Notebook "Hugging" Paradox vs. Fixed Terminal Grids
- **The Problem:** Notebook cells are 1D objects that grow vertically to hug their content (e.g., `ls` outputs 3 lines, the cell is 3 lines tall). Terminals are strict 2D boxes (e.g., 120x24). If we blindly enforce a 120x24 backend grid for every cell, a simple `echo hello` command will spawn a giant 24-row black box taking up half the screen.
- **The Solution (The High-Water Mark Logic):** We maintain the backend PTY authority on dimensions (e.g., locking it to 120 columns), but allow the frontend container to dynamically *grow* vertically up to a maximum height (e.g., 24 rows) based on content. The backend PTY size is locked to 120x24, but the frontend React component sets its CSS height dynamically based on `xterm.buffer.active.cursorY`. This achieves the "hugging" notebook feel without triggering `ResizeObserver` loops, because the frontend DOM size changes no longer aggressively dictate the backend PTY size.

## 3. Detailed Architecture Mechanics

### 1. The PTY and Process Lifecycle
- **Persistent Shell State:** There is ONE long-running `ptyProcess` (e.g., `bash` or `zsh`) per Termbook session. If a user types `export FOO=bar` in one cell, it persists in the shell for the next cell.
- **Replacing `pty_wrapper.py`:** We are removing the legacy Python wrapper. The backend will use `node-pty` (already installed in `backend/package.json`). `node-pty` is a native C++ module that directly interfaces with OS pseudoterminal APIs, providing better performance and allowing us to use native JS `ptyProcess.resize()` instead of JSON IPC.

### 2. Frontend as a "Raw Proxy" (The Shadow Buffer Model)
To achieve the "Tmux Model" without destroying WebGL performance or building an impossible real-time JSON delta engine, we adopt the **Shadow Buffer** architecture:

1. **The Fast Frontend:** The frontend keeps `xterm.js`. The backend PTY streams raw ANSI `stdout` over the WebSocket. The frontend `xterm.js` natively processes this for zero-latency, 60fps typing.
2. **The Shadow Backend:** Simultaneously, the backend pipes the exact same PTY output into its own `xterm-headless` instance. This acts as a parallel verifier and memory bank.
3. **State Hydration:** When a user refreshes the page, the backend dumps the Shadow Buffer's perfectly accurate 2D grid (`{ type: 'sync', data: '...' }`) to the new frontend, hydrating the empty canvas instantly.
4. **Snapshotting:** When a cell finishes, the backend generates the final HTML snapshot directly from the pristine Shadow Buffer (ignoring whatever CSS distortions the browser might have), and then garbage collects the headless instance.

*Note on Sync Flickering:* When the frontend receives a `sync` payload, it MUST call `terminal.clear()` before writing the sync data. To prevent this from causing massive visual flickering on every keystroke, the frontend only receives `sync` payloads on initialization or explicit reconnects, relying on the raw stream for real-time updates.

### 3. Input Routing Paradox
Even though the frontend `xterm.js` is stripped of its complex resizing math, it still natively captures keyboard events (`onData`):
1. User presses `Up Arrow` in the frontend `xterm.js`.
2. Frontend translates this and sends it over WebSocket: `{ type: 'input', data: '\x1b[A' }`.
3. Backend writes it directly to the persistent `ptyProcess.stdin`.
4. The PTY processes it and emits a redraw sequence to `stdout`.
5. The backend `xterm-headless` updates the server-side grid to maintain canonical state, and the raw ANSI stream is sent to the frontend.
6. The frontend renders the delta. **The frontend never resizes unprompted.**

*Crucial Constraint:* Ensure that frontend `xterm.js` keystrokes are ONLY sent to the backend if the cell is currently the `activeCellId`. Finished, archived cells must be completely disabled to prevent rogue ANSI inputs from scrambling the display.

### 4. Handling Full-Screen TUIs (Vim, Top)
- The backend `xterm-headless` instance natively handles the Alternate Screen Buffer (`\x1b[?1049h`), tracking its state perfectly.
- **UI Reinstatement (Hybrid Modal):** For the absolute best user experience, we *will* retain the full-screen `TuiModal`. While the backend handles the state flawlessly, rendering `vim` inline inside a scrollable notebook cell creates a Viewport Clipping Disaster (the bottom command bar of `vim` gets hidden off the bottom of the user's browser window).
- When the frontend parses the `1049h` escape code, it must physically rip the `xterm.js` canvas out of the notebook document flow and mount it in a fixed `position: absolute` full-screen modal container. This guarantees the 24-row TUI perfectly aligns with the physical screen without scrollbar clipping.

### 5. Background Tasks and Concurrency
If a user runs a background job (`ping 8.8.8.8 &`):
- The shell returns the prompt. The parser sees the completion marker (`133;D;0`), closes the active cell, and creates a static snapshot.
- The `ping` process continues writing to the PTY stdout in the background.
- The backend buffers this text.
- When the user runs the next command (creating a new cell), the new `xterm-headless` instance boots up and immediately absorbs the buffered `ping` text alongside the new command's output, exactly mimicking standard POSIX terminal behavior.
## 4. Execution Plan (Implementation Steps)

### Phase 1: Backend Refactor (Native PTY)
- **Task 1:** Install `node-pty` and `@types/node-pty` (if using typescript for typings) if not fully configured.
- **Task 2:** Delete `backend/pty_wrapper.py`.
- **Task 3:** Refactor `backend/server.js` `createSession` function. Replace `cp.spawn('python3', ...)` with `pty.spawn(process.env.SHELL || 'bash', ...)` from `node-pty`.
- **Task 4:** Wire the `ptyProcess.onData` event to replace the `ptyProcess.stdout.on('data')` logic.
- **Task 5:** Wire the frontend WebSocket resize payload directly to `ptyProcess.resize(cols, rows)`.
- **Pitfall Warning:** `node-pty` operates strictly on strings when `onData` fires. Ensure character encodings (UTF-8) are handled correctly before passing to the parser. Watch out for Windows vs Unix differences in `node-pty` instantiation (use bash vs powershell/cmd.exe).

- **Task 5 (Session Persistence):** In `backend/server.js`, locate the `ws.on('close')` handler. Remove the `s.ptyProcess.kill('SIGKILL')` and `sessions.delete(activeId)` logic. Sessions must survive 0 clients.

- **Task 6 (Zombie Prevention):** Implement global `process.on('SIGINT')` and `process.on('SIGTERM')` hooks in `backend/server.js`. Iterate over the `sessions` map and run `ptyProcess.kill('SIGKILL')` on all active sessions before calling `process.exit()`.

### Phase 2: Server-Side Rendering Integration
- **Task 1:** Install `xterm-headless` in `backend/package.json`.
- **Task 2:** Modify the `Session` object in `backend/server.js` to include an `xterm-headless` instance for the *active* cell.
- **Task 3:** Pipe the output from the `node-pty` instance into the `xterm-headless.write()` method.
- **Task 4:** Implement a State Sync feature. When a new WebSocket client connects (or reconnects), generate a full ANSI redraw string. Use the `serialize` addon with `xterm-headless`, or iterate over the headless buffer rows to reconstruct the view, and emit a `{ type: 'sync', data: <full_ansi_string> }` message to the frontend.
- **Pitfall Warning:** Memory leaks. You **must** ensure that when a cell finishes (detecting the `133;D;` marker), the `xterm-headless` instance for that cell is properly serialized into HTML and then garbage collected. Do not keep old headless instances alive forever.

### Phase 3: Frontend Simplification
- **Task 1:** In `frontend/src/NotebookCell.jsx`, remove the `ResizeObserver` entirely. Remove calls to `fitAddon.fit()`.
- **Task 2:** Lock the frontend `xterm.js` dimension logic to ignore content flow. It should only adjust its internal rows/cols when it receives a definitive instruction from the backend or the user resizes the browser window.
- **Task 3:** In `frontend/src/App.jsx`, update the `TUI Modal` overlay logic. When the `1049h` (Alternate Buffer) signal is detected, the frontend must move the active `xterm.js` canvas into the full-screen modal to prevent viewport clipping, and restore it to the cell when the buffer switches back.
- **Task 4:** Add a strict Debounce (e.g., 200ms) to the frontend window `ResizeObserver`. Add an Ack-ID to WebSocket resize payloads so the frontend can safely ignore stale size mandates if the user drags the window wildly.
- **Task 5:** Implement logic in the frontend `NotebookCell` to dynamically calculate CSS height based on `buffer.active.cursorY` up to a maximum row count, while keeping the backend PTY locked to its maximum size (e.g., 24 rows).

- **Task 6 (Multiline Paste Fix):** In `frontend/src/App.jsx`, replace the `<input>` element with a `<textarea>`. Implement an `onKeyDown` handler where `Enter` triggers submission, but `Shift+Enter` inserts a newline. Ensure pasted text retains its `\n` characters.
- **Task 7 (DOM Bloat Warning):** Add a memory threshold check to the React `sessionCells` map. If a session exceeds 500 cells, render a persistent UI banner giving the user a button to explicitly slice the oldest 250 cells out of the active state array.
- **Pitfall Warning:** The frontend must wait for the backend to acknowledge the resize. If the frontend resizes its own canvas *before* the backend resizes the PTY, the grid will desync and glitch. The flow must be: Frontend proposes size -> Backend resizes PTY and Headless grid -> Backend streams new grid config to Frontend -> Frontend applies size.

### Phase 4: Fixing Concurrency and State Boundaries
- **Task 1:** Implement the `pendingQueue` in the `backend/server.js` `Session` object. Ensure `start` messages are queued if a cell is currently active.
- **Task 2:** Update the PTY `onData` parser logic. When `133;D;0` is detected, close the current `xterm-headless` instance, emit the final snapshot, and *then* check the `pendingQueue` to execute the next command automatically.
- **Task 3:** Fix the Input Routing Paradox. Ensure that frontend `xterm.js` keystrokes are ONLY sent to the backend if the cell is currently the `activeCellId`. Finished, archived cells must be completely disabled to prevent rogue ANSI inputs from scrambling the display.

- **Task 4 (Memory Bomb Fix):** Decouple `session.tailBuf` memory protection from `sentPos`. Implement a strict FIFO ring buffer limit (e.g., maximum 50,000 characters). If `tailBuf` exceeds this while no cell is active, slice the oldest string data out to prevent Node OOM crashes.
- **Task 5 (WebGL Cleanup):** The frontend MUST explicitly call `termData.terminal.dispose()` when the `exit` payload carrying the HTML snapshot arrives. The terminal object must be deleted from `sessionTerminals.current` to free the browser's hardware WebGL context limitation.

- **Task 6 (Multiplayer Cell Broadcast):** Update the `start` message handler in `backend/server.js`. Before pushing to `ptyProcess.stdin`, iterate over `session.clients` and broadcast a `{ type: 'new_cell', cellId, command }` payload to all clients *except* the sender, so they can render the React `NotebookCell` container.
- **Task 7 (Frontend Cell Hydration):** Update `frontend/src/App.jsx` WebSocket message listener to handle the `new_cell` payload by updating the `sessionCells` React state array.

- **Task 8 (The Clear Paradox):** Update the `backend/parser.js` or PTY `onData` handler to detect when the user executes a `clear` command (either by sniffing the `start` command input, or detecting the specific `\x1b[3J` ANSI sequence). Emit a `{ type: 'clear_history' }` WebSocket payload.
- **Task 9 (React Clear Handling):** Update `frontend/src/App.jsx` to listen for `clear_history` and replace the `sessionCells[activeSessionId]` state array with a blank array (preserving only the currently running cell if applicable).
- **Task 10 (WebSocket Reconnect):** Wrap the frontend `new WebSocket(...)` instantiation in a reconnect loop with exponential backoff. Ensure the `join_session` payload is re-sent upon successful reconnection to trigger the Shadow Buffer hydration.

- **Task 11 (Multiplayer Resize Math):** Update the `resize` WebSocket handler in `backend/server.js`. When a resize request arrives, do not blindly apply it. Iterate over all clients in `session.clients`, find the minimum `cols` and `rows` among them, and apply that "least common denominator" dimension to the PTY. Broadcast a `{ type: 'resize', cols, rows }` payload to force all frontends to sync to this exact dimension.
- **Task 12 (Cryptographic Prompt Salt):** In `backend/server.js`, modify `createSession` to generate a random UUID `promptSalt`. Inject this into the `.bashrc` `PROMPT_COMMAND` (e.g., `\x1b]133;D;$?;${promptSalt}\x07`). Update `backend/parser.js` to strictly require this exact salt string to prevent stdout spoofing from prematurely closing cells.
## 5. Testing Strategy & QA Plan

Moving the terminal rendering authority to the backend completely changes what we need to test, making it much more deterministic:

### 1. Shift from DOM Math to State Equality
We will no longer run brittle Playwright loops checking if a `div` randomly resized itself. Instead, our tests will verify **State Synchronization**. We will assert that the 2D character grid inside the backend's `xterm-headless` instance exactly matches the `xterm.js` output buffer on the frontend.

### 2. Pure Backend Headless Testing
We will write fast backend unit tests (using Jest) that pipe complex CLI outputs (like `gemini` or `vim`) directly into `xterm-headless` and assert the resulting in-memory text grid strings match our expectations, completely bypassing the browser.

### 3. Multi-Client Sync Playwright Tests
We will write a new Playwright test that opens **two** browser contexts connected to the same session. We will type in Browser A and assert that the exact same visual state renders in Browser B, proving our universal state sync architecture is flawless.

### 4. Maintain the Vision-Language Model Audit
We will retain the `scripts/audit_tui_screencast.py` pipeline. Feeding Playwright video recordings into `gemini-3.1-pro` provides an invaluable independent "synthetic human" audit to catch visual overlaps, fragmentations, or clipping that DOM mathematics might miss.

### 5. Advanced Playwright Scenario Testing
- **Latency & Jitter Injection:** The Playwright proxy must be configured to inject 200ms of latency. We must prove the frontend doesn't glitch when the user types quickly but the backend `xterm-headless` sync packets arrive out of order or clumped together.
- **The Concurrency Queue Test:** We will write an explicit E2E test that submits `sleep 2` and instantly submits `ls`. It must assert that `ls` waits in the queue and executes cleanly in Cell 2 without corrupting Cell 1.
- **Mock CLI Tooling:** Testing against real `vim` in CI is flaky across platforms. We will build tiny Node scripts (`mock-tui.js`) that emit highly deterministic, chaotic ANSI streams (Alternative Buffers, raw cursor jumps) to guarantee the backend parser perfectly reproduces complex states.

### 6. Visual Regression Testing (WebGL Blindspot)
- **The Problem:** State Equality testing proves the frontend *logic* is right, but cannot prove the *display* is working. If the WebGL context crashes on a bad Unicode char, the state buffer remains perfect while the screen turns black.
- **The Fix:** Implement strict Playwright Visual Regression Testing (`expect(page).toHaveScreenshot()`). By taking pixel-perfect screenshots of specific terminal states (e.g., rendering the Gemini gradient ASCII art) and comparing them to checked-in baselines, we definitively prove the hardware renderer is painting correctly.

### 7. Cross-Platform PTY Quirk Testing
- **The Problem:** `node-pty` wraps radically different OS APIs (`conpty` on Windows, `forkpty` on Unix). They buffer and flush ANSI byte chunks differently. A complex ANSI sequence might process perfectly on a Linux CI worker but get chopped in half on a macOS developer machine, breaking `parser.js`.
- **The Fix:** The pure backend unit tests MUST be executed in a CI matrix across `ubuntu-latest`, `macos-latest`, and `windows-latest`. Testing exclusively on Linux allows platform-specific C++ PTY race conditions to slip into production.

### 8. Mobile / Touch Interaction Blindspot
- **The Problem:** Termbook is a web app. Users will open it on iPads. Will tapping the terminal canvas summon the virtual keyboard? Will trying to scroll the page accidentally trigger an `xterm.js` text selection drag? State Equality tests cannot verify touch ergonomics.
- **The Fix:** Expand the Playwright E2E suite to include mobile emulation contexts (`devices['Pixel 5']`, `devices['iPhone 13']`). Write explicit tests simulating `touchstart` and `touchend` events to verify that the `High-Water Mark` CSS layout doesn't shatter when the iOS virtual keyboard shrinks the viewport.

### 9. Accessibility (A11y) & Color Contrast Verification
- **The Problem:** A CLI tool might output dark blue text (`\x1b[34m`). On a dark Termbook theme, dark blue on black is illegible. Pixel-perfect visual regression tests will pass (because it successfully renders dark blue pixels), but the app is still broken for the user.
- **The Fix:** Integrate `axe-core` into the Playwright tests to specifically audit the `xterm.js` WebGL canvas for WCAG color contrast violations. If an ANSI sequence drops below a 4.5:1 contrast ratio against the current theme's background, the test must fail, prompting us to adjust the frontend's ANSI color palette re-mapping.

## 6. Backend Debugging & Inspection Tooling

Because the "source of truth" for terminal state is moving entirely to the backend, we must provide robust developer tools to inspect the server-side `xterm-headless` instance. This prevents the "black box" problem where a layout glitch is visible on the frontend, but the developer has no way to prove whether it's a backend parsing bug or a frontend rendering bug.

### 1. The Headless Inspector Endpoint
We will expose a new API endpoint (e.g., `GET /api/debug/session/:id/renderer`). This endpoint will dump the exact state of the backend `xterm-headless` instance:
- **Raw String Dump (`.translateToString()`)**: Returns the exact textual grid. Useful for quick `curl` debugging to see if text is wrapped correctly.
- **ANSI Serialization (`@xterm/addon-serialize`)**: Returns the full grid including colors and cursor positioning.
- **Internal Dimensions**: Returns `rows`, `cols`, `cursorX`, `cursorY`, `baseY`, and the state of the Alternate Screen Buffer.

### 2. Automated Visual Snapshots (Puppeteer in the Backend)
For deep visual debugging, the backend can periodically or conditionally generate actual screenshots of what it *believes* the terminal looks like:
- By piping the `serialize` output of `xterm-headless` into a lightweight HTML template, the backend can use a fast headless browser (like Puppeteer/Playwright-core) to snap a `.png` of the grid.
- If a user reports a visual glitch, they can hit a "Generate Debug Snapshot" button. The backend saves `backend_view.png` and `frontend_view.png`, making it trivial to diff them.

### 3. Hex/Byte Stream Logging
To debug the exact inputs confusing the emulator (e.g., the double-newline wrap glitch):
- The backend will maintain a rolling ring-buffer (last 500 bytes) of the raw binary input received from `node-pty`.
- When requested, it will dump this buffer formatted as hex codes (e.g., `1b 5b 32 4a 0d 0a`).
- **Automated Anomaly Detection:** We can write a backend middleware that watches the `xterm-headless` state. If the cursor position jumps out of bounds or a line overwrites itself more than 10 times in 1 second (a strong indicator of the infinite redraw loop we fixed), the backend automatically saves the ring-buffer hex log to disk for the developer.

### 4. Interactive TUI Debugger
For local development, we will build a small CLI script (`npm run debug:session <id>`). This script will:
- Connect to the local backend WebSocket.
- Pipe the exact ANSI stream meant for the frontend directly into the developer's native terminal (e.g., iTerm2 or Kitty).
- This proves definitively whether a layout glitch is a Termbook Frontend bug, or if the actual backend PTY output is genuinely malformed. If it looks broken in native `iTerm2`, the bug is in the backend parsing. If it looks correct in `iTerm2` but broken in Chrome, the bug is in the frontend `xterm.js` implementation.