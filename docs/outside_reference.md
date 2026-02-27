# **Technical Design Specification: Project Nebula**
**Version:** 3.0
**Date:** February 2026
**Target Architecture:** Web-Based Notebook Terminal

---

## **1. Executive Summary & Design Philosophy**

Traditional terminal emulators (xterm, GNOME Terminal) model the terminal as a **Grid of Characters** (a 2D array of cells). They are fundamentally "dumb" pipes that render a stream of bytes.

**Project Nebula** models the terminal as a **List of Blocks** (a "Notebook").
1.  **Input is distinct from Output:** The user types into a text editor, not the PTY.
2.  **Commands are Atomic:** Every execution creates a distinct data object containing the Command, Metadata, and Output Grid.
3.  **TUI is a Modal:** Full-screen applications (Vim, Htop) are treated as a temporary "Overlay Grid" rather than polluting the notebook history.

### **Reference Architecture Influence**
*   **Warp:** We adopt the **Input/Output Decoupling** and the **Grid Data Model** (treating output as a discrete object). We use Warp's strategy of handling TUI apps as "Grids with expanded dimensions."
*   **iTerm2:** We adopt the **OSC 133 Protocol** for shell integration because it is an open standard, avoiding the maintenance burden of Warp's proprietary JSON-over-DCS injection.

---

## **2. System Architecture**

The system follows a standard Client-Server model using WebSockets for real-time bidirectional streaming.

### **2.1 High-Level Diagram**

```ascii
[ Browser / Client ]                  [ Server / Backend ]             [ Shell Process ]
+---------------------+               +------------------+             +---------------+
|  React App          |               | Node.js          |             | Zsh / Bash    |
|                     |   WebSocket   |                  |   IPC/Pipe  |               |
| [Input Editor]  <---|-------------->| [WS Server]  <---|------------>| [ PTY ]       |
| (Monaco Instance)   |   JSON/Bin    |                  |             | (node-pty)    |
|                     |               | [Session Mgr]    |             |               |
| [Block List]        |               |                  |             | [Hooks]       |
|  - Block A (HTML)   |               | [Parser]         |             |  - preexec    |
|  - Block B (Xterm)  |               |                  |             |  - precmd     |
+---------------------+               +------------------+             +---------------+
```

### **2.2 The Technology Stack**
*   **Frontend:** React, TypeScript, **Monaco Editor** (Input), **xterm.js** (Output Rendering).
*   **Backend:** Node.js, `ws` (WebSockets), **node-pty** (Pseudo-terminal management).
*   **Protocol:** JSON for control messages + Raw Binary for PTY data + **OSC 133** for synchronization.

---

## **3. The Data Model (The "Grid" Design)**

Based on Warp’s engineering blogs, we reject the single-buffer model. The application state is a **Timeline** of **Blocks**.

### **3.1 The Block Interface**
A `Block` is the fundamental unit of history.

```typescript
type BlockId = string; // UUID

enum BlockState {
  INPUTTING = 'INPUTTING', // User is typing (Local only)
  RUNNING   = 'RUNNING',   // Command sent to PTY, receiving data
  FINISHED  = 'FINISHED',  // Command done, exit code received
}

interface Block {
  id: BlockId;
  state: BlockState;
  timestamp: number;

  // 1. Context Grid (Prompt)
  context: {
    cwd: string;         // Current working directory
    user: string;        // "root" vs "dev"
    gitBranch?: string;  // Optional VCS info
    exitCode?: number;   // Null while running
  };

  // 2. Input Grid (The Command)
  input: {
    rawText: string;     // The actual command string (e.g., "ls -la")
  };

  // 3. Output Grid (The Result)
  output: {
    // While RUNNING: We hold a reference to the live xterm instance
    // While FINISHED: We hold serialized HTML or a serialized buffer
    data: string | Uint8Array;

    // Dimensions at the time of execution (Critical for reflow)
    cols: number;
    rows: number;
  };
}
```

### **3.2 The Global Store**
The global state manages the list of blocks and the "Mode" of the terminal (Notebook vs. TUI).

```typescript
interface TerminalState {
  // The Notebook History
  blocks: Block[];
  activeBlockId: BlockId | null;

  // TUI Overlay (Vim/Top)
  // When active, the Notebook List is hidden via CSS
  overlay: {
    active: boolean;
    title: string; // e.g., "vim"
  };

  // The Input Buffer (Managed by Monaco)
  currentInput: string;
}
```

---

## **4. The Input Layer: Native Web Editor**

We utilize **Monaco Editor** (the engine powering VS Code) for the input box. This provides Warp-like capabilities (syntax highlighting, multi-cursor) out of the box.

### **4.1 Architecture**
1.  **Isolation:** The Monaco instance is **not** connected to the PTY. It is a local React state controller.
2.  **Execution Trigger:**
    *   User presses `Enter`.
    *   **Action 1:** The text content is extracted.
    *   **Action 2:** A new `Block` is created in `RUNNING` state.
    *   **Action 3:** The text is sent to the backend via WebSocket: `{ type: 'EXECUTE', payload: 'ls -la' }`.
    *   **Action 4:** The Monaco editor is cleared.

### **4.2 Input Code Snippet (React)**
```tsx
import Editor from "@monaco-editor/react";

const InputArea = ({ onExecute }) => {
  const handleEditorDidMount = (editor, monaco) => {
    // Add "Enter" keybinding
    editor.addCommand(monaco.KeyCode.Enter, () => {
      const command = editor.getValue();
      if (command.trim()) {
        onExecute(command);
        editor.setValue(""); // Clear
      }
    });
  };

  return (
    <div className="input-block-wrapper">
      <div className="custom-prompt-decoration">➜</div>
      <Editor
        height="24px"
        language="shell"
        theme="vs-dark"
        options={{ minimize: true, lineNumbers: 'off', scrollBeyondLastLine: false }}
        onMount={handleEditorDidMount}
      />
    </div>
  );
};
```

---

## **5. Shell Integration & Protocol (The Handshake)**

To enable the Notebook model, the backend needs to know **boundaries**. We use the **OSC 133** standard.

### **5.1 The Protocol (OSC 133)**
This is a standard escape sequence supported by terminals like iTerm2 and VS Code.
*   **Start Prompt:** `\x1b]133;A\x07`
*   **End Prompt / Start Input:** `\x1b]133;B\x07`
*   **Start Output:** `\x1b]133;C\x07`
*   **End Output:** `\x1b]133;D;{EXIT_CODE}\x07`

### **5.2 Server-Side Injection**
When `node-pty` spawns the shell, we inject a script to override the prompt (`PS1`) and hook execution.

**Example: Zsh Injection Script (`.zshrc` equivalent)**
```bash
# Define the OSC 133 functions
function _term_hook_preexec() {
  # 133;C indicates OUTPUT START
  printf "\033]133;C\007"
}

function _term_hook_precmd() {
  local ret="$?"
  # 133;D indicates OUTPUT END (with exit code)
  printf "\033]133;D;%s\007" "$ret"

  # 133;A indicates PROMPT START (we generally ignore this in Notebook mode)
  printf "\033]133;A\007"
}

# Attach hooks
autoload -Uz add-zsh-hook
add-zsh-hook preexec _term_hook_preexec
add-zsh-hook precmd _term_hook_precmd
```

---

## **6. The Rendering Engine (Multi-Grid Strategy)**

This is the most critical technical challenge. Rendering 100 `xterm.js` instances will consume too much WebGL memory. We use a **Lifecycle Management Strategy**.

### **6.1 The Block Lifecycle**

#### **Phase A: ACTIVE (Running)**
*   **Renderer:** A live `xterm.js` instance.
*   **Addon:** `FitAddon` to ensure it fills the block width.
*   **Data Flow:** Streaming WebSocket data is written directly: `term.write(chunk)`.

#### **Phase B: FROZEN (Finished)**
*   **Trigger:** The parser detects `OSC 133; D`.
*   **Action:**
    1.  Stop writing to the terminal.
    2.  **Serialize:** Extract the visual data.
        *   *Approach 1 (HTML):* Use xterm's serializer addon to get HTML string.
        *   *Approach 2 (Canvas Snapshot):* Extract the canvas image data.
    3.  **Unmount:** Destroy the `xterm` instance (`term.dispose()`).
    4.  **Replace:** Render a lightweight `<div>` with the serialized content.

### **6.2 React Implementation Logic**
```typescript
const TerminalBlock = ({ blockId, isFinished }) => {
  const terminalRef = useRef(null);

  useEffect(() => {
    if (isFinished) return; // Don't mount xterm if already done

    const term = new Terminal({
      rows: 2, // Starts small
      cols: 80,
      convertEol: true
    });

    term.open(terminalRef.current);

    // Auto-resize height based on content
    term.onRender(() => {
      const activeRows = term.buffer.active.cursorY + 1;
      // Resize container logic...
    });

    // Register with global stream router
    StreamRouter.register(blockId, term);

    return () => {
      StreamRouter.unregister(blockId);
      term.dispose();
    };
  }, [blockId, isFinished]);

  if (isFinished) {
    // Render static HTML output
    return <div className="static-output" dangerouslySetInnerHTML={{__html: block.output.data}} />;
  }

  return <div ref={terminalRef} className="live-terminal" />;
};
```

---

## **7. Handling TUI & Alternate Screens (The Overlay)**

Warp treats TUI apps as a "Grid with expanded dimensions." In our web implementation, this maps to a **Modal Overlay**.

### **7.1 Detection Logic**
We need to parse the stream *before* it hits the active block to detect screen switches.

**Relevant Escape Codes:**
*   `\x1b[?1049h`: Switch to Alternate Screen Buffer (Start Vim/Top).
*   `\x1b[?1049l`: Switch to Main Screen Buffer (Exit Vim/Top).

### **7.2 The Stream Router (Frontend)**
The Router sits between the WebSocket and the UI components.

```typescript
class StreamRouter {
  processData(chunk: string) {
    // 1. Check for TUI Enter
    if (chunk.includes('\x1b[?1049h')) {
      store.dispatch({ type: 'SET_OVERLAY_MODE', active: true });
    }

    // 2. Check for TUI Exit
    if (chunk.includes('\x1b[?1049l')) {
      store.dispatch({ type: 'SET_OVERLAY_MODE', active: false });
    }

    // 3. Check for Block End (OSC 133)
    if (chunk.includes('\x1b]133;D')) {
      this.sealActiveBlock();
    }

    // 4. Route Data
    if (store.state.overlay.active) {
      // Send to the Fullscreen Xterm Instance
      this.overlayTerm.write(chunk);
    } else {
      // Send to the Active Block Xterm Instance
      this.activeBlockTerm.write(chunk);
    }
  }
}
```

### **7.3 Visual Implementation**
*   **Notebook Mode:** CSS: `overflow-y: scroll`. Blocks are stacked vertically.
*   **Overlay Mode:**
    *   A generic `div` with `position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; z-index: 9999`.
    *   Contains a **single** xterm.js instance.
    *   This instance is resized to fit the browser window exactly (`fitAddon.fit()`).
    *   A `resize` event listener on the window sends `pty.resize(cols, rows)` to the backend to ensure Vim knows the window size.

---

## **8. Backend Implementation Details**

### **8.1 Node-PTY Setup**
Standard setup, but strictly handling the environment variables to ensure compatibility.

```javascript
const pty = require('node-pty');

const shell = pty.spawn('zsh', [], {
  name: 'xterm-256color', // Crucial for Vim/Colors to work
  cols: 80,
  rows: 30,
  cwd: process.env.HOME,
  env: {
    ...process.env,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor' // Support 24-bit color
  }
});

shell.onData((data) => {
  // Send raw binary/string to WebSocket
  ws.send(data);
});

// Incoming from WebSocket (User Input)
ws.on('message', (msg) => {
  const { type, payload } = JSON.parse(msg);

  if (type === 'EXECUTE') {
    // Append newline to execute command
    shell.write(payload + '\r');
  }
  else if (type === 'RESIZE') {
    shell.resize(payload.cols, payload.rows);
  }
  else if (type === 'INPUT_DATA') {
    // For TUI interaction (arrow keys inside Vim)
    shell.write(payload);
  }
});
```

---

## **9. Performance & Optimization Strategy**

### **9.1 Virtualization**
If a user runs `yes`, the terminal creates infinite blocks.
*   **Solution:** Use `react-window` or `react-virtualized` for the `NotebookList`.
*   Only render the `Block` components that are currently in the viewport.

### **9.2 Data Throttling**
React cannot handle 60fps updates for a `setState` on every byte received.
*   **Solution:** Buffer incoming WebSocket data in the `StreamRouter`. Flush to the xterm instance every 16ms (1 frame) or when the buffer reaches a certain size (e.g., 4KB).

### **9.3 "Frozen" Blocks Memory**
Storing the full HTML string for 10,000 blocks is heavy.
*   **Solution:** The `Block` object in the Redux store should only store metadata. The actual content can be offloaded to `IndexedDB` or kept in memory with a Least-Recently-Used (LRU) eviction policy, reloading it when the user scrolls back up.

---

## **10. Edge Case Analysis**

### **10.1 `ssh` Handling**
**Problem:** When a user SSHs into a remote server, our local shell hooks (`preexec`) stop working because the remote shell is now in control. The output becomes one giant stream.
**Warp's Solution:** They install a "Warpify" script on the remote server.
**Our Solution (MVP):**
*   Detect `ssh` command in the Input Editor.
*   If detected, switch the UI to **"Legacy Terminal Mode"** (Single large xterm instance).
*   The "Notebook" features are effectively paused until the SSH session ends.

### **10.2 Interactive CLI Scripts (e.g., Python `input()`)**
**Problem:** User runs a script that pauses and asks for input mid-execution.
**Solution:**
*   The `Block` stays in `RUNNING` state.
*   Since the Input Editor is decoupled, we need a way to send raw stdin to the running command.
*   **UI:** Display a secondary "Stdin Bar" inside the Running Block, or route the main Input Editor's output to `stdin` directly if the block is still running.

---

## **11. Comparison: Why This Architecture?**

| Feature | Single Buffer (Legacy) | DOM Rendering (DomTerm) | **Proposed Hybrid (Nebula)** |
| :--- | :--- | :--- | :--- |
| **Rendering** | Canvas (Fast) | DOM Nodes (Slow) | **Canvas (Live) + DOM (Frozen)** |
| **Input** | PTY Stdin (Clunky) | ContentEditable (OK) | **Monaco (IDE-Grade)** |
| **TUI Support**| Native | Difficult/Broken | **Overlay Modal** |
| **Complexity**| Low | High | **Medium-High** |
| **Memory** | Low | High | **Managed (via Freezing)** |

---

## **12. Conclusion**

This design achieves the "Warp" user experience using "Web-Native" technologies.

1.  **Input:** We use **Monaco** to give users an IDE experience.
2.  **State:** We use **Blocks** to organize history, treating output as immutable objects once finished.
3.  **Rendering:** We use **xterm.js** for correctness but manage its lifecycle (Mount -> Run -> Serialize -> Destroy) to maintain performance.
4.  **Compatibility:** We use **OSC 133** to piggyback on existing shell standards.
5.  **TUI:** We use the **Overlay Strategy** to handle Vim/Htop without breaking the block model.

This architecture is robust, scalable, and provides a clear path to implementation.
