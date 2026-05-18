import React, { useState, useEffect, useRef } from 'react';
import NotebookCell from './NotebookCell';
import TuiModal from './TuiModal';
import { Terminal } from 'xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SerializeAddon } from '@xterm/addon-serialize';
import 'xterm/css/xterm.css';
import { TerminalSquare, Plus, Folder, Hash, X, ChevronDown } from 'lucide-react';
import './index.css';

function shortenPath(p) {
  if (!p) return '~';
  const home = '/Users/';
  let s = p;
  const hm = s.match(/^\/Users\/[^/]+/);
  if (hm) s = '~' + s.substring(hm[0].length);
  const segs = s.split('/');
  if (segs.length <= 4) return s;
  return [segs[0], '…', ...segs.slice(-2)].join('/');
}

function App() {
  const [sessions, setSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [config, setConfig] = useState({ appName: 'Termbook', appTitle: 'TERMBOOK' });
  const [sessionCells, setSessionCells] = useState({});
  const [sessionPwds, setSessionPwds] = useState({});
  const [sessionSockets, setSessionSockets] = useState({});
  const [sessionTuiStates, setSessionTuiStates] = useState({});
  const [sessionRunning, setSessionRunning] = useState({});
  const [inputValue, setInputValue] = useState('');
  
  const sessionRunningRef = useRef({});
  const sessionSocketsRef = useRef({});
  const sessionCellsRef = useRef({});
  const sessionTerminals = useRef({});
  const lastResizePerSession = useRef({});
  const inputRef = useRef(null);
  const scrollRef = useRef(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const refocusInput = () => setFocusRequest(n => n + 1);

  const HISTORY_KEY = 'termbook.history.v1';
  const [history, setHistory] = useState(() => {
    try { const raw = localStorage.getItem(HISTORY_KEY); if (raw) return JSON.parse(raw); } catch {}
    return [];
  });
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [draftBeforeHistory, setDraftBeforeHistory] = useState('');
  const pushHistory = (cmd) => {
    setHistory(prev => {
      const next = (prev[prev.length - 1] === cmd ? prev : [...prev, cmd]).slice(-500);
      try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
    setHistoryIdx(-1);
  };

  useEffect(() => { sessionRunningRef.current = sessionRunning; }, [sessionRunning]);
  useEffect(() => { sessionSocketsRef.current = sessionSockets; }, [sessionSockets]);
  useEffect(() => { sessionCellsRef.current = sessionCells; }, [sessionCells]);

  const isInputUsable = activeSessionId && !sessionRunning[activeSessionId] && !sessionTuiStates[activeSessionId];
  useEffect(() => {
    if (isInputUsable && inputRef.current) {
      const id = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
  }, [isInputUsable, focusRequest]);

  useEffect(() => {
    const onKey = (e) => {
      const ae = document.activeElement;
      const inTextField = ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable);
      const inTui = !!sessionTuiStates[activeSessionId];
      if (inTui) return;
      if (e.key === 'Escape' && inputRef.current) { inputRef.current.focus(); return; }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'l' || e.key === 'L')) {
        e.preventDefault();
        const ws = sessionSockets[activeSessionId];
        if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'input', data: 'clear\r' }));
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        return;
      }
      if (!inTextField && isInputUsable && inputRef.current && !e.metaKey && !e.ctrlKey && !e.altKey && e.key.length === 1) {
        inputRef.current.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isInputUsable, activeSessionId, sessionTuiStates, sessionSockets]);

  const userScrolledUpRef = useRef(false);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  const lastCellCountRef = useRef(0);
  const SCROLL_BOTTOM_THRESHOLD = 120;
  useEffect(() => {
    const sc = scrollRef.current; if (!sc) return;
    const onScroll = () => {
      const distFromBottom = sc.scrollHeight - sc.scrollTop - sc.clientHeight;
      const isUp = distFromBottom > SCROLL_BOTTOM_THRESHOLD;
      userScrolledUpRef.current = isUp;
      setShowJumpToBottom(isUp);
    };
    sc.addEventListener('scroll', onScroll, { passive: true });
    return () => sc.removeEventListener('scroll', onScroll);
  }, []);

  const cells = sessionCells[activeSessionId] || [];
  useEffect(() => {
    const sc = scrollRef.current; if (!sc) return;
    const cellCount = cells.length;
    const prevCount = lastCellCountRef.current;
    lastCellCountRef.current = cellCount;
    if (cellCount === 0) return;

    if (cellCount > prevCount) {
      requestAnimationFrame(() => {
        if (!scrollRef.current) return;
        const lastCell = scrollRef.current.querySelector('.notebook-cell:last-of-type');
        if (lastCell) {
          const offset = lastCell.offsetTop - 16;
          scrollRef.current.scrollTop = offset;
          userScrolledUpRef.current = false;
          setShowJumpToBottom(false);
        }
      });
      return;
    }

    if (!userScrolledUpRef.current) {
      const lastCell = sc.querySelector('.notebook-cell:last-of-type');
      if (lastCell) {
        const offset = lastCell.offsetTop - 16;
        if (sc.scrollTop < offset) sc.scrollTop = offset;
      }
    }
  }, [cells]);

  useEffect(() => {
    const sc = scrollRef.current; if (!sc) return;
    userScrolledUpRef.current = false;
    setShowJumpToBottom(false);
    lastCellCountRef.current = (sessionCells[activeSessionId] || []).length;
    sc.scrollTop = sc.scrollHeight;
  }, [activeSessionId]);

  const jumpToBottom = () => {
    const sc = scrollRef.current; if (!sc) return;
    userScrolledUpRef.current = false;
    setShowJumpToBottom(false);
    sc.scrollTo({ top: sc.scrollHeight, behavior: 'smooth' });
  };

  const bootstrappedRef = useRef(false);
  useEffect(() => {
    if (bootstrappedRef.current) return;
    bootstrappedRef.current = true;
    const urlParams = new URLSearchParams(window.location.search);
    const forceNew = urlParams.get('new_session') === 'true';
    const existingId = urlParams.get('session_id');
    const apiBase = window.location.origin.replace(':4000', ':4001');

    fetch(`${apiBase}/api/sessions`).then(res => res.json()).then(data => {
      if (!forceNew && data.sessions && data.sessions.length > 0) {
        setSessions(data.sessions);
        const targetId = existingId || data.sessions[0].id;
        setActiveSessionId(targetId);
        data.sessions.forEach(s => {
          if (s.pwd) setSessionPwds(prev => ({ ...prev, [s.id]: s.pwd }));
          if (s.cells) setSessionCells(prev => ({ ...prev, [s.id]: s.cells }));
        });
      } else { createNewSession(); }
    }).catch(() => createNewSession());
    fetch(`${apiBase}/api/config`).then(res => res.json()).then(data => setConfig(data));
  }, []);

  const switchSession = (sessionId) => {
    setActiveSessionId(sessionId);
    const newUrl = new URL(window.location);
    newUrl.searchParams.set('session_id', sessionId);
    window.history.pushState({}, '', newUrl);
    
    const apiBase = window.location.origin.replace(':4000', ':4001');
    fetch(`${apiBase}/api/sessions/${sessionId}`).then(res => res.json()).then(data => {
        if (data.cells) setSessionCells(prev => ({ ...prev, [sessionId]: data.cells }));
        if (data.pwd) setSessionPwds(prev => ({ ...prev, [sessionId]: data.pwd }));
        setTimeout(() => inputRef.current?.focus(), 100);
    }).catch(() => {});
  };

  const createNewSession = () => {
    const rand = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID().slice(0, 8)
        : Math.random().toString(36).slice(2, 10);
    const id = "sess-" + Date.now() + "-" + rand;
    setSessions(prev => prev.some(s => s.id === id) ? prev : [...prev, { id, status: 'initializing' }]);
    setSessionCells(prev => ({ ...prev, [id]: [] }));
    setActiveSessionId(id);
    const newUrl = new URL(window.location);
    newUrl.searchParams.set('session_id', id);
    newUrl.searchParams.delete('new_session');
    window.history.pushState({}, '', newUrl);
    return id;
  };

  const removeSessionLocally = (sessionId) => {
    setSessions(prev => prev.filter(s => s.id !== sessionId));
    setSessionCells(prev => { const n = { ...prev }; delete n[sessionId]; return n; });
    setSessionPwds(prev => { const n = { ...prev }; delete n[sessionId]; return n; });
    setSessionSockets(prev => {
        const n = { ...prev };
        if (n[sessionId]) { try { n[sessionId].onclose = null; n[sessionId].close(); } catch {} }
        delete n[sessionId];
        return n;
    });
    setSessionRunning(prev => { const n = { ...prev }; delete n[sessionId]; return n; });
    setSessionTuiStates(prev => { const n = { ...prev }; delete n[sessionId]; return n; });
    if (activeSessionId === sessionId) {
        setActiveSessionId(prevId => {
            const remaining = sessions.filter(s => s.id !== sessionId);
            return remaining.length > 0 ? remaining[0].id : null;
        });
    }
  };

  const deleteSession = (sessionId) => {
    const apiBase = window.location.origin.replace(':4000', ':4001');
    fetch(`${apiBase}/api/sessions/${sessionId}`, { method: 'DELETE' })
        .catch(() => {})
        .finally(() => removeSessionLocally(sessionId));
  };

  const requestResizeFor = (sessionId) => (cols, rows) => {
    const ws = sessionSockets[sessionId];
    if (!ws || ws.readyState !== 1) return;
    const last = lastResizePerSession.current[sessionId];
    if (last && last.cols === cols && last.rows === rows) return;
    lastResizePerSession.current[sessionId] = { cols, rows };
    ws.send(JSON.stringify({ type: 'resize', cols, rows }));
  };

  const getOrCreateTerminal = (sessionId, cellId = null) => {
    const key = `${sessionId}-${cellId}`;
    if (sessionTerminals.current[key]) return sessionTerminals.current[key];
    const terminal = new Terminal({
      theme: { background: '#000000', foreground: '#e0e5ff', cursor: '#00ecec' },
      convertEol: true, cursorBlink: false, cursorStyle: 'block',
      fontFamily: '"JetBrains Mono", monospace', fontSize: 13, allowProposedApi: true,
      rows: 24, cols: 120, rendererType: 'dom'
    });
    if (typeof document !== 'undefined') {
        const div = document.createElement('div');
        div.style.position = 'absolute'; div.style.left = '-9999px';
        terminal.open(div);
    }
    const fitAddon = new FitAddon();
    const serializeAddon = new SerializeAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(serializeAddon);
    terminal.onData(data => { 
        if (sessionRunningRef.current[sessionId]) {
            const ws = sessionSocketsRef.current[sessionId];
            if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'input', data })); 
        }
    });
    sessionTerminals.current[key] = { terminal, fitAddon, serializeAddon };
    return sessionTerminals.current[key];
  };

  useEffect(() => {
    if (!activeSessionId) return;
    const sessionId = activeSessionId;
    let ws = null;
    let reconnectTimeout = null;
    let retryCount = 0;

    const connectWebSocket = () => {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host;
        ws = new WebSocket(`${protocol}//${host}/ws`);
        
        ws.onopen = () => {
            console.log(`[WS] Connected to session ${sessionId}`);
            setSessionSockets(prev => ({ ...prev, [sessionId]: ws }));
            ws.send(JSON.stringify({ type: 'join_session', sessionId, cols: 120, rows: 24 }));
            retryCount = 0;
        };

        ws.onmessage = (event) => {
            const msg = JSON.parse(event.data);
            if (msg.type === 'session_destroyed') {
                removeSessionLocally(msg.sessionId);
                return;
            }
            if (msg.type === 'clear_history') {
                setSessionCells(prev => ({ ...prev, [sessionId]: (prev[sessionId] || []).filter(c => c.isRunning) }));
            } else if (msg.type === 'session_init') {
                if (msg.pwd) setSessionPwds(prev => ({ ...prev, [sessionId]: msg.pwd }));
                if (msg.cells) {
                    setSessionCells(prev => ({ ...prev, [sessionId]: msg.cells }));
                    setSessionRunning(prev => ({ ...prev, [sessionId]: msg.cells.some(c => c.isRunning) }));
                }
                if (msg.isTuiActive) setSessionTuiStates(prev => ({ ...prev, [sessionId]: { cellId: msg.activeCellId ?? msg.cellId } }));
            } else if (msg.type === 'new_cell') {
                const newCellId = msg.cellId || `cell-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
                setSessionCells(prev => {
                    const currentCells = prev[sessionId] || [];
                    if (currentCells.some(c => c.id === newCellId)) return prev;
                    return { ...prev, [sessionId]: [...currentCells, { id: newCellId, command: msg.command, output: "", isRunning: true, startedAt: Date.now() }] };
                });
                setSessionRunning(prev => ({ ...prev, [sessionId]: true }));
            } else if (msg.type === 'tui_enter') {
                setSessionTuiStates(prev => ({ ...prev, [sessionId]: { cellId: msg.activeCellId ?? msg.cellId } }));
            } else if (msg.type === 'tui_exit') {
                setSessionTuiStates(prev => { const n = {...prev}; delete n[sessionId]; return n; });
            } else if (msg.type === 'output') {
                const cells = (sessionCellsRef.current[sessionId] || []);
                const cell = cells.find(c => c.id === msg.cellId);
                if (!cell || !cell.isRunning) return;
                const termData = getOrCreateTerminal(sessionId, msg.cellId);
                termData.terminal.write(msg.data);
            } else if (msg.type === 'exit') {
                const { cellId, pwd, snapshotAnsi, exitCode, usedTui } = msg;
                setSessionCells(prev => ({ ...prev, [sessionId]: (prev[sessionId] || []).map(c => c.id === cellId ? { ...c, isRunning: false, snapshotAnsi, exitCode, finishedAt: Date.now(), usedTui } : c) }));
                setSessionRunning(prev => ({ ...prev, [sessionId]: false }));
                if (pwd) setSessionPwds(prev => ({ ...prev, [sessionId]: pwd }));
                const termData = sessionTerminals.current[`${sessionId}-${cellId}`];
                if (termData) { termData.terminal.dispose(); delete sessionTerminals.current[`${sessionId}-${cellId}`]; }
            }
        };

        ws.onclose = () => {
            console.warn(`[WS] Connection closed for ${sessionId}. Retrying...`);
            setSessionSockets(prev => { const n = {...prev}; delete n[sessionId]; return n; });
            const delay = Math.min(1000 * Math.pow(2, retryCount), 30000);
            reconnectTimeout = setTimeout(() => {
                retryCount++;
                connectWebSocket();
            }, delay);
        };
    };

    connectWebSocket();
    return () => { 
        if (ws) { ws.onclose = null; ws.close(); }
        if (reconnectTimeout) clearTimeout(reconnectTimeout);
    };
  }, [activeSessionId]);

  const handleCommand = (e) => {
    const isMultiline = inputValue.includes('\n');
    if (e.key === 'ArrowUp' && !e.shiftKey && !isMultiline) {
      if (history.length === 0) return;
      e.preventDefault();
      if (historyIdx === -1) setDraftBeforeHistory(inputValue);
      const newIdx = historyIdx === -1 ? history.length - 1 : Math.max(0, historyIdx - 1);
      setHistoryIdx(newIdx);
      setInputValue(history[newIdx]);
      return;
    }
    if (e.key === 'ArrowDown' && !e.shiftKey && historyIdx !== -1) {
      e.preventDefault();
      const newIdx = historyIdx + 1;
      if (newIdx >= history.length) {
        setHistoryIdx(-1);
        setInputValue(draftBeforeHistory);
      } else {
        setHistoryIdx(newIdx);
        setInputValue(history[newIdx]);
      }
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const cmd = inputValue.trim();
      if (!cmd || !activeSessionId) return;
      pushHistory(cmd);
      setDraftBeforeHistory('');

      const cellId = `cell-${Date.now()}`;
      setSessionCells(prev => {
          const currentCells = prev[activeSessionId] || [];
          if (currentCells.some(c => c.id === cellId)) return prev;
          return { ...prev, [activeSessionId]: [...currentCells, { id: cellId, command: cmd, executablePwd: sessionPwds[activeSessionId], output: "", isRunning: true, startedAt: Date.now() }] };
      });
      setSessionRunning(prev => ({ ...prev, [activeSessionId]: true }));

      const ws = sessionSockets[activeSessionId];
      if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'start', data: cmd, cellId }));
      setInputValue('');

      requestAnimationFrame(() => {
        const sc = scrollRef.current;
        if (!sc) return;
        const newCell = sc.querySelector(`[data-cell-id="${cellId}"]`);
        if (newCell) {
          sc.scrollTop = newCell.offsetTop - 16;
        } else {
          sc.scrollTop = sc.scrollHeight;
        }
        userScrolledUpRef.current = false;
        setShowJumpToBottom(false);
      });
    }
  };

  const activeTuiState = sessionTuiStates[activeSessionId];

  return (
    <div className="app-container">
      <div className="sidebar">
        <div className="sidebar-header"><TerminalSquare size={24} color="var(--accent-cyan)" /><h1>{config.appTitle}</h1></div>
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'12px'}}>
            <h2>SESSIONS</h2>
            <button onClick={() => { createNewSession(); refocusInput(); }} style={{background:'none', border:'none', color:'var(--accent-cyan)', cursor:'pointer'}} title="New Session"><Plus size={16}/></button>
        </div>
        <ul>{sessions.map(s => {
          const sid = String(s.id);
          const label = sid.length > 18 ? `${sid.slice(0, 9)}…${sid.slice(-4)}` : sid;
          return (
            <li key={s.id} data-session-id={s.id} className={activeSessionId === s.id ? 'active' : ''} onClick={() => { switchSession(s.id); refocusInput(); }} title={sid}>
              <Hash size={14}/>
              <span style={{ flex: 1 }}>{label}</span>
              <button
                className="session-delete-btn"
                title="Delete session"
                onClick={(e) => { e.stopPropagation(); deleteSession(s.id); }}
              ><X size={12}/></button>
            </li>
          );
        })}</ul>
      </div>
      <div className="main-area">
        <div className="top-header">
           <div className="pwd-breadcrumb" title={sessionPwds[activeSessionId] || ''}>
             <Folder size={14} color="var(--accent-cyan)" />
             <span className="pwd-breadcrumb-text">{shortenPath(sessionPwds[activeSessionId] || '~')}</span>
           </div>
           <div style={{display:'flex', gap:'8px', alignItems:'center'}}>
             {(sessionCells[activeSessionId] || []).length > 500 && (
               <div className="memory-warning-badge" title="High memory usage may slow down the UI">MEMORY HIGH</div>
             )}
             <button 
                onClick={() => {
                    const ws = sessionSockets[activeSessionId];
                    if (ws) ws.send(JSON.stringify({ type: 'input', data: 'clear\r' }));
                }}
                className="clear-history-btn"
             >Clear History</button>
             {activeTuiState && <div className="tui-active-badge">TUI ACTIVE</div>}
           </div>
        </div>
        <div className="notebook-content" ref={scrollRef} onClick={(e) => {
          const sel = window.getSelection?.();
          if (sel && sel.toString().length > 0) return;
          const t = e.target;
          if (t && t.closest && (t.closest('.snapshot-output') || t.closest('button') || t.closest('a') || t.closest('.live-terminal'))) return;
          if (isInputUsable) refocusInput();
        }}>
          {activeSessionId && Array.isArray(sessionCells[activeSessionId]) && sessionCells[activeSessionId].length === 0 && (
            <div className="empty-state">
              <TerminalSquare size={48} color="var(--accent-cyan)" strokeWidth={1.2} />
              <h2>Welcome to Termbook</h2>
              <p>Run shell commands like you would in any terminal. Each command becomes a cell.</p>
              <div className="empty-state-tips">
                <div className="tip"><kbd>Enter</kbd> run command</div>
                <div className="tip"><kbd>Shift</kbd>+<kbd>Enter</kbd> new line</div>
                <div className="tip"><kbd>↑</kbd> / <kbd>↓</kbd> history</div>
                <div className="tip"><kbd>Esc</kbd> focus input</div>
              </div>
              <div className="empty-state-examples">
                <span>Try:</span>
                {['ls -al', 'pwd', 'vim file.txt', 'top'].map(ex => (
                  <button key={ex} className="example-chip" onClick={() => { setInputValue(ex); refocusInput(); }}>{ex}</button>
                ))}
              </div>
            </div>
          )}
          {(sessionCells[activeSessionId] || []).map(c => (
            <NotebookCell 
                key={c.id} 
                id={c.id} 
                snapshotAnsi={c.snapshotAnsi} 
                initialCommand={c.command} 
                executablePwd={c.executablePwd} 
                activeTerminal={getOrCreateTerminal(activeSessionId, c.id)} 
                isRunning={sessionRunning[activeSessionId] && !c.snapshotAnsi} 
                isTuiActive={activeTuiState?.cellId === c.id}
                requestResize={requestResizeFor(activeSessionId)}
                exitCode={c.exitCode}
                startedAt={c.startedAt}
                finishedAt={c.finishedAt}
                usedTui={c.usedTui}
                onRerun={(cmd) => { setInputValue(cmd); refocusInput(); }}
            />
          ))}
          <div style={{ height: 'calc(100vh - 240px)', flexShrink: 0 }} />
        </div>
        {showJumpToBottom && (
          <button className="jump-to-bottom" onClick={jumpToBottom} title="Jump to bottom">
            <ChevronDown size={16} /> <span>Jump to latest</span>
          </button>
        )}
        <div className="chat-input-container">
          <div className={`chat-input-wrapper${sessionRunning[activeSessionId] ? ' is-running' : ''}${activeTuiState ? ' is-tui' : ''}`}>
            <span className="pwd-prompt-prefix">
              {sessionRunning[activeSessionId] ? <span className="running-spinner" aria-hidden="true" /> : <span>termbook ❯</span>}
            </span>
            <textarea
                ref={inputRef} value={inputValue}
                onChange={(e) => {
                    setInputValue(e.target.value);
                    if (historyIdx !== -1 && e.target.value !== history[historyIdx]) setHistoryIdx(-1);
                    e.target.style.height = 'auto';
                    e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px';
                }}
                onKeyDown={handleCommand}
                placeholder={sessionRunning[activeSessionId] ? 'Command running…' : activeTuiState ? 'TUI active — interact in the modal above' : 'Enter terminal command…'}
                disabled={sessionRunning[activeSessionId] || !!activeTuiState} rows={1}
                autoFocus
                spellCheck={false}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                style={{ resize: 'none', overflowY: 'auto', minHeight: '24px' }}
            />
          </div>
        </div>
      </div>
      {activeTuiState && <TuiModal activeTerminal={getOrCreateTerminal(activeSessionId, activeTuiState.cellId)} requestResize={requestResizeFor(activeSessionId)} />}
    </div>
  );
}
export default App;
