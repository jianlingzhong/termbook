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
  const [suggestion, setSuggestion] = useState('');
  const [inputValue, setInputValue] = useState('');
  
  const sessionRunningRef = useRef({});
  const sessionSocketsRef = useRef({});
  const creatingSockets = useRef(new Set());
  const sessionTerminals = useRef({});
  const sessionDimsRef = useRef({});
  const sessionTuiStatesRef = useRef({});
  const inputRef = useRef(null);
  const scrollRef = useRef(null);

  useEffect(() => { sessionRunningRef.current = sessionRunning; }, [sessionRunning]);
  useEffect(() => { sessionSocketsRef.current = sessionSockets; }, [sessionSockets]);
  useEffect(() => { sessionTuiStatesRef.current = sessionTuiStates; }, [sessionTuiStates]);

  useEffect(() => {
    if (scrollRef.current) {
        setTimeout(() => {
            if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }, 200);
    }
  }, [sessionCells, activeSessionId]);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const forceNew = urlParams.get('new_session') === 'true';

    fetch('/api/sessions').then(res => res.json()).then(data => {
      if (!forceNew && data.sessions && data.sessions.length > 0) {
        setSessions(data.sessions);
        setActiveSessionId(data.sessions[0].id);
        data.sessions.forEach(s => {
          if (s.pwd) setSessionPwds(prev => ({ ...prev, [s.id]: s.pwd }));
          if (s.cells) {
              const cells = s.cells.map(c => {
                  if (c.output && !c.snapshot) {
                      const cleanOutput = c.output.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
                      return { ...c, snapshot: `<div style="color: #e0e5ff; font-family: 'JetBrains Mono', monospace; white-space: pre; overflow-x: auto; font-size: 13px; line-height: 1.5;">${cleanOutput}</div>` };
                  }
                  return c;
              });
              setSessionCells(prev => ({ ...prev, [s.id]: cells }));
          }
        });
      } else { 
        createNewSession(); 
        if (forceNew) {
            window.history.replaceState({}, '', window.location.pathname);
        }
      }
    }).catch(() => createNewSession());
    fetch('/api/config').then(res => res.json()).then(data => setConfig(data));
  }, []);

  useEffect(() => {
    const handleCloseDebug = () => {
        setSessionTuiStates({});
    };
    window.addEventListener('close-tui-debug', handleCloseDebug);
    return () => window.removeEventListener('close-tui-debug', handleCloseDebug);
  }, []);

  const switchSession = (sessionId) => {
    setActiveSessionId(sessionId);
    setInputValue('');
    setSuggestion('');
    
    fetch(`/api/sessions/${sessionId}`).then(res => res.json()).then(data => {
        if (data.cells) {
            const cells = data.cells.map(c => {
                if (c.output && !c.snapshot) {
                    const cleanOutput = c.output.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
                    return { ...c, snapshot: `<div style="color: #e0e5ff; font-family: 'JetBrains Mono', monospace; white-space: pre; overflow-x: auto; font-size: 13px; line-height: 1.5;">${cleanOutput}</div>` };
                }
                return c;
            });
            setSessionCells(prev => ({ ...prev, [sessionId]: cells }));
        }
        if (data.pwd) setSessionPwds(prev => ({ ...prev, [sessionId]: data.pwd }));
        setTimeout(() => inputRef.current?.focus(), 100);
    }).catch(() => {});
  };

  const createNewSession = () => {
    const id = "sess-" + Math.random().toString(36).substring(2, 9);
    setSessions(prev => [...prev, { id, status: 'initializing' }]);
    setSessionCells(prev => ({ ...prev, [id]: [] }));
    setActiveSessionId(id);
  };

  const getOrCreateTerminal = (sessionId, cellId = null) => {
    const key = cellId ? `${sessionId}-${cellId}` : sessionId;
    if (sessionTerminals.current[key]) return sessionTerminals.current[key];
    
    const terminal = new Terminal({
      theme: { background: '#000000', foreground: '#e0e5ff', cursor: '#00ecec', cursorAccent: '#1a1b26' },
      convertEol: true, cursorBlink: false, cursorStyle: 'block',
      fontFamily: '"JetBrains Mono", monospace', fontSize: 13, allowProposedApi: true,
      rows: sessionDimsRef.current[sessionId]?.rows || 24,
      cols: sessionDimsRef.current[sessionId]?.cols || 80,
      rendererType: 'dom' // Ensure text is visible to Playwright
    });
    if (typeof document !== 'undefined') {
        const hiddenDiv = document.createElement('div');
        hiddenDiv.style.position = 'absolute';
        hiddenDiv.style.left = '-9999px';
        hiddenDiv.style.visibility = 'hidden';
        // document.body.appendChild(hiddenDiv); // Don't even need to append
        terminal.open(hiddenDiv);
    }


    const fitAddon = new FitAddon();
    const serializeAddon = new SerializeAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(serializeAddon);
    
    terminal.onData(data => { 
        if (sessionRunningRef.current[sessionId]) {
            const ws = sessionSocketsRef.current[sessionId];
            if (ws) ws.send(JSON.stringify({ type: 'input', data })); 
        }
    });

    let lastResize = { cols: 0, rows: 0 };
    terminal.onResize(({ cols, rows }) => {
        if (cols === lastResize.cols && rows === lastResize.rows) return;
        lastResize = { cols, rows };
        sessionDimsRef.current[sessionId] = { cols, rows };
        const ws = sessionSocketsRef.current[sessionId];
        if (ws) {
            const termData = sessionTerminals.current[key];
            const ptyCols = (termData && termData.isInteractive) ? Math.max(2, cols - 1) : cols;
            const ptyRows = (termData && termData.isInteractive) ? Math.max(2, rows - 1) : rows;
            console.log(`[RESIZE_EVENT] sending resize to backend: cols=${ptyCols}(xterm=${cols}), rows=${ptyRows}(xterm=${rows})`);
            ws.send(JSON.stringify({ type: 'resize', cols: ptyCols, rows: ptyRows }));
        }
    });

    sessionTerminals.current[key] = { terminal, fitAddon, serializeAddon };
    return sessionTerminals.current[key];
  };

  const handleCreateSnapshot = (sessionId, cellId) => {
    const termData = sessionTerminals.current[`${sessionId}-${cellId}`];
    if (!termData) return "";
    const options = termData.isInteractive ? { scrollback: 0 } : {};
    let html = termData.serializeAddon.serializeAsHTML(options);
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    if (bodyMatch && bodyMatch[1]) html = bodyMatch[1];
    return html.replace(/color:\s*#000000/g, 'color: #e0e5ff')
               .replace(/background-color:\s*#ffffff/g, 'background-color: transparent')
               .replace(/background-color:\s*#ffff00/g, 'background-color: transparent')
               .replace(/font-family:[^;]*/g, "font-family: 'JetBrains Mono', monospace")
               .replace(/font-size:[^;]*/g, "font-size: 13px")
               .replace(/line-height:[^;]*/g, "line-height: 1.5")
               .replace(/(<div[^>]*>&nbsp;<\/div>\s*)+<\/body>/i, '</body>') // Trim trailing empty rows
               .replace(/(<div[^>]*><span[^>]*>\s*<\/span><\/div>\s*)+<\/body>/i, '</body>'); // Trim alternative empty rows
  };

  useEffect(() => {
    if (!activeSessionId) return;
    const sessionId = activeSessionId;
    if (!sessionSockets[sessionId] && !creatingSockets.current.has(sessionId)) {
      creatingSockets.current.add(sessionId);
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws`;
      const ws = new WebSocket(wsUrl);
      
      ws.onopen = () => {
          ws.send(JSON.stringify({ type: 'join_session', sessionId }));
      };
      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'session_init') {
          if (msg.pwd) setSessionPwds(prev => ({ ...prev, [sessionId]: msg.pwd }));
          if (msg.isTuiActive) {
              setSessionTuiStates(prev => ({ ...prev, [sessionId]: { cellId: msg.activeCellId } }));
          }
        } else if (msg.type === 'tui_enter') {
            setSessionTuiStates(prev => ({ ...prev, [sessionId]: { cellId: msg.cellId } }));
        } else if (msg.type === 'tui_exit') {
            setSessionTuiStates(prev => { 
                const n = {...prev}; 
                delete n[sessionId]; 
                return n; 
            });
            setTimeout(() => inputRef.current?.focus(), 100);
        } else if (msg.type === 'output') {
          const termData = getOrCreateTerminal(sessionId, msg.cellId);
          // DEBUG: Log the raw hex of the output
          const hex = Array.from(msg.data).map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join(' ');
          console.log(`[TUI_DEBUG] received output: ${msg.data.replace(/\x1b/g, 'ESC')} (hex: ${hex})`);

          if (!termData.isInteractive && (msg.data.includes('\x1b[2J') || msg.data.includes('\x1b[?25l') || msg.data.includes('\x1b[H'))) {
              console.log('[TUI_DEBUG] isInteractive set to true due to escape sequences. Calling clear()');
              termData.isInteractive = true;
              const maxRows = Math.floor((window.innerHeight - 200) / 20);
              const safeMaxRows = Math.max(10, maxRows);
              termData.terminal.resize(termData.terminal.cols, safeMaxRows);
              // Reset the terminal to ensure it acts as a fixed viewport without scrollback for TUI
              termData.terminal.options.scrollback = 0;
              termData.terminal.clear();
              termData.terminal.write('\x1b[H');
          }
          termData.terminal.write(msg.data);
        } else if (msg.type === 'exit') {
          const { cellId, pwd } = msg;
          const termData = getOrCreateTerminal(sessionId, cellId);
          setTimeout(() => {
            termData.terminal.write('', () => {
              const snapshot = handleCreateSnapshot(sessionId, cellId);
              setSessionCells(prev => ({ ...prev, [sessionId]: (prev[sessionId] || []).map(c => c.id === cellId ? { ...c, isRunning: false, snapshot } : c) }));
              setSessionRunning(prev => ({ ...prev, [sessionId]: false }));
              if (pwd) setSessionPwds(prev => ({ ...prev, [sessionId]: pwd }));
              setTimeout(() => inputRef.current?.focus(), 100);
            });
          }, 400);
        }
      };
      setSessionSockets(prev => ({ ...prev, [sessionId]: ws }));
    }
  }, [activeSessionId, sessionSockets]);

  const handleCommand = (e) => {
    if (e.key === 'Tab' && suggestion) {
        e.preventDefault();
        setInputValue(inputValue + suggestion);
        setSuggestion('');
        return;
    }
    if (e.key === 'Enter') {
      const cmd = inputValue.trim();
      if (!cmd || !activeSessionId) return;
      const cellId = Date.now();
      getOrCreateTerminal(activeSessionId, cellId);
      setSessionCells(prev => ({ ...prev, [activeSessionId]: [...(prev[activeSessionId] || []), { id: cellId, command: cmd, executablePwd: sessionPwds[activeSessionId] }] }));
      setSessionRunning(prev => ({ ...prev, [activeSessionId]: true }));
      const ws = sessionSockets[activeSessionId];
      if (ws) ws.send(JSON.stringify({ type: 'start', data: cmd, cellId }));
      setInputValue('');
      setSuggestion('');
    }
  };

  useEffect(() => {
    if (!inputValue || !activeSessionId) {
        setSuggestion('');
        return;
    }
    const currentHistory = (sessionCells[activeSessionId] || []).map(c => c.command).reverse();
    const otherHistory = Object.values(sessionCells).flat().map(c => c.command).reverse();
    const history = [...new Set([...currentHistory, ...otherHistory])];
    const match = history.find(cmd => cmd.startsWith(inputValue) && cmd.length > inputValue.length);
    setSuggestion(match ? match.substring(inputValue.length) : '');
  }, [inputValue, activeSessionId, sessionCells]);

  const activeTuiState = sessionTuiStates[activeSessionId];
  return (
    <div className="app-container">
      <div className="sidebar">
        <div className="sidebar-header"><TerminalSquare size={24} color="var(--accent-cyan)" /><h1>{config.appTitle}</h1></div>
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'12px'}}>
            <h2>SESSIONS</h2>
            <button onClick={createNewSession} style={{background:'none', border:'none', color:'var(--accent-cyan)', cursor:'pointer'}} title="New Session"><Plus size={16}/></button>
        </div>
        <ul>{sessions.map(s => <li key={s.id} data-session-id={s.id} className={activeSessionId === s.id ? 'active' : ''} onClick={() => switchSession(s.id)}><Hash size={14}/><span># {s.id.substring(0,8)}</span></li>)}</ul>
      </div>
      <div className="main-area">
        <div className="top-header">
           <div className="pwd-breadcrumb"><Folder size={14} color="var(--accent-cyan)" />{sessionPwds[activeSessionId] || '~'}</div>
           {activeTuiState && <div className="tui-active-badge">TUI ACTIVE</div>}
        </div>
        <div className="notebook-content" ref={scrollRef}>
          {(sessionCells[activeSessionId] || []).map(c => (
            <NotebookCell key={c.id} id={c.id} snapshot={c.snapshot} initialCommand={c.command} executablePwd={c.executablePwd} activeTerminal={getOrCreateTerminal(activeSessionId, c.id)} isRunning={sessionRunning[activeSessionId] && !c.snapshot} isTuiActive={activeTuiState?.cellId === c.id} />
          ))}
          <div style={{ height: '100px' }} />
        </div>
        <div className="chat-input-container">
          <div className="chat-input-wrapper">
            <span className="pwd-prompt-prefix">termbook <span className="prompt-arrow">❯</span></span>
            {suggestion && <span className="ghost-suggestion-text">{inputValue}{suggestion}</span>}
            <input 
                ref={inputRef} 
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleCommand} 
                placeholder={inputValue ? "" : "Enter terminal command..."} 
                disabled={!!activeTuiState} 
                autoFocus 
            />
          </div>
        </div>
      </div>
      {activeTuiState && <TuiModal activeTerminal={getOrCreateTerminal(activeSessionId, activeTuiState.cellId)} />}
    </div>
  );
}

export default App;
