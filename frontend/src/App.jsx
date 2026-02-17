import React, { useState, useEffect, useRef } from 'react';
import NotebookCell from './NotebookCell';
import TuiModal from './TuiModal';
import { Terminal } from 'xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SerializeAddon } from '@xterm/addon-serialize';
import 'xterm/css/xterm.css';
import { TerminalSquare, History, Plus, Folder, Hash } from 'lucide-react';
import './index.css';

function App() {
  const [sessions, setSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [config, setConfig] = useState({ appName: 'Termbook', appTitle: 'TERMBOOK' });

  const [sessionCells, setSessionCells] = useState({});
  const [sessionPwds, setSessionPwds] = useState({});
  const [sessionSockets, setSessionSockets] = useState({});
  const [sessionTuiStates, setSessionTuiStates] = useState({});
  const [sessionQueues, setSessionQueues] = useState({});
  const sessionRunning = useRef({}); // Track run state with ref for WS closure safety
  // Force update hack to let the UI re-render when sessionRunning changes (if needed elsewhere)
  const [, forceUpdate] = useState({});
  const sessionTerminals = useRef({});
  const manualInputBuffers = useRef({}); // Track manual keystrokes per session

  const [history, setHistory] = useState([]);

  const [globalInput, setGlobalInput] = useState('');
  const [ghostText, setGhostText] = useState('');
  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  const remoteLog = (msg) => {
    fetch('/api/frontend-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: msg })
    }).catch(() => { }); // Fire and forget
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const forceNew = params.get('new_session') === 'true';

    remoteLog(`==== FRONTEND RELOADED ====`);

    fetch('/api/sessions')
      .then(res => res.json())
      .then(data => {
        if (!forceNew && data.sessions && data.sessions.length > 0) {
          setSessions(data.sessions);
          setActiveSessionId(data.sessions[0].id);
        } else {
          createNewSession();
        }
      })
      .catch(() => createNewSession());

    fetch('/api/config')
      .then(res => res.json())
      .then(data => setConfig(data))
      .catch(console.error);

    fetch('/api/history')
      .then(res => res.json())
      .then(data => setHistory(data.history || []))
      .catch(console.error);

    return () => {
      Object.values(sessionTerminals.current).forEach(t => t.terminal.dispose());
    };
  }, []);

  const getOrCreateTerminal = (sessionId) => {
    if (sessionTerminals.current[sessionId]) return sessionTerminals.current[sessionId];

    const terminal = new Terminal({
      theme: {
        background: '#1a1b26',
        foreground: '#c0caf5',
        cursor: '#00ecec',
        cursorAccent: '#1a1b26',
      },
      convertEol: true,
      cursorBlink: false,
      cursorStyle: 'block',
      cursorInactiveStyle: 'block',
      fontFamily: '"JetBrains Mono", monospace',
      fontSize: 14,
      allowProposedApi: true,
      scrollback: 5000
    });

    const fitAddon = new FitAddon();
    const serializeAddon = new SerializeAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(serializeAddon);

    sessionTerminals.current[sessionId] = { terminal, fitAddon, serializeAddon };
    return sessionTerminals.current[sessionId];
  };

  const handleCreateSnapshot = (sessionId, cellId) => {
    const termData = sessionTerminals.current[sessionId];
    if (!termData) return "";

    const { terminal } = termData;
    const buffer = terminal.buffer.active;
    const lines = [];

    // Efficiently find non-empty lines in buffer
    for (let i = 0; i < buffer.length; i++) {
      const line = buffer.getLine(i);
      if (line) {
        lines.push(line.translateToString(false));
      }
    }

    let lastNonEmpty = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].trim().length > 0) {
        lastNonEmpty = i;
        break;
      }
    }

    if (lastNonEmpty === -1) {
      remoteLog(`handleCreateSnapshot [${sessionId}]: cellId=${cellId}, buffer is empty or all whitespace.`);
      return "";
    }

    const content = lines.slice(0, lastNonEmpty + 1).join('\n');
    remoteLog(`handleCreateSnapshot [${sessionId}]: cellId=${cellId}, lines extracted=${lastNonEmpty + 1}`);

    // Escape HTML characters to prevent XSS and rendering issues
    const escapedContent = content
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");

    return `<pre style="margin:0; font-family:var(--font-mono); color:var(--text-primary); white-space:pre-wrap; word-break:break-all;">${escapedContent}</pre>`;
  };

  useEffect(() => {
    if (!activeSessionId) return;
    const queue = sessionQueues[activeSessionId] || [];
    const isRunning = sessionRunning.current[activeSessionId];
    const ws = sessionSockets[activeSessionId];

    if (queue.length > 0 && !isRunning && ws && ws.readyState === WebSocket.OPEN) {
      const nextCmd = queue[0];
      sessionRunning.current[activeSessionId] = true;
      forceUpdate({}); // Trigger a re-render if needed
      ws.send(JSON.stringify({ type: 'start', data: nextCmd.command, cellId: nextCmd.id }));
    }
  }, [activeSessionId, sessionQueues, sessionSockets]);

  useEffect(() => {
    if (!activeSessionId) return;
    const sessionId = activeSessionId;

    if (!sessionSockets[sessionId]) {
      const wsUrl = `ws://${window.location.host}/ws`;
      const ws = new WebSocket(wsUrl);
      const { terminal } = getOrCreateTerminal(sessionId);

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'join_session', sessionId: sessionId }));
      };

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'session_init') {
          remoteLog(`WS session_init [${sessionId}]: pwd=${msg.pwd}, isReady=${msg.isReady}`);
          setSessionPwds(prev => ({ ...prev, [sessionId]: msg.pwd }));
        } else if (msg.type === 'output') {
          remoteLog(`WS output [${sessionId}]: cellId=${msg.cellId}, dataLength=${msg.data.length}`);
          terminal.write(msg.data);
          if (msg.data.includes('\x1b[?1049h')) {
            remoteLog(`WS output [${sessionId}]: Detected TUI ENTER (1049h)`);
            setSessionTuiStates(prev => ({
              ...prev,
              [sessionId]: { ws, cellId: msg.cellId }
            }));
          }
          if (msg.data.includes('\x1b[?1049l')) {
            remoteLog(`WS output [${sessionId}]: Detected TUI EXIT (1049l)`);
            handleTuiExit(sessionId);
          }
        } else if (msg.type === 'tui_exit') {
          remoteLog(`WS tui_exit explicit message [${sessionId}]`);
          handleTuiExit(sessionId);
        } else if (msg.type === 'exit') {
          remoteLog(`WS exit [${sessionId}]: exitCode=${msg.exitCode}, cellId=${msg.cellId}`);

          // Only process exit if we are currently running something
          if (!sessionRunning.current[sessionId]) {
            remoteLog(`WS exit [${sessionId}]: Ignoring exit because sessionRunning is false.`);
            return;
          }
          // Bypass xterm's write callback which can be unpredictably frozen
          // if the DOM is obscured or transitioning.
          setTimeout(() => {
            const snapshot = handleCreateSnapshot(sessionId, msg.cellId);

              setSessionCells(prev => {
                const cells = prev[sessionId] || [];
                const updated = cells.map(c => c.id === msg.cellId ? { ...c, snapshot: snapshot || "" } : c);
                return { ...prev, [sessionId]: updated };
              });

              if (msg.pwd) {
              setSessionPwds(prev => ({ ...prev, [sessionId]: msg.pwd }));
            }

            setSessionTuiStates(prev => {
                const newState = { ...prev };
                delete newState[sessionId];
                return newState;
              });

              terminal.reset();

              // Unlock session AFTER snapshot is safely generated and terminal is reset
              // This strictly prevents new commands from rushing the PTY and wiping the buffer!
              sessionRunning.current[sessionId] = false;
              setSessionQueues(prev => {
                const q = prev[sessionId] || [];
                return { ...prev, [sessionId]: q.slice(1) };
              });
              forceUpdate({});

            }, 250); // 250ms is plenty for the xterm buffer to be populated natively
          // Removed the wrapper write block
        }
      };

      terminal.onData(data => {
        if (ws.readyState === WebSocket.OPEN) {
          // Track keystrokes for manual snapshot parsing
          const isRunning = sessionRunning.current[sessionId];

          if (!isRunning) {
            let buffer = manualInputBuffers.current[sessionId] || '';

            // Handle backspace/delete
            if (data === '\x7f' || data === '\b') {
              buffer = buffer.slice(0, -1);
              manualInputBuffers.current[sessionId] = buffer;
              ws.send(JSON.stringify({ type: 'input', data }));
            }
            // Handle Enter (\r or \n) to trigger a tracked execution
            else if (data === '\r' || data === '\n') {
              const cmd = buffer.trim();
              manualInputBuffers.current[sessionId] = ''; // clear

              if (cmd.length > 0) {
                // Spawn a cell for the manual command
                const newCellId = (sessionCells[sessionId]?.length || 0) + 1;

                setSessionCells(prev => {
                  const current = prev[sessionId] || [];
                  return {
                    ...prev,
                    [sessionId]: [...current, {
                      id: newCellId,
                      command: cmd,
                      executablePwd: sessionPwds[sessionId] || '~',
                      snapshot: null
                    }]
                  };
                });

                // Add to history
                setHistory(prev => {
                  if (!prev.includes(cmd)) return [cmd, ...prev].slice(0, 1000);
                  return prev;
                });

                // Lock the session
                sessionRunning.current[sessionId] = true;
                forceUpdate({});

                // Emit START instead of input so the backend assigns the cellId lock
                ws.send(JSON.stringify({ type: 'start', data: cmd, cellId: newCellId }));
              } else {
                // Empty enter, just pass it through
                ws.send(JSON.stringify({ type: 'input', data }));
              }
            }
            // Normal character
            else {
              // Ignore control sequences like arrows for the strict buffer for now,
              // just track raw printable text to name the cell.
              if (!data.startsWith('\x1b')) {
                buffer += data;
              }
              manualInputBuffers.current[sessionId] = buffer;
              // Always pass the raw input through to the PTY
              ws.send(JSON.stringify({ type: 'input', data }));
            }
          } else {
            // Already running something, pass through raw input
            ws.send(JSON.stringify({ type: 'input', data }));
          }
        }
      });

      terminal.onResize(({ cols, rows }) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'resize', cols, rows }));
        }
      });

      setSessionSockets(prev => ({ ...prev, [sessionId]: ws }));
    }
  }, [activeSessionId, sessionSockets]);

  const createNewSession = () => {
    const id = "sess-" + Math.random().toString(36).substring(2, 9);
    setSessions(prev => [...prev, { id, status: 'initializing' }]);
    setSessionCells(prev => ({ ...prev, [id]: [] }));
    setSessionQueues(prev => ({ ...prev, [id]: [] }));
    setActiveSessionId(id);
  };

  const activeCells = sessionCells[activeSessionId] || [];
  const activeWs = sessionSockets[activeSessionId];
  const activePwd = sessionPwds[activeSessionId] || '~';
  const activeTerminalData = activeSessionId ? getOrCreateTerminal(activeSessionId) : null;
  const activeTuiState = sessionTuiStates[activeSessionId];

  useEffect(() => {
    const observer = new MutationObserver(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    });

    if (scrollRef.current) {
      observer.observe(scrollRef.current, { childList: true, subtree: true, characterData: true });
    }
    return () => observer.disconnect();
  }, [activeSessionId, activeCells]);

  useEffect(() => {
    if (globalInput.length > 0) {
      const match = history.find(cmd => cmd.startsWith(globalInput));
      if (match && match !== globalInput) {
        setGhostText(match.slice(globalInput.length));
      } else {
        setGhostText('');
      }
    } else {
      setGhostText('');
    }
  }, [globalInput, history]);

  const handleDeleteSession = async (e, id) => {
    e.stopPropagation();
    try {
      const res = await fetch(`/api/sessions/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setSessions(prev => prev.filter(s => s.id !== id));
        setSessionCells(prev => {
          const newState = { ...prev };
          delete newState[id];
          return newState;
        });
        if (sessionTerminals.current[id]) {
          sessionTerminals.current[id].terminal.dispose();
          delete sessionTerminals.current[id];
        }
        if (activeSessionId === id) {
          setActiveSessionId(null);
        }
      }
    } catch (err) {
      console.error('Failed to delete session:', err);
    }
  };

  const handleGlobalInputKeyDown = (e) => {
    if (e.key === 'ArrowRight' && ghostText) {
      e.preventDefault();
      setGlobalInput(globalInput + ghostText);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (!globalInput.trim() || !activeSessionId) return;

      const cmd = globalInput.trim();

      if (!history.includes(cmd)) {
        setHistory(prev => [cmd, ...prev].slice(0, 1000));
      }

      const newCellId = (sessionCells[activeSessionId]?.length || 0) + 1;

      setSessionCells(prev => {
        const current = prev[activeSessionId] || [];
        return {
          ...prev,
          [activeSessionId]: [...current, {
            id: newCellId,
            command: cmd,
            executablePwd: activePwd,
            snapshot: null
          }]
        };
      });

      setSessionQueues(prev => {
        const current = prev[activeSessionId] || [];
        return {
          ...prev,
          [activeSessionId]: [...current, { id: newCellId, command: cmd }]
        };
      });

      setGlobalInput('');
      setGhostText('');

      setTimeout(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }, 50);
    }
  };

  const handleTuiExit = (sessionId, testSnapshot) => {
    setSessionTuiStates(prev => {
      const tuiState = prev[sessionId];
      if (tuiState && tuiState.cellId) {
        const snapshot = handleCreateSnapshot(sessionId, tuiState.cellId);
        if (snapshot !== null || testSnapshot) {
          setSessionCells(cellsPrev => {
            const cells = cellsPrev[sessionId] || [];
            return {
              ...cellsPrev,
              [sessionId]: cells.map(c => c.id === tuiState.cellId ? { ...c, snapshot: testSnapshot || snapshot || "" } : c)
            };
          });
        }
        if (sessionTerminals.current[sessionId]) {
          sessionTerminals.current[sessionId].terminal.reset();
        }
      }
      const newState = { ...prev };
      delete newState[sessionId];
      return newState;
    });
  };

  // Focus recovery
  useEffect(() => {
    if (!activeTuiState && inputRef.current) {
      inputRef.current.focus();
    }
  }, [activeTuiState]);

  // Expose directly to Playwright
  useEffect(() => {
    window.__TEST_TRIGGER_TUI_DETECT = () => {
      setSessionTuiStates(prev => ({
        ...prev,
        [activeSessionId]: { ws: sessionSockets[activeSessionId], cellId: (sessionCells[activeSessionId]?.length || 1) }
      }));
    };
    window.__TEST_TRIGGER_TUI_EXIT = (html) => handleTuiExit(activeSessionId, html);
    return () => {
      delete window.__TEST_TRIGGER_TUI_DETECT;
      delete window.__TEST_TRIGGER_TUI_EXIT;
    };
  }, [activeSessionId, sessionSockets, sessionCells]);

  const handleExportHistory = () => {
    const dataBlob = new Blob([JSON.stringify(history, null, 2)], { type: 'application/json' });
    const fileUrl = URL.createObjectURL(dataBlob);
    const dlAnchorElem = document.createElement('a');
    const fileName = (config.appName || 'termbook').toLowerCase() + '_history.json';
    dlAnchorElem.setAttribute("href", fileUrl);
    dlAnchorElem.setAttribute("download", fileName);
    dlAnchorElem.click();
    URL.revokeObjectURL(fileUrl);
  };

  const handleImportHistory = (event) => {
    const file = event.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const imported = JSON.parse(e.target.result);
          if (Array.isArray(imported)) {
            setHistory([...new Set([...imported, ...history])]);
          }
        } catch (error) {
          console.error("Invalid history file");
        }
      };
      reader.readAsText(file);
    }
  };

  return (
    <div className="app-container">
      <div className="sidebar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '24px' }}>
          <TerminalSquare size={24} color="var(--accent-cyan)" />
          <h1 style={{ fontSize: '16px', margin: 0, fontWeight: 600, letterSpacing: '0.5px' }}>{config.appTitle}</h1>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2>Sessions</h2>
          <button onClick={createNewSession} style={{ padding: '4px', border: 'none' }} title="New Session">
            <Plus size={14} />
          </button>
        </div>
        <ul style={{ marginBottom: '24px' }}>
          {sessions.map((s) => (
            <li
              key={s.id}
              className={activeSessionId === s.id ? 'active' : ''}
              onClick={() => setActiveSessionId(s.id)}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
                <Hash size={14} color={activeSessionId === s.id ? 'var(--accent-cyan)' : 'var(--text-muted)'} />
                <span style={{ marginLeft: '8px' }}># {s.id.substring(0, 8)}</span>
              </div>
              <span
                className="delete-session-btn"
                onClick={(e) => handleDeleteSession(e, s.id)}
                style={{ opacity: 0.6, fontSize: '14px', padding: '0 4px', cursor: 'pointer' }}
              >
                ×
              </span>
            </li>
          ))}
        </ul>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2>Command History</h2>
          <div style={{ display: 'flex', gap: '4px' }}>
            <button onClick={handleExportHistory} style={{ padding: '2px 6px', fontSize: '10px' }}>Export</button>
            <label className="button-label" style={{ padding: '2px 6px', fontSize: '10px' }}>
              Import
              <input type="file" accept=".json" style={{ display: 'none' }} onChange={handleImportHistory} />
            </label>
          </div>
        </div>
        <ul style={{ flex: 1, overflowY: 'auto' }}>
          {history.slice(0, 100).map((cmd, idx) => (
            <li key={idx} title={cmd}>
              <History size={14} color="var(--text-muted)" />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cmd}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="main-area">
        <div className="top-header">
          <div className="top-header-left">
            <div className="pwd-breadcrumb" title={activePwd}>
              <Folder size={14} color="var(--accent-cyan)" />
              {(() => {
                const parts = activePwd.split('/').filter(Boolean);
                if (parts.length <= 4) return activePwd.split('/').filter(Boolean).map((part, i, arr) => (
                  <React.Fragment key={i}>
                    <span>{part}</span>
                    <span className="pwd-separator">/</span>
                  </React.Fragment>
                ));
                return (
                  <>
                    <span className="pwd-separator">.../</span>
                    {parts.slice(-3).map((part, i, arr) => (
                      <React.Fragment key={i}>
                        <span>{part}</span>
                        <span className="pwd-separator">/</span>
                      </React.Fragment>
                    ))}
                  </>
                );
              })()}
              {activePwd === '/' && <span>/</span>}
            </div>
          </div>
          {activeTuiState && (
            <div className="tui-active-badge">
              <div className="pulse-dot"></div>
              TUI MODE ACTIVE
            </div>
          )}
        </div>

        <div className="notebook-content" ref={scrollRef}>
          {activeCells.map((cell, idx) => (
            <NotebookCell
              key={`${activeSessionId}-${cell.id}`}
              id={cell.id}
              activeTerminal={activeTerminalData}
              snapshot={cell.snapshot}
              initialCommand={cell.command}
              executablePwd={cell.executablePwd}
              isTuiActive={!!activeTuiState}
            />
          ))}
          <div style={{ height: '80px', flexShrink: 0 }} />
        </div>

        <div className="chat-input-container">
          <div className="chat-input-wrapper">
            <span className="pwd-prompt-prefix">
              {activePwd === '~' || activePwd === '/' ? activePwd : activePwd.split('/').pop()}&nbsp;❯
            </span>
            <div className="input-with-ghost">
              <input
                ref={inputRef}
                type="text"
                value={globalInput}
                onChange={(e) => setGlobalInput(e.target.value)}
                onKeyDown={handleGlobalInputKeyDown}
                placeholder="Enter terminal command..."
                disabled={!!activeTuiState}
                autoFocus
              />
              {ghostText && (
                <div className="global-ghost-text">
                  <span style={{ visibility: 'hidden' }}>{globalInput}</span>
                  <span>{ghostText}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {activeTuiState && (
        <TuiModal
          activeTerminal={activeTerminalData}
          onClose={() => handleTuiExit(activeSessionId)}
        />
      )}
    </div>
  );
}

export default App;
