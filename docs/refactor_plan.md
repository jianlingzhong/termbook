Plan Review

Architecture Re-evaluation: Server-Side Terminal Rendering

1.  Goal

Evaluate the user's proposal to move terminal rendering entirely to the backend (Server-Side Rendering / cell-by-cell) and stream the grid to
the frontend, replacing the current client-side xterm.js parsing architecture.

2.  Analysis of the Proposal

### The Vision (SSR Terminal)

- Backend: Runs a headless terminal emulator. It receives the PTY output, parses the ANSI sequences, and maintains a strict 2D grid of
  characters, colors, and cursor positions.
- Frontend: A "dumb" renderer. It receives cell data (JSON or HTML) via WebSocket and simply paints the grid. It does not parse ANSI.

### Benefits

1.  Perfect Synchronization: Reconnecting, refreshing the browser, or joining from a new device instantly loads the exact canonical screen
    state from the server.
2.  Zero Client-Side Desync: The layout bugs (like the double-scroll or wrap glitches we just fought) disappear from the frontend because the
    frontend no longer calculates line wraps or cursor math. It just draws what the backend tells it to draw.
3.  True Session Persistence: The server always knows exactly what is on the screen, even if no clients are connected.

### Challenges & Trade-offs

1.  Performance & Bandwidth: Terminals update extremely fast (e.g., progress bars, rapid scrolling). Streaming raw ANSI bytes is highly
    efficient (a few bytes per update). Streaming JSON arrays of cell diffs ([{x: 1, y: 2, char: 'a', fg: 12}]) is significantly heavier on the
    WebSocket and memory.
2.  Rendering Engine: xterm.js is used on the frontend because it has a highly optimized WebGL/Canvas renderer. If we remove it and render a 2D
    grid natively in React (using a <div> or <span> per cell), the browser will heavily lag under heavy output (e.g., cat on a large file).
3.  Interaction: Features like text selection, double-click to highlight words, copying, and clickable links are complex and built into
    xterm.js. A custom "dumb grid" would require us to rebuild native-feeling text selection from scratch.

4.  Recommended Approach: The "Tmux" Hybrid Model

Instead of abandoning xterm.js on the frontend, we can achieve the exact benefits you described by implementing a "Session Manager"
architecture (similar to how tmux or zellij work):

1.  Backend Authoritative State: We run xterm-headless in backend/server.js attached to every active PTY. This consumes the raw ANSI and
    maintains the canonical terminal state in memory on the server.
2.  State Synchronization: When a user connects (or refreshes), the backend reads its xterm-headless buffer, generates a clean "redraw" frame
    (a reconstructed ANSI string of the current screen), and sends it to the frontend.
3.  Efficient Live Streaming: Once synced, the backend streams the raw ANSI delta to the frontend.
4.  Frontend as a Dumb Canvas: The frontend still uses xterm.js, but strictly as a high-performance WebGL canvas. We remove the complex
    frontend-driven resizing logic. The backend dictates the rows/cols based on its own headless instance, and the frontend simply obeys.

### Why this is the best path:

- It gives you the "resume anywhere" and "refresh without data loss" capabilities you want.
- It prevents the frontend from getting into a corrupted state, because the backend acts as the source of truth and can force a sync.
- It keeps the immense performance benefits of xterm.js WebGL rendering and built-in text selection.
- It doesn't require rebuilding complex canvas rendering in React.

### How this solves the Gemini CLI issue and handles Vim/Top

1.  The Gemini CLI (and arbitrary resize glitch) Problem:
    The core problem with gemini CLI was a fight over dimensions and resizing logic. The frontend was intercepting ANSI codes, resizing the local
    xterm.js canvas, and sending resize payloads back to the PTY, which then redrew, causing an infinite loop and layout glitches like the
    double-wrap and massive scrollback duplication.

Under the Tmux Hybrid Model:

- The frontend never initiates a terminal resize based on parsing ANSI or guessing DOM dimensions.
- The backend xterm-headless dictates the exact grid dimensions based on the server-side PTY configuration (e.g., standardizing on an 80x24 or
  120x40 logical grid for cells).
- The backend tells the frontend: "I am a 120x40 grid. Here is my content."
- The frontend xterm.js is locked to that exact grid size. If the browser window is larger, the frontend simply centers the fixed-size
  xterm.js canvas or scales the font. If the user explicitly resizes the browser window, the frontend asks the backend "Can I be this new
  size?", the backend resizes the PTY and the xterm-headless instance, and streams the newly rendered layout back to the frontend.
- Because the frontend is just a "dumb mirror" of the backend's xterm-headless state, it cannot enter a state of infinite redraws or desynced
  scrollbacks.

2.  Handling Full-Screen TUI Apps (Vim, Top, Less, HTOP):
    These applications use the "Alternate Screen Buffer" (\x1b[?1049h). In our current architecture, the frontend has to try and parse these
    sequences to know when to show the "TUI Modal" or adjust scrolling. This is brittle.

Under the Tmux Hybrid Model:

- The backend xterm-headless instance natively supports the Alternate Screen Buffer just like a real terminal emulator.
- When you type vim or top, the PTY emits the 1049h sequence. The backend xterm-headless emulator switches its internal buffer.
- The backend simply streams the resulting grid bytes to the frontend. The frontend doesn't need to know what vim is. It just renders the
  characters exactly as the backend's headless emulator sees them.
- If you hit "refresh" while top is running, the backend looks at its xterm-headless instance, sees the Alternate Buffer is active, serializes
  that buffer into a fresh ANSI redraw frame, and sends it to the newly loaded frontend. The frontend instantly paints top exactly where it left
  off, with no data loss.

### Detailed Architecture Answers

1.  How is the size of the backend xterm determined? What if the user resizes the browser window?

- Default Size: When a cell is created, the backend starts the xterm-headless instance with a sensible default size (e.g., 80x24 or something
  derived from the initial browser window width).
- Responsiveness: If the user resizes the browser, the frontend calculates the maximum columns/rows that can fit in the new DOM container
  (using fitAddon.proposeDimensions()). It sends a resize WebSocket message to the backend. The backend resizes its xterm-headless instance and
  sends a SIGWINCH to the PTY. The backend then streams any resulting redraws back to the frontend. The crucial difference is that the frontend
  never resizes its own canvas directly. It asks the server to resize, and the server tells the frontend what the new grid is.

2.  How do we handle Alternate Buffer TUIs (Vim, Top) vs normal cells?

- The goal is to get rid of the annoying "TUI Modal popup" overlay entirely.
- In a Jupyter notebook, you don't want vim to take over your whole screen. You want it to run inside the cell.
- Because the backend xterm-headless emulator knows exactly when the Alternate Buffer is active, it just renders that buffer into its internal
  grid. The frontend just draws the grid.
- This means vim or top will render seamlessly inline inside the notebook cell. The cell will simply look like a miniature terminal window
  running vim. If you exit vim, the backend switches back to the normal buffer, streams the old output down, and the cell goes back to looking
  like a normal log output.

3.  How does the frontend know when to break output into different cells?

- The Execution Model: In Termbook, a "Cell" is created every time the user hits Enter on a command. The backend spawns (or reuses) a shell
  session, but tracks the output of that specific command invocation.
- The Parsing: Our backend already has a parser.js that looks for shell prompt markers (e.g., \x1b]133;D;0\x07 which means "command finished
  with exit code 0").
- Cell Boundaries: - User types ls. A cell with ID 123 is created. - Backend PTY executes ls. The output streams through xterm-headless, which generates the display grid. - The backend streams this grid to the frontend tagged with cellId: 123. - When the backend sees the shell prompt marker (133;D;0), it knows the command is done. It sends an { type: 'exit', cellId: 123 }
  message. - The frontend marks cell 123 as "done" and stops updating it. - When the user types the next command, a new cell 124 is created, and the cycle repeats.
- The "Snapshot": When a cell finishes, the backend xterm-headless instance for that cell can be destroyed. The final grid state is serialized
  into clean HTML (or static text) and saved as a immutable "Snapshot". The frontend just renders this snapshot. Only the currently active cell
  needs an active xterm.js canvas.

4.  Wait, does every command create a new PTY shell?

- No. The underlying shell process (bash/zsh) is persistent. There is ONE long-running ptyProcess per Termbook session.
- What changes is the frontend view/cell. When you type export FOO=bar, it runs in the persistent background shell. When you type echo $FOO in
  the next cell, it will print bar because it's still using the exact same backend shell instance.
- The xterm-headless instance: The backend does maintain an xterm-headless buffer. We have two choices for how to manage this: - Option A (Continuous Buffer): The backend maintains one massive xterm-headless instance for the entire session. The frontend parses the
  output and decides where to draw boundaries for "cells" based on prompt markers. - Option B (Cell-Scoped Buffer): The backend maintains the single persistent bash PTY, but resets its internal xterm-headless instance
  when a new command starts. This isolates the grid rendering to just the current command, making it incredibly easy to send a clean "snapshot"
  to the frontend when the command finishes.
- Recommendation: Option B is vastly superior for a notebook interface. The shell state (env vars, cwd) is persistent in the PTY, but the
  rendering state is scoped per command. If you run a script that messes up the terminal colors or scroll regions, it won't break the next cell,
  because the next cell starts with a fresh xterm-headless renderer attached to the persistent PTY.

5.  What about background tasks and concurrent commands?

- The Shell Rule: In a standard PTY shell (like bash), if you run sleep 10 & and then type ls, the output of sleep and ls is interleaved on
  the same standard output stream. The shell has no inherent concept of "multiplexing" separate command streams.
- How Termbook handles it (Option B - Cell-Scoped Renderer): - If you run ping 8.8.8.8 & in Cell 1, the shell prompt returns immediately. The parser sees 133;D;0, closes Cell 1, and creates a static
  snapshot. - Meanwhile, ping is still writing to the PTY's stdout in the background. - Because there is no active command running in the foreground, this background text is buffered by the backend. - When you run ls in Cell 2, a new xterm-headless instance is spun up for Cell 2. The buffered background text from ping, plus the
  foreground text from ls, will all pipe into Cell 2's renderer. - If you never run a new command, the background text sits in the backend buffer. It will instantly flush into Cell 2 the moment you start
  it.
- Why this is correct: This perfectly mimics how a real terminal works. Background jobs pollute the active foreground prompt. If we wanted
  true isolation for background tasks, we would need to spawn a completely separate PTY for every single cell, which destroys the shared
  environment (e.g., cd in Cell 1 wouldn't affect Cell 2). Termbook trades isolated background output for a unified, stateful shell session.

6.  How does input routing work if the frontend is just a display?

- Even though the frontend xterm.js is stripped of its complex resizing math, it still natively captures keyboard events (onData).
- Input Flow: 1. User presses 'h' in the frontend xterm.js. 2. Frontend sends h over the WebSocket: { type: 'input', data: 'h' }. 3. Backend receives h and writes it directly to the persistent ptyProcess.stdin. 4. The underlying PTY (e.g., bash or vim) processes the keystroke. If it decides to echo the character (like bash does), it writes h to
  stdout. 5. The backend reads h from stdout, feeds it into the xterm-headless instance to update the server-side grid, and then streams the updated
  visual delta (or the raw h sequence) back to the frontend. 6. The frontend receives the delta and renders h on the screen.
- Interactive TUIs (Vim, Gemini CLI): The exact same flow applies. When you run gemini and type "hello", you are typing into the frontend
  canvas. The keystrokes go to the backend PTY, the PTY routes them to the gemini process. gemini redraws its UI to show "hello" in its search
  bar. It emits the ANSI redraw sequences. The backend xterm-headless processes them, and the frontend faithfully renders the new grid state.
- Why this works: The frontend isn't completely dumb; it still relies on xterm.js to translate raw keyboard events (like hitting the Up arrow)
  into correct ANSI escape codes (ESC [ A). It just doesn't use xterm.js to calculate its own visual bounds.

### 7. Is the Python PTY wrapper the best choice?

- Short Answer: No. We should replace the pty_wrapper.py script with the native Node.js library node-pty.
- Why node-pty is better: - Performance: node-pty is written in C++ and interacts directly with the OS pseudoterminal APIs (openpty, forkpty). It bypasses the
  overhead of spinning up a Python interpreter and passing bytes through intermediary standard IO pipes (stdio: ['pipe', 'pipe']). - Simplicity: Right now, the backend uses child_process.spawn to run python, which then uses pty.fork() to run bash. Resizes are sent over
  a custom JSON pipe (fd 3) to the python script, which parses it and calls fcntl.ioctl. With node-pty, you simply call ptyProcess.resize(cols,
  rows) directly in JavaScript. - Reliability: node-pty is the exact same library that powers the backend of VS Code's integrated terminal. It is battle-tested for
  handling edge cases in terminal emulation and process lifecycle management across platforms.
- Action Item: I noticed node-pty is actually already installed in backend/package.json. In the execution phase, we will delete pty_wrapper.py
  and refactor server.js to use const pty = require('node-pty').

4.  Required Changes for the Hybrid Approach

- Backend: - Add xterm-headless to backend/package.json. - In backend/server.js, instantiate an xterm-headless terminal for each session. Feed PTY output into it. - On WebSocket connect, dump the current headless terminal screen state and send it as the initialization payload so the frontend
  instantly shows the current state.
- Frontend:
  - Remove ResizeObserver logic that tries to guess dimensions.
  - The frontend xterm.js instances will simply receive state syncs and ANSI streams, acting purely as a display layer.

5.  Verification

- Close browser tab while a long script is running. Reopen tab -> exact terminal state is immediately visible and perfectly aligned.
- Open the same session in two different browsers -> both screens show the exact same content and mirror each other flawlessly.

6.  Testing Strategy & QA Plan

1.  Current Tests in Place

- Backend Unit Tests: We have tests like backend/parser.test.js and backend/server.test.js (via Jest) that verify shell prompt parsing (exit
  codes, PWD extraction) and WebSocket session management.
- End-to-End (E2E) Tests: We have a comprehensive Playwright test suite (frontend/tests/\*.spec.js) that boots the actual backend and frontend,
  connects them, and simulates user interactions.

2.  Visual Tests

- We currently use a hybrid deterministic + AI visual auditing approach: - Playwright Video Capture: Our Playwright tests are configured to record .webm screencasts of the browser during test execution. - LLM Visual Audit (scripts/audit_tui_screencast.py): We feed the recorded video to gemini-3.1-pro using a specialized prompt. The LLM
  acts as an independent human auditor, explicitly checking frame-by-frame for 4 failure modes: Flickering, Layout Gaps, Shifting Borders, and
  Broken/Fragmented ASCII art.

3.  User Behavior Emulation Tests

- Our Playwright scripts (e.g., tui_layout_investigation.spec.js) explicitly emulate real human users: - Finding elements by selectors (e.g., clicking the input box, or clicking a terminal cell to focus it). - Typing with human-like delays (page.keyboard.type('hello', { delay: 100 })) to realistically trigger things like terminal Bracketed
  Paste mode detection. - Waiting for visual updates and interacting over multiple "chat" rounds to ensure long-term session stability.

4.  Independent Auditing

- DOM Math Invariants: In the current tests, we run an asynchronous background loop inside the browser that polls the DOM dimensions every
  100ms during the entire test run. At the end of the test, it mathematically asserts that the terminal row counts and cell pixel heights never
  fluctuated (expect(stable).toBe(true)), acting as an independent verification against visual layout glitches.
- The LLM Screencast Audit: As mentioned, using a completely independent Vision-Language Model to watch the video provides a secondary layer
  of "human perception" testing that catches things DOM math might miss (like overlapping text).

5.  How the Testing Strategy Will Evolve for the Hybrid "Tmux" Model
    Moving the terminal rendering authority to the backend completely changes what we need to test, making it much more deterministic:

- Shift from DOM Math to State Equality: We will no longer need to run background loops checking if the DOM randomly resized itself (because
  the frontend will no longer possess the ability to resize itself). Instead, our tests will verify State Synchronization. We will assert that
  the 2D character grid inside the backend's xterm-headless instance exactly matches the HTML snapshot rendered on the frontend.
- Backend Headless Unit Tests: We will write pure, fast backend unit tests that pipe complex CLI programs (like gemini or vim) into
  xterm-headless and assert that the resulting in-memory text grid looks correct. We can test edge cases (like Alternate Buffer switching)
  without ever spinning up a browser!
- Multi-Client Sync Tests: We will update Playwright to open two browser windows connected to the same session, type in Window A, and assert
  that Window B renders the exact same output, proving our universal state sync works.
- Maintain Visual LLM Audits: We will keep the audit_tui_screencast.py pipeline. It is incredibly valuable for catching regressions in how the
  TUI looks to an actual human user.
