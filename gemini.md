# Project Rules

- **Automated Verification Only**: All verification MUST be implemented via code automation. This includes browser simulation and human interaction simulation. Manual verification is strictly prohibited.
- **Configurability**: The project name and other global identifiers must be configurable via a central configuration file (`app_config.json`). Hardcoding names like "Argo" or "TermShell" is not allowed.
- **Screenshot Examination**: Whenever a screenshot is provided, you MUST examine it pixel by pixel. Pay special attention to any annotations or red markings regarding errors or requested features.

## Technical Pitfalls & Best Practices

- **Regex & Control Sequences**: When matching terminal escape sequences (like OSC 1337) in `server.js`, avoid over-escaping in `new RegExp` templates. Use hex escapes (`\x1b`, `\x07`) directly.
- **Terminal Snapshotting**: xterm.js and PTY operations are asynchronous. When generating a persistent snapshot of a command's output, implement a sufficient delay (e.g., 250ms+) after the completion marker is received to allow the terminal buffer to flush.
- **Port Management & Conflict Prevention**: Before starting any server or test suite, you MUST check that the required ports (e.g., `:3000`, `:5173`) are not already in use by stale processes. Use `lsof -i :PORT` to verify.
- **Surgical Process Killing (CRITICAL SAFETY RULE)**:
  - **NEVER** use `pkill -f "node"`, `pkill -f "vite"`, or `killall`. These commands destroy the user's IDE backends, unrelated local projects, and other vital background services.
  - **NEVER** use `kill -9` unless legally stopping a process fails, as it causes severe data corruption and orphaned memory leaks (especially for Playwright headless browsers).
  - **ALWAYS** target specific PIDs occupying a port using `lsof -ti :PORT | xargs kill`, or gracefully shut down services using their direct interface (like sending SIGTERM).
- **Process Management via manage_debug_servers.py**: This script is the **OFFICIAL** method for managing dev servers.
  - **Start**: `python3 manage_debug_servers.py start`
  - **Stop**: `python3 manage_debug_servers.py stop`
  - **Restart**: `python3 manage_debug_servers.py restart` (Use `--clear-logs` to wipe logs)
  - **Status**: `python3 manage_debug_servers.py status`
  - **Rule**: DO NOT use `mprocs` or manual `npm run dev` unless explicitly debugging startup issues interactively. **ALWAYS** use this script to ensure ports are cleared and logs are properly rotated.
- **PTY Environment Standardization**: For consistent Nvim/Vim rendering, ALWAYS set `COLUMNS=80` and `LINES=24` in the `spawn` environment. Use `node-pty` for native performance. Many TUIs will fail to render or "blank screen" if they detect a 0x0 terminal on boot.

- **Renaming Integrity**: After refactoring or renaming functions, perform a global `grep` search for the old string. LSPs may miss references in JSX props or event handlers.

## Debugging & Logging Protocols

- **Unified Log Files**: All backend logs are written to `/tmp/termbook-backend.log`. All frontend logs (sent via `/api/frontend-log`) are written to `/tmp/termbook-frontend.log`. Do not look for logs in terminal standard output.
- **Append-Only with Timestamps**: Logs are strictly append-only. **Every log line MUST begin with an ISO timestamp** (e.g., `[2026-02-16T15:25:00.000Z]`). This ensures strict chronological order across hot-reloads.
- **Hot-Reload Detection**: When the backend restarts, it appends `==== BACKEND STARTED AT <ISO_TIMESTAMP> ====`. When the React frontend mounts, it appends `==== FRONTEND RELOADED ====`.
- **Identifying Stale Logs**: Because the servers hot-reload, the logs contain previous test runs. **Always check the timestamp of the latest restart marker.** If you made a code change at 3:25 PM but the last restart marker in the log is from 3:20 PM, the server **crashed during hot-reload** and failed to boot. The logs following that older marker are stale. Fix your syntax error before trusting the logs.

## UI/UX & Focus Hygiene

- **Focus Recovery**: When closing modals or overlays (like TUIs), always explicitly return focus to the primary input element to maintain a seamless keyboard-driven experience.
- **Dynamic ghost text**: When implementing ghost text for auto-completion, ensure its horizontal position is dynamically calculated or reactively bound to the input's actual starting position, accounting for variable-width prefixes.
- **Buffer Persistence**: For terminal-like components, ensure snapshots of output buffers are persisted in a higher-level state (e.g., App or Session state) rather than just component-local state. This prevents data loss during re-renders or session switches.
- **Full Buffer Snapshots**: When generating HTML snapshots of terminal output, ensure the entire relevant buffer is serialized, not just the active viewport, to allow for post-execution scrolling and review.

## Nvim & TUI modal state management

- **Backend-Driven TUI State**: Do not rely on the frontend to detect TUIs via string matching on raw chunks. Backend MUST track `isTuiActive` by scanning a `tailBuf` for `\x1b[?1049h` (enter) and `\x1b[?1049l` (exit). Send explicit `tui_enter`/`tui_exit` messages to the frontend.
- **Chunk-Agnostic Streaming**: PTY output is often split mid-sequence. Use a `sentPos` pointer against a persistent `tailBuf` to ensure that partial escape sequences are held back until complete, preventing "visual leakage" of raw control codes into the UI.
- **TUI Element Lifecycle**: When transitioning between Notebook view and TUI Modal, DO NOT call `terminal.open(el)` again. This resets internal state. Instead, append the existing `terminal.element` to the new container (`el.appendChild(terminal.element)`). This preserves the alternate screen buffer and scrollback.
- **TUI-Aware Prompt Detection**: Disable or ignore shell prompt detection (OSC 133;D) while `isTuiActive` is true. TUIs may output data that accidentally triggers prompt regexes, leading to premature command termination and data leakage.
- **Authoritative Dimensioning**: Avoid `ResizeObserver` and `fitAddon.fit()` for automatic terminal resizing as they frequently trigger infinite `SIGWINCH` loops. Instead, the frontend should calculate physical fit using `fitAddon.proposeDimensions()`, send a `resize` request to the backend, and wait for the backend to broadcast the new canonical grid size before applying it to the local canvas.


## Reliable TUI Testing (Playwright)

- **Buffer Inspection over DOM Scraping**: To verify Nvim state, use `page.evaluate` to inspect `terminal.buffer.active`. Check `buffer.active.type` (normal vs alternate) and `buffer.active.getLine(i).translateToString()` for specific markers like `~` or `[No Name]`. This is 100x more reliable than `expect(locator).toContainText()`.
- **TUI Wake-up sequence**: Headless TUIs sometimes fail to draw the first frame. If a test is stuck on a blank TUI screen, send an `Escape` keypress to "nudge" the application into a redraw cycle before performing assertions.
- **Zero Residual Verification**: Always run a shell command (like `ls`) immediately after a TUI session in your tests to verify that the alternate screen was correctly cleaned up and no TUI data leaked into standard output.