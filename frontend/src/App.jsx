import React, { useState, useEffect, useRef } from 'react';
import NotebookCell from './NotebookCell';
import TuiModal from './TuiModal';
import { TerminalSquare, History, Plus, Folder, Hash } from 'lucide-react';
import './index.css';

function App() {
  const [sessions, setSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [config, setConfig] = useState({ appName: 'Termbook', appTitle: 'TERMBOOK' });

  // Data keyed by sessionId
  const [sessionCells, setSessionCells] = useState({});
  const [sessionPwds, setSessionPwds] = useState({});
  const [sessionSockets, setSessionSockets] = useState({});

  const [history, setHistory] = useState([]);
  const [activeTuiWs, setActiveTuiWs] = useState(null);

  const [globalInput, setGlobalInput] = useState('');
  const [ghostText, setGhostText] = useState('');
  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  // Load existing sessions and history on mount
  useEffect(() => {
    fetch('/api/sessions')
      .then(res => res.json())
      .then(data => {
        if (data.sessions && data.sessions.length > 0) {
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
  }, []);

  // Connect WS when active session changes
  useEffect(() => {
    if (!activeSessionId) return;

    if (!sessionSockets[activeSessionId]) {
      const wsUrl = `ws://${window.location.host}/ws`;
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'join_session', sessionId: activeSessionId }));
      };

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'session_init') {
          setSessionPwds(prev => ({ ...prev, [activeSessionId]: msg.pwd }));
          // Do not initialize an empty cell anymore; wait for user input.
        }
      };

      // Expose to window for Playwright Mocks
      window._activeSessionWs = ws;

      const testMsgListener = (e) => {
        if (e.data && e.data.type === 'TEST_WS_RECEIVE') {
          // Manually trigger the handler
          if (ws.onmessage) {
            ws.onmessage({ data: JSON.stringify(e.data.payload) });
          }
          // The notebook cells attach their own `addEventListener`, so dispatch there too
          ws.dispatchEvent(new MessageEvent('message', {
            data: JSON.stringify(e.data.payload)
          }));
        }
      };

      window.addEventListener('message', testMsgListener);

      setSessionSockets(prev => ({ ...prev, [activeSessionId]: ws }));

      return () => {
        window.removeEventListener('message', testMsgListener);
      }
    }
  }, [activeSessionId, sessionSockets]);

  const createNewSession = () => {
    const id = "sess-" + Math.random().toString(36).substring(2, 9);
    setSessions(prev => [...prev, { id, status: 'initializing' }]);
    setSessionCells(prev => ({ ...prev, [id]: [] }));
    setActiveSessionId(id);
  };

  const activeCells = sessionCells[activeSessionId] || [];
  const activeWs = sessionSockets[activeSessionId];
  const activePwd = sessionPwds[activeSessionId] || '~';

  const handleCommandFinish = (command, newPwd) => {
    // If the command is actually completed, update PWD
    if (newPwd) {
      setSessionPwds(prev => ({ ...prev, [activeSessionId]: newPwd }));
    }
  };

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

      // Update history
      if (!history.includes(cmd)) {
        setHistory(prev => [cmd, ...prev].slice(0, 1000));
      }

      // Add actual execution cell
      setSessionCells(prev => {
        const current = prev[activeSessionId] || [];
        return {
          ...prev,
          [activeSessionId]: [...current, { id: current.length + 1, command: cmd }]
        };
      });

      setGlobalInput('');
      setGhostText('');

      // Auto scroll immediately to make room for block
      setTimeout(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }, 50);
    }
  };

  const handleTuiDetect = (ws, cellId) => {
    setActiveTuiWs({ ws, cellId });
  };

  const handleTuiExit = (htmlSnapshot) => {
    setActiveTuiWs(prevWsState => {
      if (prevWsState && prevWsState.cellId) {
        setSessionCells(prev => {
          const cells = prev[activeSessionId] || [];
          return {
            ...prev,
            [activeSessionId]: cells.map(c => c.id === prevWsState.cellId ? { ...c, snapshot: htmlSnapshot } : c)
          };
        });
      }
      return null;
    });
  };

  // Expose directly to Playwright to bypass headless Xterm buffer parsing races
  useEffect(() => {
    window.__TEST_TRIGGER_TUI_DETECT = () => handleTuiDetect(sessionSockets[activeSessionId], 1);
    window.__TEST_TRIGGER_TUI_EXIT = (html) => handleTuiExit(html || '<div class="fake-snap"></div>');
    return () => {
      delete window.__TEST_TRIGGER_TUI_DETECT;
      delete window.__TEST_TRIGGER_TUI_EXIT;
    };
  }, [activeSessionId, sessionSockets]);

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
      {/* GLASSSMORPHISM SIDEBAR */}
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
        {/* PWD BREADCRUMB HEADER */}
        <div className="top-header">
          <div className="pwd-breadcrumb">
            <Folder size={14} color="var(--accent-cyan)" />
            {activePwd.split('/').filter(Boolean).map((part, i, arr) => (
              <React.Fragment key={i}>
                <span>{part}</span>
                {i < arr.length - 1 && <span className="pwd-separator">/</span>}
              </React.Fragment>
            ))}
            {activePwd === '/' && <span>/</span>}
          </div>
        </div>

        {/* TERMINAL CELLS */}
        <div className="notebook-content" ref={scrollRef}>
          {activeCells.map((cell, idx) => (
            <NotebookCell
              key={`${activeSessionId}-${cell.id}`}
              id={cell.id}
              globalWs={activeWs}
              commandHistory={history}
              snapshot={cell.snapshot}
              initialCommand={cell.command}
              onTuiDetect={(ws) => handleTuiDetect(ws, cell.id)}
              onTuiExit={handleTuiExit}
              onCommandFinish={handleCommandFinish}
            />
          ))}
          {/* Spacer to prevent input occlusion */}
          <div style={{ height: '80px', flexShrink: 0 }} />
        </div>

        {/* GLOBAL CHAT INPUT */}
        <div className="chat-input-container">
          <div className="chat-input-wrapper">
            <span className="pwd-prompt-prefix">
              {activePwd === '~' || activePwd === '/' ? activePwd : activePwd.split('/').pop()}&nbsp;❯
            </span>
            <input
              ref={inputRef}
              type="text"
              value={globalInput}
              onChange={(e) => setGlobalInput(e.target.value)}
              onKeyDown={handleGlobalInputKeyDown}
              placeholder="Enter terminal command..."
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

      <TuiModal
        activeWebSocket={activeTuiWs?.ws}
        onClose={handleTuiExit}
        cellId={activeTuiWs?.cellId}
      />
    </div>
  );
}

export default App;
