import React, { useState, useEffect, useRef } from 'react';
import NotebookCell from './NotebookCell';
import TuiModal from './TuiModal';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SerializeAddon } from '@xterm/addon-serialize';
import { WebglAddon } from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';
import { TerminalSquare, Plus, Folder, Hash, X, ChevronDown, Maximize2, Minimize2, Server } from 'lucide-react';
import { tbLog } from './debug';
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
  // Per-session SSH Path B activation state. When true, the chat input
  // forwards control keys (Ctrl+C/D/L) to the remote PTY when no cell is
  // currently running — matching the experience of being inside a real
  // remote terminal. Updated via session_init.sshActive and 'ssh_state'
  // WS messages from the backend.
  const [sessionSshActive, setSessionSshActive] = useState({});
  // Companion to sessionSshActive: the remote host name (parsed from
  // the ssh command at SSH_START time). Used for the always-visible top
  // header SSH chip and the sidebar session indicator.
  const [sessionSshHosts, setSessionSshHosts] = useState({});
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
  const [isMaximized, setIsMaximized] = useState(() => {
    try { return localStorage.getItem('termbook_maximized') === '1'; } catch { return false; }
  });

  const toggleMaximized = () => {
    setIsMaximized(prev => {
      const next = !prev;
      try { localStorage.setItem('termbook_maximized', next ? '1' : '0'); } catch {}
      return next;
    });
  };
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

  // Input is "usable" whenever there's a session and we're not in
  // alt-screen TUI mode (which is hosted in a modal). If a command is
  // running, typing is forwarded to its PTY (gemini-style passthrough).
  const isInputUsable = activeSessionId && !sessionTuiStates[activeSessionId];
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
      // Toggle full-screen workspace (hide sidebar + top-header).
      // Cmd/Ctrl+Shift+F: 'F' for full-screen. Doesn't conflict with browser
      // find (Cmd+F) or browser fullscreen (which uses Cmd+Ctrl+F on macOS).
      // The input-level handler does NOT also bind this — both firing would
      // toggle twice and net zero.
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        toggleMaximized();
        return;
      }
      if (!inTextField && isInputUsable && inputRef.current && !e.metaKey && !e.ctrlKey && !e.altKey && e.key.length === 1) {
        inputRef.current.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isInputUsable, activeSessionId, sessionTuiStates, sessionSockets]);

  // Scroll behavior contract:
  //   - After submitting a new command: ALWAYS scroll the new cell to the
  //     top of the viewport, clearing any saved user-scroll position.
  //   - On session switch: DEFAULT to "latest cell at top of viewport".
  //     If the user had explicitly scrolled this session before leaving it,
  //     restore that scroll position instead.
  //   - The user explicitly scrolled = any scroll event the browser fires
  //     that we did NOT programmatically initiate.
  const userScrolledUpRef = useRef(false);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  const lastCellCountRef = useRef(0);
  const SCROLL_BOTTOM_THRESHOLD = 120;

  // Per-session: { scrollTop, userScrolled }. We persist this across
  // session switches so each session remembers where the user was looking.
  const sessionScrollMemoRef = useRef({});

  // Pending scroll action to perform after the new session's cells render.
  // The activeSessionId effect fires BEFORE React renders the new session's
  // cells into the DOM, so calling scrollLastCellToTop() in that effect
  // operates on the OLD DOM. We queue the intent here and the cells effect
  // executes it after the DOM is fresh.
  //   { kind: 'restoreMemo', scrollTop } | { kind: 'latestAtTop' } | null
  const pendingScrollRef = useRef(null);

  // The "user scrolled" signal comes from explicit input events
  // (wheel / touch / scroll-related keys), NOT from generic scroll events.
  // Why: layout shifts from session swaps, new cells appearing, fit-addon
  // recalcs, etc. all fire scroll events that look identical to a real
  // user scroll. Listening for input events instead is robust.
  const lastUserScrollAtRef = useRef(0);
  const markUserScroll = () => { lastUserScrollAtRef.current = Date.now(); };

  // Scrolls so that the last cell's top edge sits 16px below the viewport
  // top (i.e. the new cell becomes the focus of attention).
  // NOTE: we cannot use ':last-of-type' here because the notebook also
  // renders a sentinel <div> after the cells (the 240px bottom padding),
  // so ':last-of-type' picks the sentinel (a div) over the last cell.
  // querySelectorAll + indexing avoids that trap.
  const queryLastCell = (sc) => {
    const cells = sc.querySelectorAll('.notebook-cell');
    return cells.length ? cells[cells.length - 1] : null;
  };
  const scrollLastCellToTop = (sc) => {
    const lastCell = queryLastCell(sc);
    if (!lastCell) return;
    sc.scrollTop = Math.max(0, lastCell.offsetTop - 16);
  };

  useEffect(() => {
    const sc = scrollRef.current; if (!sc) return;
    const onScroll = () => {
      const distFromBottom = sc.scrollHeight - sc.scrollTop - sc.clientHeight;
      const isUp = distFromBottom > SCROLL_BOTTOM_THRESHOLD;
      setShowJumpToBottom(isUp);
      // Only treat this scroll as user-initiated if a wheel/touch/scroll-key
      // event happened within the last 500ms.
      const recentlyByUser = Date.now() - lastUserScrollAtRef.current < 500;
      if (!recentlyByUser) return;
      userScrolledUpRef.current = isUp;
      if (activeSessionId) {
        sessionScrollMemoRef.current[activeSessionId] = {
          scrollTop: sc.scrollTop,
          userScrolled: true,
        };
      }
    };
    sc.addEventListener('scroll', onScroll, { passive: true });

    const onWheel = () => markUserScroll();
    const onTouchMove = () => markUserScroll();
    const onKeyForScroll = (e) => {
      if (['PageUp','PageDown','Home','End','ArrowUp','ArrowDown'].includes(e.key)) {
        // Only count Arrow keys as scroll if the input isn't focused —
        // otherwise we'd misclassify history-recall as scrolling.
        const ae = document.activeElement;
        const inText = ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA');
        if (inText && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) return;
        markUserScroll();
      }
    };
    sc.addEventListener('wheel', onWheel, { passive: true });
    sc.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('keydown', onKeyForScroll);

    return () => {
      sc.removeEventListener('scroll', onScroll);
      sc.removeEventListener('wheel', onWheel);
      sc.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('keydown', onKeyForScroll);
    };
  }, [activeSessionId]);

  // IMPORTANT: This effect must be declared BEFORE the cells effect so
  // React runs it FIRST when activeSessionId changes. It sets up
  // pendingScrollRef and resets lastCellCountRef to the new session's
  // count, so the cells effect (which sees the new cells) doesn't
  // misinterpret the session swap as "a new cell was submitted".
  useEffect(() => {
    const sc = scrollRef.current; if (!sc) return;
    lastCellCountRef.current = (sessionCells[activeSessionId] || []).length;
    const memo = activeSessionId ? sessionScrollMemoRef.current[activeSessionId] : null;
    if (memo && memo.userScrolled) {
      userScrolledUpRef.current = true;
      setShowJumpToBottom(memo.scrollTop > 0);
      pendingScrollRef.current = { kind: 'restoreMemo', scrollTop: memo.scrollTop };
    } else {
      userScrolledUpRef.current = false;
      setShowJumpToBottom(false);
      pendingScrollRef.current = { kind: 'latestAtTop' };
    }
  }, [activeSessionId]);

  const cells = sessionCells[activeSessionId] || [];
  useEffect(() => {
    const sc = scrollRef.current; if (!sc) return;
    const cellCount = cells.length;
    const prevCount = lastCellCountRef.current;
    lastCellCountRef.current = cellCount;
    if (cellCount === 0) {
      // Cells aren't rendered yet — keep pending scroll for later.
      return;
    }

    // Honor a pending scroll action queued by the activeSessionId effect.
    // We may need to retry across a few frames because React's commit and
    // browser layout don't always settle in a single rAF.
    const pending = pendingScrollRef.current;
    if (pending) {
      pendingScrollRef.current = null;
      const tryApply = (attemptsLeft) => {
        requestAnimationFrame(() => {
          const cur = scrollRef.current;
          if (!cur) return;
          if (pending.kind === 'restoreMemo') {
            cur.scrollTop = pending.scrollTop;
            return;
          }
          if (pending.kind === 'latestAtTop') {
            const lc = queryLastCell(cur);
            if (lc) {
              cur.scrollTop = Math.max(0, lc.offsetTop - 16);
              return;
            }
            if (attemptsLeft > 0) tryApply(attemptsLeft - 1);
          }
        });
      };
      tryApply(8);
      return;
    }

    if (cellCount > prevCount) {
      // A new cell appeared — submit-scroll-to-top.
      requestAnimationFrame(() => {
        if (!scrollRef.current) return;
        scrollLastCellToTop(scrollRef.current);
        userScrolledUpRef.current = false;
        setShowJumpToBottom(false);
        if (activeSessionId) {
          // Submit explicitly resets the saved scroll memory for this
          // session — the user's attention moved to the new cell.
          delete sessionScrollMemoRef.current[activeSessionId];
        }
      });
      return;
    }

    if (!userScrolledUpRef.current) {
      const lastCell = queryLastCell(sc);
      if (lastCell) {
        const offset = lastCell.offsetTop - 16;
        if (sc.scrollTop < offset) sc.scrollTop = offset;
      }
    }
  }, [cells, activeSessionId]);

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
    setSessionSshActive(prev => { const n = { ...prev }; delete n[sessionId]; return n; });
    setSessionSshHosts(prev => { const n = { ...prev }; delete n[sessionId]; return n; });
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

  const requestResizeFor = (sessionId, isTui = false) => (cols, rows) => {
    const ws = sessionSockets[sessionId];
    if (!ws || ws.readyState !== 1) return;
    // Track TUI sizes separately from cell sizes so the backend can pick
    // the right one when a TUI app is active.
    const key = isTui ? 'tui' : 'cell';
    const lastBy = lastResizePerSession.current[sessionId] || {};
    if (lastBy[key] && lastBy[key].cols === cols && lastBy[key].rows === rows) return;
    lastBy[key] = { cols, rows };
    lastResizePerSession.current[sessionId] = lastBy;
    ws.send(JSON.stringify({ type: 'resize', cols, rows, isTui }));
  };

  // attachTerminal — call when the terminal needs to be hosted by a real
  // DOM parent (live cell container OR TUI modal container).
  //   - First call: terminal.open(parent), load FitAddon and WebglAddon.
  //   - Subsequent calls with a different parent: move the existing
  //     terminal.element into the new parent; addons stay loaded.
  //
  // The WebglAddon eliminates a class of rendering bugs the DOM renderer
  // suffers from. The DOM renderer positions the cursor overlay div with
  // `left = col * cellWidth`. JetBrains Mono at 13px produces a fractional
  // cellWidth (~7.81px), and the accumulated rounding error visibly
  // misaligns the cursor block (it straddles two characters in nvim
  // after enough keystrokes). The WebGL renderer draws every cell at
  // integer pixel boundaries on a single canvas, so cursor placement is
  // always pixel-perfect.
  //
  // The addon is loaded LAZILY (only when first attached to a real
  // parent) because it requires terminal.element.ownerDocument and a
  // visible container. Falls back silently to the DOM renderer if
  // WebGL is unavailable (older browsers, no GPU, software rendering).
  const attachTerminal = (entry, parent) => {
    const { terminal, fitAddon } = entry;
    let didMount = false;
    if (!terminal.element) {
        try {
            terminal.open(parent);
            didMount = true;
            tbLog('TERM', 'open', { parent: parent.className, parentW: parent.clientWidth, parentH: parent.clientHeight });
        } catch (e) {
            tbLog('TERM_ERR', 'open failed', { error: String(e), parent: parent.className });
            throw e;
        }
    } else if (terminal.element.parentElement !== parent) {
        parent.innerHTML = '';
        parent.appendChild(terminal.element);
        didMount = true;
        tbLog('TERM', 'move', { toParent: parent.className, parentW: parent.clientWidth });
    } else {
        // Already attached here; nothing to do.
        return;
    }
    // Wait one paint frame so the parent's layout is settled and
    // `parent.clientWidth/clientHeight` reports its FINAL size. Without
    // this delay, fitAddon may measure the parent before CSS has
    // applied (e.g., the TUI modal that's just appeared but hasn't
    // had its 90vw/85vh layout computed yet), giving us a tiny
    // initial size that WebGL then sticks to.
    const doFitAndWebGL = () => {
        try {
            fitAddon.fit();
            tbLog('TERM', 'fit-pre', { cols: terminal.cols, rows: terminal.rows });
        } catch (e) {
            tbLog('TERM_ERR', 'fit-pre failed', { error: String(e) });
        }
        if (!terminal._tb_webglLoaded) {
            try {
                const webgl = new WebglAddon();
                webgl.onContextLoss(() => {
                    tbLog('WEBGL', 'context lost — disposing addon');
                    try { webgl.dispose(); } catch (e) { tbLog('WEBGL_ERR', 'dispose on context loss failed', { error: String(e) }); }
                    terminal._tb_webglLoaded = false;
                });
                terminal.loadAddon(webgl);
                terminal._tb_webglLoaded = true;
                tbLog('WEBGL', 'loaded ok', { cols: terminal.cols, rows: terminal.rows });
                // Refit AFTER WebGL takes over so the canvas matches the
                // current cell grid. WebglAddon listens for terminal
                // resize events and resizes its canvas accordingly, so
                // any subsequent fit() propagates correctly.
                try { fitAddon.fit(); } catch (e) { tbLog('TERM_ERR', 'fit-post-webgl failed', { error: String(e) }); }
            } catch (e) {
                tbLog('WEBGL', 'unavailable, falling back to DOM', { error: String(e), msg: e?.message });
                if (typeof console !== 'undefined') console.warn('[xterm] WebGL renderer unavailable, falling back to DOM:', e?.message || e);
            }
        } else if (didMount) {
            // Already-loaded WebGL: after re-attach to a new parent the
            // canvas needs a refresh + resize cycle.
            try { fitAddon.fit(); } catch (e) { tbLog('TERM_ERR', 'fit-on-reattach failed', { error: String(e) }); }
            try { terminal.refresh(0, terminal.rows - 1); } catch (e) { tbLog('TERM_ERR', 'refresh-on-reattach failed', { error: String(e) }); }
        }
    };
    if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(doFitAndWebGL);
    } else {
        doFitAndWebGL();
    }
  };

  const getOrCreateTerminal = (sessionId, cellId = null) => {
    const key = `${sessionId}-${cellId}`;
    if (sessionTerminals.current[key]) return sessionTerminals.current[key];
    const terminal = new Terminal({
      theme: { background: '#000000', foreground: '#e0e5ff', cursor: '#00ecec' },
      convertEol: true, cursorBlink: false, cursorStyle: 'block',
      // Font fallback chain. JetBrains Mono for Latin/programming
      // glyphs; common Nerd Font families AFTER it so TUI apps that use
      // Powerline / private-use glyphs (nvim+NvChad, p10k, lazygit,
      // etc.) render correctly when a Nerd Font is installed. Falls
      // back to monospace if none are present.
      fontFamily: '"JetBrains Mono", "JetBrainsMono Nerd Font", "MesloLGS NF", "Hack Nerd Font", "FiraCode Nerd Font", "Symbols Nerd Font", "Apple Color Emoji", monospace',
      fontSize: 13, allowProposedApi: true,
      rows: 24, cols: 120,
    });
    // DELIBERATELY do NOT terminal.open() here. The terminal stays
    // detached until attachTerminal() is called by NotebookCell or
    // TuiModal with a real, visible parent. Opening off-screen first
    // (which the previous implementation did) gave the terminal an
    // initial small size that the WebGL canvas got stuck at — modal
    // would open at full size but the canvas stayed tiny in the
    // corner. xterm.js buffers writes that arrive before open(), so
    // pre-open writes are fine.
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
    sessionTerminals.current[key] = { terminal, fitAddon, serializeAddon, attach: (parent) => attachTerminal(sessionTerminals.current[key], parent) };
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
            tbLog('WS', 'open', { sessionId });
            setSessionSockets(prev => ({ ...prev, [sessionId]: ws }));
            const nc = scrollRef.current;
            const cellPxWidth = nc ? Math.max(400, nc.clientWidth - 96) : 1200;
            const cols = Math.max(40, Math.min(500, Math.floor(cellPxWidth / 8.5) - 4));
            ws.send(JSON.stringify({ type: 'join_session', sessionId, cols, rows: 24 }));
            retryCount = 0;
        };
        ws.onerror = (e) => {
            tbLog('WS_ERR', 'socket error', { sessionId, msg: String(e) });
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
                // SSH Path B state on reconnect / fresh join.
                setSessionSshActive(prev => ({ ...prev, [sessionId]: !!msg.sshActive }));
                setSessionSshHosts(prev => ({ ...prev, [sessionId]: msg.sshHost || null }));
            } else if (msg.type === 'ssh_state') {
                // Backend transitions: SSH session became active (after
                // injection) or ended (user typed `exit`). Drives whether
                // control keys forward to remote when chat input is idle.
                setSessionSshActive(prev => ({ ...prev, [sessionId]: !!msg.sshActive }));
                setSessionSshHosts(prev => ({ ...prev, [sessionId]: msg.sshHost || null }));
            } else if (msg.type === 'new_cell') {
                const newCellId = msg.cellId || `cell-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
                tbLog('CELL', 'new_cell', { cellId: newCellId, cmd: msg.command, remoteHost: msg.remoteHost });
                setSessionCells(prev => {
                    const currentCells = prev[sessionId] || [];
                    if (currentCells.some(c => c.id === newCellId)) return prev;
                    // remoteHost: set by backend on cells issued inside an active
                    // SSH session (Path B). Used to render the 🔌 host chip.
                    return { ...prev, [sessionId]: [...currentCells, { id: newCellId, command: msg.command, output: "", isRunning: true, startedAt: Date.now(), remoteHost: msg.remoteHost || null }] };
                });
                setSessionRunning(prev => ({ ...prev, [sessionId]: true }));
            } else if (msg.type === 'tui_enter') {
                tbLog('TUI', 'enter', { cellId: msg.activeCellId ?? msg.cellId });
                setSessionTuiStates(prev => ({ ...prev, [sessionId]: { cellId: msg.activeCellId ?? msg.cellId } }));
            } else if (msg.type === 'tui_exit') {
                tbLog('TUI', 'exit', { cellId: msg.activeCellId ?? msg.cellId });
                setSessionTuiStates(prev => { const n = {...prev}; delete n[sessionId]; return n; });
            } else if (msg.type === 'output') {
                const cells = (sessionCellsRef.current[sessionId] || []);
                const cell = cells.find(c => c.id === msg.cellId);
                if (!cell || !cell.isRunning) {
                    tbLog('OUTPUT_DROP', 'cell not running', { cellId: msg.cellId, dataLen: (msg.data||'').length });
                    return;
                }
                const termData = getOrCreateTerminal(sessionId, msg.cellId);
                try {
                    termData.terminal.write(msg.data);
                } catch (e) {
                    tbLog('OUTPUT_ERR', 'terminal.write threw', { cellId: msg.cellId, error: String(e) });
                }
            } else if (msg.type === 'exit') {
                const { cellId, pwd, snapshotAnsi, snapshotCols, snapshotRows, exitCode, usedTui, gitBranch, virtualEnv, condaEnv, remoteHost, usedSshSession } = msg;
                const now = Date.now();
                // Find startedAt to compute duration for notifications.
                const cell = (sessionCellsRef.current[sessionId] || []).find(c => c.id === cellId);
                const duration = cell && cell.startedAt ? now - cell.startedAt : null;
                tbLog('CELL', 'exit', { cellId, exitCode, durationMs: duration, snapshotLen: (snapshotAnsi||'').length });
                maybeNotifyCommandFinished(cell?.command || '', duration, exitCode);
                setSessionCells(prev => ({ ...prev, [sessionId]: (prev[sessionId] || []).map(c => c.id === cellId ? { ...c, isRunning: false, snapshotAnsi, snapshotCols, snapshotRows, exitCode, finishedAt: now, usedTui, gitBranch, virtualEnv, condaEnv, remoteHost: remoteHost ?? c.remoteHost, usedSshSession } : c) }));
                setSessionRunning(prev => ({ ...prev, [sessionId]: false }));
                if (pwd) setSessionPwds(prev => ({ ...prev, [sessionId]: pwd }));
                const termData = sessionTerminals.current[`${sessionId}-${cellId}`];
                if (termData) { termData.terminal.dispose(); delete sessionTerminals.current[`${sessionId}-${cellId}`]; }
            }
        };

        ws.onclose = (e) => {
            console.warn(`[WS] Connection closed for ${sessionId}. Retrying...`);
            tbLog('WS', 'close', { sessionId, code: e.code, reason: e.reason, wasClean: e.wasClean, retryCount });
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
    // Passthrough mode: a command is running, so every keystroke in the
    // chat input goes straight to its PTY. We don't care whether it's
    // gemini, cat (waiting for stdin), or anything else — interactive
    // commands of any kind get their input this way.
    if (isPassthrough) {
      const ws = sessionSockets[activeSessionId];
      if (!ws || ws.readyState !== 1) return;
      // Still let palette / history-search / fullscreen bubble up.
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'r' || e.key === 'K' || e.key === 'R')) return;
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'f' || e.key === 'F')) return;
      let send = null;
      if (e.key === 'Enter') send = '\r';
      else if (e.key === 'Backspace') send = '\x7f';
      else if (e.key === 'Tab') send = '\t';
      else if (e.key === 'Escape') send = '\x1b';
      else if (e.key === 'ArrowUp') send = '\x1b[A';
      else if (e.key === 'ArrowDown') send = '\x1b[B';
      else if (e.key === 'ArrowRight') send = '\x1b[C';
      else if (e.key === 'ArrowLeft') send = '\x1b[D';
      else if (e.ctrlKey && e.key.length === 1) {
        const c = e.key.toLowerCase().charCodeAt(0);
        if (c >= 97 && c <= 122) send = String.fromCharCode(c - 96);
      }
      else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) send = e.key;
      if (send != null) {
        e.preventDefault();
        ws.send(JSON.stringify({ type: 'input', data: send }));
        setInputValue('');
      }
      return;
    }
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
    // ── SSH Path B: control-key forwarding when idle in remote session ──
    // In a real terminal, Ctrl+D at an empty prompt EOFs the shell. In
    // Path B between remote commands, the chat input is idle but the SSH
    // PTY is alive. Send Ctrl+D as \x04 to the remote bash so `exit`-by-
    // EOF works the way users expect.
    //
    // Ctrl+C with content: we keep the local "clear input" behavior
    // (textarea's default), but also send \x03 to the remote so any
    // partial line on the remote shell's line editor is also cleared.
    // Ctrl+L: kept local (clear notebook history) — forwarding to remote
    // would just redraw the prompt with no benefit.
    if (sessionSshActive[activeSessionId] && e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) {
      const ws = sessionSockets[activeSessionId];
      if (ws && ws.readyState === 1) {
        if (e.key === 'd' || e.key === 'D') {
          // Ctrl+D on empty input: end the SSH session.
          //
          // We DON'T send \x04 directly — many remote shells (zsh with
          // vi-mode line editor, for instance) bind ^D to `list-choices`
          // or `delete-char-or-list`, NOT to EOF. So \x04 silently does
          // nothing on those shells.
          //
          // We also don't send raw `exit\r` via {type:'input',...} —
          // that bypasses the cell lifecycle, so the user sees no
          // visual feedback and the SSH state machine doesn't update.
          //
          // Instead: synthesize a real cell submission for `exit`. The
          // user sees an "exit" cell appear in the notebook (visible
          // feedback), the backend startCommand path runs and forwards
          // the bytes through the normal mechanism (which we've already
          // proven works for typed `exit`), the salted-marker plumbing
          // closes the cell + clears sshActive when bash exits.
          if (!inputValue) {
            e.preventDefault();
            const cellId = `cell-${Date.now()}`;
            setSessionCells(prev => {
                const currentCells = prev[activeSessionId] || [];
                if (currentCells.some(c => c.id === cellId)) return prev;
                return { ...prev, [activeSessionId]: [...currentCells, { id: cellId, command: 'exit', executablePwd: sessionPwds[activeSessionId], output: '', isRunning: true, startedAt: Date.now(), remoteHost: sessionSshHosts[activeSessionId] }] };
            });
            setSessionRunning(prev => ({ ...prev, [activeSessionId]: true }));
            ws.send(JSON.stringify({ type: 'start', data: 'exit', cellId }));
            return;
          }
        } else if (e.key === 'c' || e.key === 'C') {
          // Forward ^C to the remote line editor so any partial line
          // there is cleared too. Also clear chat input.
          e.preventDefault();
          ws.send(JSON.stringify({ type: 'input', data: '\x03' }));
          setInputValue('');
          return;
        }
      }
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      setPaletteOpen(true);
      setPaletteQuery('');
      setPaletteIdx(0);
      return;
    }
    // Cmd+Shift+F (fullscreen) is handled at the window level only — see the
    // useEffect global onKey handler. Including it here as well would cause
    // toggleMaximized() to run TWICE (input handler + window handler both
    // see the event since preventDefault doesn't stop propagation), netting
    // zero change.
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
      tbLog('USER', 'submit', { cellId, cmd: cmd.slice(0, 80), wsState: ws?.readyState });
      if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'start', data: cmd, cellId }));
      else tbLog('USER_ERR', 'submit dropped, ws not open', { cellId, wsState: ws?.readyState });
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
  // Passthrough mode: any time a non-modal command is running, typing in
  // the chat input forwards keystrokes to that command's PTY. No detection,
  // no heuristics — just "if a command is running, route input to it".
  const isPassthrough = !!sessionRunning[activeSessionId] && !activeTuiState;

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
    {
      id: 'toggle-fullscreen',
      label: isMaximized ? 'Exit full screen' : 'Toggle full screen (hide sidebar + header)',
      hint: '⌘⇧F',
      run: toggleMaximized,
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
    <div className={`app-container${isMaximized ? ' is-maximized' : ''}`}>
      <div className="sidebar">
        <div className="sidebar-header"><TerminalSquare size={24} color="var(--accent-cyan)" /><h1>{config.appTitle}</h1></div>
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'12px'}}>
            <h2>SESSIONS</h2>
            <button onClick={() => { createNewSession(); refocusInput(); }} style={{background:'none', border:'none', color:'var(--accent-cyan)', cursor:'pointer'}} title="New Session"><Plus size={16}/></button>
        </div>
        <ul>{sessions.map(s => {
          const sid = String(s.id);
          const label = sid.length > 18 ? `${sid.slice(0, 9)}…${sid.slice(-4)}` : sid;
          const inSsh = sessionSshActive[s.id];
          const sshHost = sessionSshHosts[s.id];
          return (
            <li key={s.id} data-session-id={s.id} className={`${activeSessionId === s.id ? 'active' : ''}${inSsh ? ' in-ssh' : ''}`} onClick={() => { switchSession(s.id); refocusInput(); }} title={inSsh && sshHost ? `${sid} (SSH: ${sshHost})` : sid}>
              <Hash size={14}/>
              <span style={{ flex: 1 }}>{label}</span>
              {/* Small SSH glyph + truncated host so at-a-glance you can
                  identify which sessions are currently inside an SSH
                  session, without switching between them. */}
              {inSsh && (
                <span className="session-ssh-indicator" title={sshHost ? `SSH: ${sshHost}` : 'SSH active'}>
                  <Server size={11} />
                </span>
              )}
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
           {/* SSH host indicator deliberately NOT shown here — the input
               prefix badge (right where the user types) plus the sidebar
               Server icon (for orientation across sessions) plus the
               per-cell SSH chip (for scroll-back context) are enough.
               A top-header chip just duplicates the input prefix. */}
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
             <button
                onClick={toggleMaximized}
                className="maximize-btn"
                title={isMaximized ? 'Exit full screen (⌘⇧F)' : 'Full screen (⌘⇧F)'}
                aria-label={isMaximized ? 'Exit full screen' : 'Enter full screen'}
             >
                {isMaximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
             </button>
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
                <div className="tip"><kbd>⌘</kbd>+<kbd>⇧</kbd>+<kbd>F</kbd> full screen</div>
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
                remoteHost={c.remoteHost}
                usedSshSession={c.usedSshSession}
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
          <div className={`chat-input-wrapper${isPassthrough ? ' is-passthrough' : ''}${activeTuiState ? ' is-tui' : ''}${sessionSshActive[activeSessionId] ? ' is-ssh' : ''}`}>
            <span className="pwd-prompt-prefix">
              {isPassthrough ? (
                <span className="running-spinner" aria-hidden="true" />
              ) : sessionSshActive[activeSessionId] && sessionSshHosts[activeSessionId] ? (
                // In Path B, replace the generic "termbook" prefix with a
                // remote-host badge so the user sees, right next to where
                // they're typing, that this command will be sent to the
                // remote shell — not to the local machine.
                <span className="pwd-prompt-prefix-ssh" title={`Sending to SSH session: ${sessionSshHosts[activeSessionId]}`}>
                  <Server size={13} />
                  <span className="pwd-prompt-prefix-ssh-host">{sessionSshHosts[activeSessionId]}</span>
                  <span className="pwd-prompt-prefix-arrow">❯</span>
                </span>
              ) : (
                <span>{config.localHostname || 'localhost'} ❯</span>
              )}
            </span>
            <textarea
                ref={inputRef} value={inputValue}
                onChange={(e) => {
                    // In passthrough mode, keystrokes are sent via onKeyDown
                    // to the running PTY, not buffered into inputValue.
                    if (isPassthrough) return;
                    setInputValue(e.target.value);
                    if (historyIdx !== -1 && e.target.value !== history[historyIdx]) setHistoryIdx(-1);
                    e.target.style.height = 'auto';
                    e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px';
                }}
                onKeyDown={handleCommand}
                placeholder={isPassthrough ? 'Sending keystrokes to running command…' : activeTuiState ? 'TUI active — interact in the modal above' : 'Enter terminal command…'}
                disabled={!!activeTuiState} rows={1}
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
      {isMaximized && (
        <button
          className="exit-fullscreen-floating"
          onClick={toggleMaximized}
          title="Exit full screen (⌘⇧F)"
          aria-label="Exit full screen"
        >
          <Minimize2 size={14} />
        </button>
      )}
      {activeTuiState && <TuiModal activeTerminal={getOrCreateTerminal(activeSessionId, activeTuiState.cellId)} requestResize={requestResizeFor(activeSessionId, true)} />}
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
