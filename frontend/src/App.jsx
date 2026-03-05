import React, { useState, useEffect, useRef } from 'react';
import NotebookCell from './NotebookCell';
import TuiModal from './TuiModal';
import { Terminal } from 'xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SerializeAddon } from '@xterm/addon-serialize';
import 'xterm/css/xterm.css';
import { TerminalSquare, Plus, Folder, Hash } from 'lucide-react';
import './index.css';

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
  const inputRef = useRef(null);
  const scrollRef = useRef(null);

  useEffect(() => { sessionRunningRef.current = sessionRunning; }, [sessionRunning]);
  useEffect(() => { sessionSocketsRef.current = sessionSockets; }, [sessionSockets]);
  useEffect(() => { sessionCellsRef.current = sessionCells; }, [sessionCells]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [sessionCells, activeSessionId]);

  useEffect(() => {
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
    const id = "sess-" + Date.now() + "-" + Math.floor(Math.random() * 1000);
    setSessions(prev => {
        if (prev.some(s => s.id === id)) return prev;
        return [...prev, { id, status: 'initializing' }];
    });
    setSessionCells(prev => ({ ...prev, [id]: [] }));
    setActiveSessionId(id);
    const newUrl = new URL(window.location);
    newUrl.searchParams.set('session_id', id);
    newUrl.searchParams.delete('new_session');
    window.history.pushState({}, '', newUrl);
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
            if (msg.type === 'clear_history') {
                setSessionCells(prev => ({ ...prev, [sessionId]: (prev[sessionId] || []).filter(c => c.isRunning) }));
            } else if (msg.type === 'session_init') {
                if (msg.pwd) setSessionPwds(prev => ({ ...prev, [sessionId]: msg.pwd }));
                if (msg.cells) {
                    setSessionCells(prev => ({ ...prev, [sessionId]: msg.cells }));
                    setSessionRunning(prev => ({ ...prev, [sessionId]: msg.cells.some(c => c.isRunning) }));
                }
                if (msg.isTuiActive) setSessionTuiStates(prev => ({ ...prev, [sessionId]: { cellId: msg.activeCellId } }));
            } else if (msg.type === 'new_cell') {
                const newCellId = msg.cellId || `cell-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
                setSessionCells(prev => {
                    const currentCells = prev[sessionId] || [];
                    if (currentCells.some(c => c.id === newCellId)) return prev;
                    return { ...prev, [sessionId]: [...currentCells, { id: newCellId, command: msg.command, output: "", isRunning: true }] };
                });
                setSessionRunning(prev => ({ ...prev, [sessionId]: true }));
            } else if (msg.type === 'tui_enter') {
                setSessionTuiStates(prev => ({ ...prev, [sessionId]: { cellId: msg.activeCellId } }));
            } else if (msg.type === 'tui_exit') {
                setSessionTuiStates(prev => { const n = {...prev}; delete n[sessionId]; return n; });
            } else if (msg.type === 'output') {
                const cells = (sessionCellsRef.current[sessionId] || []);
                const cell = cells.find(c => c.id === msg.cellId);
                if (!cell || !cell.isRunning) return;
                const termData = getOrCreateTerminal(sessionId, msg.cellId);
                if (msg.data.includes('\x1b[2J') || msg.data.includes('\x1b[3J')) {
                    termData.terminal.clear(); termData.terminal.reset();
                }
                termData.terminal.write(msg.data);
            } else if (msg.type === 'exit') {
                const { cellId, pwd, snapshotAnsi } = msg;
                setSessionCells(prev => ({ ...prev, [sessionId]: (prev[sessionId] || []).map(c => c.id === cellId ? { ...c, isRunning: false, snapshotAnsi } : c) }));
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
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const cmd = inputValue.trim();
      if (!cmd || !activeSessionId) return;
      
      const cellId = `cell-${Date.now()}`;
      setSessionCells(prev => {
          const currentCells = prev[activeSessionId] || [];
          if (currentCells.some(c => c.id === cellId)) return prev;
          return { ...prev, [activeSessionId]: [...currentCells, { id: cellId, command: cmd, executablePwd: sessionPwds[activeSessionId], output: "", isRunning: true }] };
      });
      setSessionRunning(prev => ({ ...prev, [activeSessionId]: true }));
      
      const ws = sessionSockets[activeSessionId];
      if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'start', data: cmd, cellId }));
      setInputValue('');
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  };

  const activeTuiState = sessionTuiStates[activeSessionId];

  return (
    <div className="app-container">
      <div className="sidebar">
        <div className="sidebar-header"><TerminalSquare size={24} color="var(--accent-cyan)" /><h1>{config.appTitle}</h1></div>
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'12px'}}>
            <h2>SESSIONS</h2>
            <button onClick={createNewSession} style={{background:'none', border:'none', color:'var(--accent-cyan)', cursor:'pointer'}} title="New Session"><Plus size={16}/></button>
        </div>
        <ul>{sessions.map(s => <li key={s.id} className={activeSessionId === s.id ? 'active' : ''} onClick={() => switchSession(s.id)}><Hash size={14}/><span>{String(s.id).substring(0,14)}</span></li>)}</ul>
      </div>
      <div className="main-area">
        <div className="top-header">
           <div className="pwd-breadcrumb"><Folder size={14} color="var(--accent-cyan)" />{sessionPwds[activeSessionId] || '~'}</div>
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
        <div className="notebook-content" ref={scrollRef}>
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
                requestResize={(cols, rows) => {
                    const ws = sessionSockets[activeSessionId];
                    if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'resize', cols, rows }));
                }}
            />
          ))}
          <div style={{ height: '100px', flexShrink: 0 }} />
        </div>
        <div className="chat-input-container">
          <div className="chat-input-wrapper">
            <span className="pwd-prompt-prefix">termbook ❯</span>
            <textarea
                ref={inputRef} value={inputValue}
                onChange={(e) => { setInputValue(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px'; }}
                onKeyDown={handleCommand} placeholder="Enter terminal command..."
                disabled={sessionRunning[activeSessionId] || !!activeTuiState} rows={1}
                style={{ resize: 'none', overflowY: 'auto', minHeight: '24px' }}
            />
          </div>
        </div>
      </div>
      {activeTuiState && <TuiModal activeTerminal={getOrCreateTerminal(activeSessionId, activeTuiState.cellId)} />}
    </div>
  );
}
export default App;
