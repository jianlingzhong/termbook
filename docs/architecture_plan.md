# Termbook Architecture: The Hybrid SSR Terminal Model

## 1. Executive Summary
Termbook is migrating from a frontend-driven terminal layout architecture to a Server-Side Rendered (SSR) "Tmux Model". The current architecture relies on the frontend `xterm.js` to calculate its own bounds and parse ANSI sequences in isolation, leading to layout instability, infinite resize loops, and memory leaks.

**The Solution:** Adopt the **Shadow Buffer (Raw Proxy)** architecture. The Node.js backend maintains an authoritative `xterm-headless` grid instance for every active cell. The frontend `xterm.js` canvas acts as a high-performance "dumb display", receiving raw ANSI streams for real-time interaction while relying on the backend for canonical state, hydration, and dimensional authority.

## 2. Context: Flaws of the Current Architecture

### 2.1 Spatial & Rendering Flaws
- **Flaw A: The "SIGWINCH Storm" (Infinite Resize Loop)**: Frontend ResizeObservers detect sub-pixel changes -> trigger `fitAddon.fit()` -> send resize to backend -> PTY sends `SIGWINCH` -> App redraws -> repeat. 
- **Flaw B: The Double-Scroll / Line-Wrap Glitch**: CSS padding desyncs cause `xterm.js` to process wraps and newlines separately, scrolling 2 lines instead of 1 and leaving permanent "ghost" lines.
- **Flaw C: The Scrollback Leak**: TUIs using ANSI clear (`\x1b[2J`) in the normal buffer shunt "cleared" text into hidden scrollback, ballooning memory and causing notebook cells to grow infinitely.
- **Flaw D: The Notebook "Hugging" Paradox**: Fixed 2D terminal grids (e.g., 24 rows) create giant empty black boxes for small commands like `echo hello`.

### 2.2 Temporal & Concurrency Flaws
- **Flaw E: The "Fast Typer" Concurrency Bug**: Sequential commands sent before the previous one finishes overwrite the `activeCellId` pointer, orphaning data and causing output bleed.
- **Flaw H: The "Fake Tmux" Session Destruction**: Backend kills the PTY session immediately when the last WebSocket disconnects, preventing long-running scripts and multi-device persistence.
- **Flaw I: The Multiplayer Sync Failure**: New cells started by Client A are never broadcast to Client B, leaving their screen blank while output streams into a non-existent container.
- **Flaw P: The Shell Injection Vulnerability**: Predictable shell completion markers (`133;D;0`) can be spoofed by malicious scripts to prematurely close cells and hijack the command queue.

### 2.3 Memory & Resource Flaws
- **Flaw F: The Silent Background Memory Bomb**: `tailBuf` ring-buffer protection only fires when an active cell is consuming data. A background job (`ping &`) running without an open cell will grow `stdout` memory until the Node server crashes.
- **Flaw G: The WebGL Context Exhaustion**: Browsers limit WebGL contexts (~16). Termbook hoards contexts for historical cells, eventually crashing the GPU or killing performance.
- **Flaw J: The Node.js Zombie Process Leak**: Child PTYs are not reaped when the Node server crashes or restarts, leading to hundreds of "zombie" processes on the host.

### 2.4 UX & Interaction Flaws
- **Flaw K: The Missing Reconnect Loop**: Temporary network drops permanently freeze the UI.
- **Flaw L: The "clear" Command Paradox**: Terminal `clear` only wipes the active canvas, leaving the 50 previous React notebook cells visible.
- **Flaw M: The Multiline Paste Breakage**: HTML `<input>` elements strip `\n`, breaking pasted bash scripts.
- **Flaw N: Infinite DOM Bloat**: 2,000 historical cells with deep HTML snapshots will eventually crash the React reconciler and browser layout engine.

---

## 3. Detailed Architecture Mechanics

### 3.1 Persistent Session Manager (Tmux Model)
- **PTY Management**: Backend uses `child_process.spawn` with a custom `pty_wrapper.py` for macOS stability and robust ANSI chunking.
- **Decoupled Lifecycle**: PTY processes live independently of WebSocket connections. They are destroyed only via explicit user action or inactivity timeouts.
- **Command Queue**: Backend implements a `pendingQueue`. If a command arrives while `activeCellId` is set, it is queued and executed only after the `133;D;` prompt marker fires.

### 3.2 The Shadow Buffer (Raw Proxy)
- **Zero-Authority Frontend**: `xterm.js` remains on the frontend for WebGL performance. Its `ResizeObserver` and `.fit()` logic are retained for horizontal scaling, but vertical authority moves to the fixed-height CSS (Task 10) to prevent `SIGWINCH` loops.
- **The Backend Verifier**: Simultaneously pipes PTY output into a server-side `xterm-headless` instance.
- **State Hydration**: On refresh, the backend dumps the Shadow Buffer state (`serialize()`) to the frontend.
- **High-Water Mark Logic**: Backend locks PTY width (e.g., 120 cols). Frontend React container scales height based on `xterm.buffer.active.cursorY` to "hug" content without sending resize signals.

### 3.3 Security & Integrity
- **Cryptographic Prompt Salts**: Backend injects a unique UUID salt into `PROMPT_COMMAND`. The parser strictly validates this salt before closing a cell to prevent stdout spoofing.
- **Input Routing Paradox**: Keyboard listeners are disabled on archived cells. Keystrokes only route to the backend if the cell is `active` and the shell is ready.

---

## 4. Execution Plan (Implementation Tasks)

### Phase 1: Backend Refactor (PTY Handling & Safety)
- **Task 1**: Refactor PTY handling to use the robust `pty_wrapper.py` for stable ANSI stream parsing on macOS/Unix.
- **Task 2**: Implement `process.on('SIGINT')` / `SIGTERM` hooks to kill child PTYs (Zombie Fix).
- **Task 3**: Generate and inject unique `promptSalt` into shell startup. Update `parser.js` regex.
- **Task 4**: Implement `tailBuf` FIFO truncation (e.g., 50KB limit) decoupled from `sentPos` (Memory Bomb Fix).

### Phase 2: State Management & Multiplayer
- **Task 5**: Instantiate `xterm-headless` per active cell. Implement `pendingQueue` for concurrency.
- **Task 6**: Implement `sync` payload (Hydration) and `new_cell` broadcast (Multiplayer).
- **Task 7**: Sniff `clear` / `\x1b[3J` to emit `clear_history` WebSocket event.

### Phase 3: Frontend Simplification & UX
- **Task 8**: Maintain `ResizeObserver` for horizontal width adaptation while neutralizing vertical loops via fixed CSS heights (Task 10).
- **Task 9**: Implement **Minimum Bounding Box Resize Math** in backend.
- **Task 10**: Implement High-Water Mark CSS resizing.
- **Task 11**: Replace `<input>` with `<textarea>` (Multiline Paste Fix).
- **Task 12**: Explicitly call `terminal.dispose()` on cell completion (WebGL Fix).
- **Task 13**: Implement exponential backoff reconnect loop.
- **Task 14**: Add "High Memory Usage" warning banner for 500+ cells.

---

## 5. Testing & Verification Strategy

### 5.1 Deterministic Integration
- **Mock CLI Tooling**: Build `mock-tui.js` scripts that emit deterministic, chaotic ANSI streams to test parser robustness against platform-specific chunking.
- **Cross-Platform Matrix**: Run backend unit tests in CI across `ubuntu-latest`, `macos-latest`, and `windows-latest`.

### 5.2 Playwright E2E Scenarios
- **The Concurrency Test**: Submit `sleep 2` then `ls`; verify queueing and clean execution.
- **The Resize War Test**: Open two windows with different sizes; verify Minimum Bounding Box arbitration and black padding.
- **Jitter & Latency Test**: Inject 200ms latency; verify visual character positioning remains stable.
- **The SIGWINCH Regression**: Loop `page.setViewportSize()` and verify backend CPU remains flat.

### 5.3 Visual & A11y Audits
- **Visual Regression**: Pixel-perfect screenshot comparisons (`toHaveScreenshot()`) for complex Unicode/WebGL states.
- **Touch Interaction**: Emulate iOS/Android; verify touch-scrolling doesn't trigger text selection and virtual keyboard works.
- **A11y Audit**: Integrate `axe-core` to check for WCAG color contrast violations in the ANSI color palette.

---

## 6. Debugging Tooling
- **Headless Inspector API**: `GET /api/debug/session/:id/renderer` for raw grid state dumps.
- **Binary Hex Logging**: Rolling ring-buffer of the last 500 bytes of PTY output for hex-level ANSI debugging.
