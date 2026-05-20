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

const NOTIFY_THRESHOLD_MS = 5000;

function maybeNotifyCommandFinished(command, durationMs, exitCode) {
  if (typeof Notification === 'undefined') return;
  if (durationMs == null || durationMs < NOTIFY_THRESHOLD_MS) return;
  if (typeof document !== 'undefined' && document.visibilityState === 'visible' && document.hasFocus()) return;
  const fire = () => {
    try {
      const ok = exitCode === 0 || exitCode == null;
      const title = ok ? 'Termbook: command finished' : `Termbook: command failed (exit ${exitCode})`;
      const body = (command || '').slice(0, 200);
      new Notification(title, { body, tag: 'termbook-cmd', silent: false });
    } catch {}
  };
  if (Notification.permission === 'granted') {
    fire();
  } else if (Notification.permission !== 'denied') {
    Notification.requestPermission().then(p => { if (p === 'granted') fire(); }).catch(() => {});
  }
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
  const [completionState, setCompletionState] = useState(null);
  const [historySearch, setHistorySearch] = useState(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState('');
  const [paletteIdx, setPaletteIdx] = useState(0);
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
        e.preventDefault();
        setPaletteOpen(true);
        setPaletteQuery('');
        setPaletteIdx(0);
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
            const nc = scrollRef.current;
            const cellPxWidth = nc ? Math.max(400, nc.clientWidth - 96) : 1200;
            const cols = Math.max(40, Math.min(500, Math.floor(cellPxWidth / 8.5) - 4));
            ws.send(JSON.stringify({ type: 'join_session', sessionId, cols, rows: 24 }));
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
                const { cellId, pwd, snapshotAnsi, snapshotCols, snapshotRows, exitCode, usedTui, gitBranch, virtualEnv, condaEnv } = msg;
                const now = Date.now();
                // Find startedAt to compute duration for notifications.
                const cell = (sessionCellsRef.current[sessionId] || []).find(c => c.id === cellId);
                const duration = cell && cell.startedAt ? now - cell.startedAt : null;
                maybeNotifyCommandFinished(cell?.command || '', duration, exitCode);
                setSessionCells(prev => ({ ...prev, [sessionId]: (prev[sessionId] || []).map(c => c.id === cellId ? { ...c, isRunning: false, snapshotAnsi, snapshotCols, snapshotRows, exitCode, finishedAt: now, usedTui, gitBranch, virtualEnv, condaEnv } : c) }));
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

  const fuzzyScore = (text, query) => {
    if (!query) return 0;
    const t = text.toLowerCase();
    const q = query.toLowerCase();
    if (t === q) return 10000;
    if (t.startsWith(q)) return 5000 - t.length;
    // Bonus when the query matches at a word boundary (after space/punct).
    const wordRegex = new RegExp(`(?:^|[\\s_-])${q.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}`);
    if (wordRegex.test(t)) return 2000 - t.indexOf(q);
    if (t.includes(q)) return 1000 - t.indexOf(q);
    let ti = 0, score = 0, lastMatch = -1;
    for (const qc of q) {
      const found = t.indexOf(qc, ti);
      if (found === -1) return -1;
      if (lastMatch !== -1 && found === lastMatch + 1) score += 5;
      score += 1;
      lastMatch = found;
      ti = found + 1;
    }
    return score;
  };

  const historyMatches = (() => {
    if (!historySearch) return [];
    const q = historySearch.query;
    const seen = new Set();
    const scored = [];
    for (let i = history.length - 1; i >= 0; i--) {
      const cmd = history[i];
      if (seen.has(cmd)) continue;
      seen.add(cmd);
      const score = q ? fuzzyScore(cmd, q) : 1;
      if (score < 0) continue;
      scored.push({ cmd, score, recency: i });
    }
    scored.sort((a, b) => b.score - a.score || b.recency - a.recency);
    return scored.slice(0, 50);
  })();

  const applyCompletion = (originalInput, candidate) => {
    // The candidate's `value` already contains the path prefix
    // (e.g. "src/Notebo..." not just "Notebo..."). Replace the trailing
    // current-token portion with candidate.value, preserving everything
    // before. Tokenize the same way the backend does.
    const trailing = originalInput.match(/(\S*)$/)?.[1] || '';
    const prefix = originalInput.slice(0, originalInput.length - trailing.length);
    return prefix + candidate.value;
  };

  const requestCompletion = async () => {
    if (!activeSessionId) return null;
    const apiBase = window.location.origin.replace(':4000', ':4001');
    try {
      const url = `${apiBase}/api/complete?input=${encodeURIComponent(inputValue)}&sessionId=${encodeURIComponent(activeSessionId)}`;
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = await res.json();
      return data;
    } catch {
      return null;
    }
  };

  const handleCommand = (e) => {
    const isMultiline = inputValue.includes('\n');
    if ((e.ctrlKey || e.metaKey) && e.key === 'r') {
      e.preventDefault();
      setHistorySearch({ query: '', selectedIdx: 0 });
      return;
    }
    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      if (completionState && completionState.candidates.length > 1) {
        const nextIdx = (completionState.idx + 1) % completionState.candidates.length;
        const nextCand = completionState.candidates[nextIdx];
        setInputValue(applyCompletion(completionState.originalInput, nextCand));
        setCompletionState({ ...completionState, idx: nextIdx });
        return;
      }
      requestCompletion().then(data => {
        if (!data || !data.candidates || data.candidates.length === 0) return;
        if (data.candidates.length === 1) {
          let next = applyCompletion(inputValue, data.candidates[0]);
          if (!data.candidates[0].isDir) next += ' ';
          setInputValue(next);
          setCompletionState(null);
        } else {
          setInputValue(applyCompletion(inputValue, data.candidates[0]));
          setCompletionState({ candidates: data.candidates, idx: 0, originalInput: inputValue });
        }
      });
      return;
    }
    if (e.key !== 'Tab' && completionState) setCompletionState(null);
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      setPaletteOpen(true);
      setPaletteQuery('');
      setPaletteIdx(0);
      return;
    }
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

  const lastCommand = (() => {
    const cells = sessionCells[activeSessionId] || [];
    for (let i = cells.length - 1; i >= 0; i--) {
      if (cells[i].command) return cells[i].command;
    }
    return null;
  })();

  const closePalette = () => { setPaletteOpen(false); setPaletteQuery(''); setPaletteIdx(0); setTimeout(() => refocusInput(), 0); };
  const paletteActions = [
    {
      id: 'new-session',
      label: 'New session',
      hint: 'Cmd+N',
      run: () => { createNewSession(); },
    },
    {
      id: 'history-search',
      label: 'Search command history',
      hint: 'Ctrl+R',
      run: () => { setHistorySearch({ query: '', selectedIdx: 0 }); },
    },
    {
      id: 'clear-output',
      label: 'Clear terminal output',
      hint: 'Cmd+L',
      run: () => {
        const ws = sessionSockets[activeSessionId];
        if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'input', data: 'clear\r' }));
      },
    },
    lastCommand && {
      id: 'rerun-last',
      label: `Re-run last command: ${lastCommand}`,
      hint: '',
      run: () => { setInputValue(lastCommand); },
    },
    activeSessionId && {
      id: 'delete-session',
      label: `Delete current session`,
      hint: '',
      run: () => { deleteSession(activeSessionId); },
    },
    sessions.length > 1 && {
      id: 'switch-session',
      label: `Switch session (${sessions.length} available)`,
      hint: '',
      run: () => {
        const idx = sessions.findIndex(s => s.id === activeSessionId);
        const next = sessions[(idx + 1) % sessions.length];
        if (next) switchSession(next.id);
      },
    },
    {
      id: 'copy-last-output',
      label: 'Copy last cell output',
      hint: '',
      run: async () => {
        const cells = sessionCells[activeSessionId] || [];
        for (let i = cells.length - 1; i >= 0; i--) {
          const node = document.querySelector(`[data-cell-id="${cells[i].id}"] .cell-output`);
          if (node) {
            try { await navigator.clipboard.writeText(node.innerText.trim()); } catch {}
            break;
          }
        }
      },
    },
  ].filter(Boolean);

  const paletteFilteredActions = (() => {
    if (!paletteQuery) return paletteActions;
    const scored = paletteActions
      .map(a => ({ a, score: fuzzyScore(a.label + ' ' + (a.hint || ''), paletteQuery) }))
      .filter(x => x.score > 0)
      .sort((x, y) => y.score - x.score);
    return scored.map(x => x.a);
  })();

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
                <div className="tip"><kbd>Tab</kbd> complete paths</div>
                <div className="tip"><kbd>↑</kbd> / <kbd>↓</kbd> history</div>
                <div className="tip"><kbd>Ctrl</kbd>+<kbd>R</kbd> search history</div>
                <div className="tip"><kbd>⌘</kbd>+<kbd>K</kbd> action palette</div>
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
                snapshotCols={c.snapshotCols}
                snapshotRows={c.snapshotRows} 
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
                gitBranch={c.gitBranch}
                virtualEnv={c.virtualEnv}
                condaEnv={c.condaEnv}
                onRerun={(cmd) => { setInputValue(cmd); refocusInput(); }}
            />
          ))}
          {/* Bottom padding so the latest cell can scroll to viewport top.
              Only when there are cells; on empty state, this would push the
              welcome content off-screen. */}
          {(sessionCells[activeSessionId] || []).length > 0 && (
            <div style={{ height: 'calc(100vh - 240px)', flexShrink: 0 }} />
          )}
        </div>
        {showJumpToBottom && (
          <button className="jump-to-bottom" onClick={jumpToBottom} title="Jump to bottom">
            <ChevronDown size={16} /> <span>Jump to latest</span>
          </button>
        )}
        <div className="chat-input-container">
          {completionState && completionState.candidates.length > 1 && (
            <div className="completion-hint">
              <span className="completion-hint-count">{completionState.idx + 1}/{completionState.candidates.length}</span>
              {completionState.candidates.slice(0, 8).map((c, i) => (
                <span key={c.value} className={`completion-hint-chip${i === completionState.idx ? ' active' : ''}`}>{c.display}</span>
              ))}
              {completionState.candidates.length > 8 && (
                <span className="completion-hint-more">+{completionState.candidates.length - 8} more</span>
              )}
              <span className="completion-hint-kbd"><kbd>Tab</kbd> to cycle</span>
            </div>
          )}
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
      {historySearch && (
        <div className="history-search-overlay" onClick={() => setHistorySearch(null)}>
          <div className="history-search-modal" onClick={(e) => e.stopPropagation()}>
            <div className="history-search-header">
              <span className="history-search-prefix">(reverse-i-search)</span>
              <input
                type="text"
                autoFocus
                value={historySearch.query}
                onChange={(e) => setHistorySearch({ query: e.target.value, selectedIdx: 0 })}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') { setHistorySearch(null); refocusInput(); }
                  else if (e.key === 'Enter') {
                    const sel = historyMatches[historySearch.selectedIdx];
                    if (sel) setInputValue(sel.cmd);
                    setHistorySearch(null);
                    setTimeout(() => refocusInput(), 0);
                  } else if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setHistorySearch(s => ({ ...s, selectedIdx: Math.min(historyMatches.length - 1, s.selectedIdx + 1) }));
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setHistorySearch(s => ({ ...s, selectedIdx: Math.max(0, s.selectedIdx - 1) }));
                  } else if ((e.ctrlKey || e.metaKey) && e.key === 'r') {
                    e.preventDefault();
                    setHistorySearch(s => ({ ...s, selectedIdx: Math.min(historyMatches.length - 1, s.selectedIdx + 1) }));
                  }
                }}
                placeholder="type to fuzzy-search history…"
              />
              <span className="history-search-count">{historyMatches.length} match{historyMatches.length === 1 ? '' : 'es'}</span>
            </div>
            <div className="history-search-results">
              {historyMatches.length === 0 && <div className="history-search-empty">No matches</div>}
              {historyMatches.map((m, i) => (
                <div
                  key={`${m.cmd}-${i}`}
                  className={`history-search-row${i === historySearch.selectedIdx ? ' active' : ''}`}
                  onClick={() => { setInputValue(m.cmd); setHistorySearch(null); setTimeout(() => refocusInput(), 0); }}
                  onMouseEnter={() => setHistorySearch(s => ({ ...s, selectedIdx: i }))}
                >
                  {m.cmd}
                </div>
              ))}
            </div>
            <div className="history-search-footer">
              <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
              <span><kbd>Enter</kbd> use</span>
              <span><kbd>Esc</kbd> cancel</span>
              <span><kbd>Ctrl+R</kbd> next</span>
            </div>
          </div>
        </div>
      )}
      {paletteOpen && (
        <div className="history-search-overlay" onClick={closePalette}>
          <div className="history-search-modal palette-modal" onClick={(e) => e.stopPropagation()}>
            <div className="history-search-header">
              <span className="palette-prefix">⌘K</span>
              <input
                type="text"
                autoFocus
                value={paletteQuery}
                onChange={(e) => { setPaletteQuery(e.target.value); setPaletteIdx(0); }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') { closePalette(); }
                  else if (e.key === 'Enter') {
                    const sel = paletteFilteredActions[paletteIdx];
                    if (sel) { sel.run(); closePalette(); }
                  } else if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setPaletteIdx(i => Math.min(paletteFilteredActions.length - 1, i + 1));
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setPaletteIdx(i => Math.max(0, i - 1));
                  }
                }}
                placeholder="type an action…"
              />
              <span className="history-search-count">{paletteFilteredActions.length} action{paletteFilteredActions.length === 1 ? '' : 's'}</span>
            </div>
            <div className="history-search-results">
              {paletteFilteredActions.length === 0 && <div className="history-search-empty">No matching actions</div>}
              {paletteFilteredActions.map((a, i) => (
                <div
                  key={a.id}
                  className={`history-search-row palette-row${i === paletteIdx ? ' active' : ''}`}
                  onClick={() => { a.run(); closePalette(); }}
                  onMouseEnter={() => setPaletteIdx(i)}
                >
                  <span className="palette-row-label">{a.label}</span>
                  {a.hint && <span className="palette-row-hint">{a.hint}</span>}
                </div>
              ))}
            </div>
            <div className="history-search-footer">
              <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
              <span><kbd>Enter</kbd> run</span>
              <span><kbd>Esc</kbd> cancel</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
export default App;
