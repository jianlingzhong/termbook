const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const os = require('os');
const cp = require('child_process');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const pty = require('node-pty');
const { v4: uuidv4 } = require('uuid');
const { Terminal } = require('@xterm/headless');
const { SerializeAddon } = require('@xterm/addon-serialize');
const { parseOutput } = require('./parser');
const persistence = require('./persistence');

const configPath = path.join(__dirname, '..', 'app_config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

// DEDICATED DEBUG LOGGING (Sync to avoid loss)
const DEBUG_LOG_PATH = path.join(__dirname, '..', 'ssr_debug.log');
function debugLog(msg) {
    const timestamp = new Date().toISOString();
    fs.appendFileSync(DEBUG_LOG_PATH, `[${timestamp}] ${msg}\n`);
}
// Clear log on start
fs.writeFileSync(DEBUG_LOG_PATH, `=== SSR DIAGNOSTIC SESSION START ===\n`);

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const sessions = new Map();

const db = persistence.openDb();
if (process.argv.includes('--reset-db')) {
    persistence.clearAll(db);
    debugLog(`[DB] cleared all sessions/cells (--reset-db)`);
}

function persistSession(session) {
    try { persistence.upsertSession(db, session); } catch (e) { debugLog(`[DB_ERR] upsertSession ${session.id}: ${e.message}`); }
}
function persistCell(session, cell) {
    try {
        const position = session.cells.findIndex(c => c.id === cell.id);
        if (position < 0) return;
        persistence.upsertCell(db, session.id, cell, position);
    } catch (e) { debugLog(`[DB_ERR] upsertCell ${cell.id}: ${e.message}`); }
}

const persisted = persistence.loadAllSessions(db);
debugLog(`[DB] loaded ${persisted.length} persisted sessions`);
for (const p of persisted) {
    sessions.set(p.id, {
        id: p.id,
        ptyProcess: null,
        activeCellId: null,
        isPtyReady: false,
        tailBuf: '',
        sentPos: 0,
        clients: new Set(),
        cells: p.cells,
        pwd: p.pwd,
        rcPath: null,
        rcDir: null,
        isTuiActive: false,
        pendingQueue: [],
        headlessTerminal: null,
        serializeAddon: null,
        promptSalt: null,
        createdAt: p.createdAt,
        lastActivity: p.lastActivity,
        hydrated: true,
    });
}

function cleanupZombies() {
  console.log('[*] Cleaning up PTY zombie processes before exit...');
  for (const [id, session] of sessions.entries()) {
    try {
        if (session.ptyProcess) session.ptyProcess.kill();
        if (session.rcPath && fs.existsSync(session.rcPath)) fs.unlinkSync(session.rcPath);
        if (session.rcDir && fs.existsSync(session.rcDir)) fs.rmSync(session.rcDir, { recursive: true, force: true });
    } catch (e) {
        console.error(`Error cleaning up session ${id}:`, e);
    }
  }
}
process.on('SIGINT', () => { cleanupZombies(); process.exit(); });
process.on('SIGTERM', () => { cleanupZombies(); process.exit(); });
process.on('exit', cleanupZombies);

function calculateMinSize(session) {
    let minCols = Infinity;
    let minRows = Infinity;
    for (const client of session.clients) {
        if (client.requestedCols) minCols = Math.min(minCols, client.requestedCols);
        if (client.requestedRows) minRows = Math.min(minRows, client.requestedRows);
    }
    if (minCols === Infinity) minCols = 120;
    if (minRows === Infinity) minRows = 24;
    return { cols: minCols, rows: minRows };
}

function handleResize(session) {
    if (!session.ptyProcess) return;
    const { cols, rows } = calculateMinSize(session);
    debugLog(`[RESIZE] session ${session.id} -> ${cols}x${rows}`);
    try {
        session.ptyProcess.resize(cols, rows);
        if (session.headlessTerminal) {
            session.headlessTerminal.resize(cols, rows);
        }
        const syncPayload = JSON.stringify({ type: 'resize_sync', cols, rows });
        for (const client of session.clients) {
            if (client.readyState === 1) client.send(syncPayload);
        }
    } catch (e) {
        console.error(`[RESIZE ERROR] session ${session.id}:`, e);
    }
}

function detectUserShell() {
  const envShell = process.env.SHELL;
  if (envShell && fs.existsSync(envShell)) return envShell;
  try {
    const out = cp.execSync(`dscl . -read /Users/${process.env.USER} UserShell 2>/dev/null`).toString();
    const m = out.match(/UserShell:\s*(\S+)/);
    if (m && fs.existsSync(m[1])) return m[1];
  } catch (e) {}
  try {
    const out = cp.execSync(`getent passwd ${process.env.USER} 2>/dev/null`).toString();
    const parts = out.trim().split(':');
    if (parts[6] && fs.existsSync(parts[6])) return parts[6];
  } catch (e) {}
  return '/bin/bash';
}

const USER_SHELL = detectUserShell();
const USER_SHELL_NAME = path.basename(USER_SHELL);
debugLog(`[SHELL_DETECT] using ${USER_SHELL} (${USER_SHELL_NAME})`);

function extractUserAliases() {
  const aliasLines = [];
  const candidates = [
    path.join(os.homedir(), '.aliases'),
    path.join(os.homedir(), '.bash_aliases'),
    path.join(os.homedir(), '.bashrc'),
    path.join(os.homedir(), '.zshrc'),
    path.join(os.homedir(), '.bash_profile'),
    path.join(os.homedir(), '.profile'),
  ];
  for (const f of candidates) {
    try {
      if (!fs.existsSync(f)) continue;
      const content = fs.readFileSync(f, 'utf8');
      for (const raw of content.split('\n')) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        const m = line.match(/^alias\s+([A-Za-z_][\w-]*)=(.+?)\s*(?:#.*)?$/);
        if (m) aliasLines.push(`alias ${m[1]}=${m[2]}`);
      }
    } catch {}
  }
  const seen = new Set();
  const deduped = [];
  for (const l of aliasLines) {
    const key = l.split('=')[0];
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(l);
  }
  return deduped;
}

const USER_ALIASES = extractUserAliases();
debugLog(`[ALIASES] imported ${USER_ALIASES.length} from user rc files`);


function buildBashRc(promptSalt, projectRoot) {
  return [
    `cd ${JSON.stringify(projectRoot)}`,
    `export PS1=' '`,
    `export PS2=' '`,
    `export PROMPT_COMMAND='printf "\\033]133;D;%s;%s\\007\\033]7;file://localhost%s\\007" "$?" "${promptSalt}" "$PWD"'`,
    `export CLICOLOR=1`,
    `export CLICOLOR_FORCE=1`,
    `export LSCOLORS='ExGxFxdaCxDaDahbadeche'`,
    `export TERM=xterm-256color`,
    `ls() { if /bin/ls --version >/dev/null 2>&1; then command ls --color=auto "$@"; else command ls -G "$@"; fi; }`,
    `alias grep='grep --color=auto'`,
    ...USER_ALIASES,
    `stty -echo`,
    ``,
  ].join('\n');
}

function spawnPtyForSession(session) {
  const projectRoot = path.join(__dirname, '..');
  const startCwd = (session.pwd && fs.existsSync(session.pwd)) ? session.pwd : projectRoot;
  const promptSalt = uuidv4().replace(/-/g, '');
  const shell = '/bin/bash';
  const rcPath = path.join(__dirname, `${config.markerPrefix.toLowerCase()}_bashrc_${session.id}`);
  fs.writeFileSync(rcPath, buildBashRc(promptSalt, startCwd));
  debugLog(`[PTY_SPAWN] session ${session.id} shell=${shell} cwd=${startCwd}`);
  const ptyProcess = pty.spawn(shell, ['--rcfile', rcPath, '-i'], {
    name: 'xterm-256color',
    cols: 120,
    rows: 24,
    cwd: startCwd,
    env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', FORCE_COLOR: '3' },
  });
  session.ptyProcess = ptyProcess;
  session.promptSalt = promptSalt;
  session.rcPath = rcPath;
  session.isPtyReady = false;
  session.tailBuf = '';
  session.sentPos = 0;
  attachPtyHandlers(session);
  return ptyProcess;
}

function createSession(sessionId) {
  const existing = sessions.get(sessionId);
  if (existing) {
    if (!existing.ptyProcess) spawnPtyForSession(existing);
    return existing;
  }
  const projectRoot = path.join(__dirname, '..');

  debugLog(`[SESSION_CREATE] ${sessionId} (user shell: ${USER_SHELL}, imported ${USER_ALIASES.length} aliases)`);
  const session = {
    id: sessionId,
    ptyProcess: null,
    activeCellId: null,
    isPtyReady: false,
    tailBuf: "",
    sentPos: 0,
    clients: new Set(),
    cells: [],
    pwd: projectRoot,
    rcPath: null,
    rcDir: null,
    isTuiActive: false,
    pendingQueue: [],
    headlessTerminal: null,
    serializeAddon: null,
    promptSalt: null,
    createdAt: Date.now(),
    lastActivity: Date.now()
  };
  sessions.set(sessionId, session);
  persistSession(session);
  spawnPtyForSession(session);
  return session;
}

function attachPtyHandlers(session) {
  const sessionId = session.id;
  const ptyProcess = session.ptyProcess;

  ptyProcess.onExit(({ exitCode }) => {
    debugLog(`[PTY_EXIT] session ${sessionId} code ${exitCode}`);
  });

  ptyProcess.onData((dataStr) => {
      session.lastActivity = Date.now();
      
      if (dataStr.includes('FORCE_TUI_MODE')) {
          debugLog(`[TUI_ENTER_FORCED] session ${sessionId}`);
          session.isTuiActive = true;
          for (const ws of session.clients) ws.send(JSON.stringify({ type: 'tui_enter', cellId: session.activeCellId }));
      }
      if (dataStr.includes('EXIT_TUI_MODE')) {
          debugLog(`[TUI_EXIT_FORCED] session ${sessionId}`);
          session.isTuiActive = false;
          for (const ws of session.clients) ws.send(JSON.stringify({ type: 'tui_exit', cellId: session.activeCellId }));
      }

      const clearMarker = '\x1b[2J';
      const scrollbackClearMarker = '\x1b[3J';
      
      if (!session.isTuiActive && (dataStr.includes(clearMarker) || dataStr.includes(scrollbackClearMarker))) {
          const marker = dataStr.includes(scrollbackClearMarker) ? scrollbackClearMarker : clearMarker;
          const idx = dataStr.indexOf(marker);
          const prefix = dataStr.substring(0, idx);
          const suffix = dataStr.substring(idx + marker.length);
          if (prefix) {
              session.tailBuf += prefix;
              if (session.headlessTerminal) session.headlessTerminal.write(prefix);
              const toSend = session.tailBuf.substring(session.sentPos);
              for (const ws of session.clients) ws.send(JSON.stringify({ type: 'output', data: toSend, cellId: session.activeCellId }));
              session.sentPos = session.tailBuf.length;
          }
          if (session.headlessTerminal) session.headlessTerminal.reset();
          session.tailBuf = ""; session.sentPos = 0;
          if (marker === scrollbackClearMarker) for (const ws of session.clients) ws.send(JSON.stringify({ type: 'clear_history' }));
          if (suffix) {
              setTimeout(() => {
                  session.tailBuf += suffix;
                  if (session.headlessTerminal) session.headlessTerminal.write(suffix);
                  const toSendSuffix = session.tailBuf.substring(session.sentPos);
                  for (const ws of session.clients) ws.send(JSON.stringify({ type: 'output', data: toSendSuffix, cellId: session.activeCellId }));
                  session.sentPos = session.tailBuf.length;
              }, 50);
          }
          return;
      }

      session.tailBuf += dataStr;
      if (session.headlessTerminal) session.headlessTerminal.write(dataStr);

      if (dataStr.includes('\x1b[?1049h')) {
          session.isTuiActive = true;
          const tuiCell = session.cells.find(c => c.id === session.activeCellId);
          if (tuiCell) tuiCell.usedTui = true;
          for (const ws of session.clients) ws.send(JSON.stringify({ type: 'tui_enter', cellId: session.activeCellId }));
      }
      if (dataStr.includes('\x1b[?1049l')) {
          session.isTuiActive = false;
          for (const ws of session.clients) ws.send(JSON.stringify({ type: 'tui_exit', cellId: session.activeCellId }));
      }

      if (session.activeCellId) {
          const cellRef = session.cells.find(c => c.id === session.activeCellId);
          if (cellRef && !cellRef.usedTui) {
              const cursorMoves = (dataStr.match(/\x1b\[\d*;\d*[Hf]/g) || []).length
                                + (dataStr.match(/\x1b\[\d*[ABCDEFG]/g) || []).length;
              const clearOps = (dataStr.match(/\x1b\[[0-3]?[JK]/g) || []).length;
              const hideCursor = dataStr.includes('\x1b[?25l');
              cellRef._ansiScore = (cellRef._ansiScore || 0) + cursorMoves + clearOps * 2 + (hideCursor ? 5 : 0);
              if (cellRef._ansiScore > 40) cellRef.inlineTuiLike = true;
          }
      }

      const finishMatch = parseOutput(session.tailBuf, session.promptSalt);
      if (session.activeCellId && finishMatch) {
          debugLog(`[FINISH] exit=${finishMatch.exitCode} pwd=${JSON.stringify(finishMatch.pwd)}`);
      }
      if (session.activeCellId) {
        const cell = session.cells.find(c => c.id === session.activeCellId);
        if (finishMatch && !session.isTuiActive) {
            debugLog(`[CELL_CLOSE] session ${sessionId} cellId=${session.activeCellId}`);
            const toSend = session.tailBuf.substring(session.sentPos, finishMatch.firstIndex);
            if (toSend.length > 0) {
                if (cell) cell.output = (cell.output || "") + toSend;
                for (const ws of session.clients) ws.send(JSON.stringify({ type: 'output', data: toSend, cellId: session.activeCellId }));
            }
            if (cell) cell.isRunning = false;
            const currentCellId = session.activeCellId;
            const currentPwd = finishMatch.pwd || session.pwd;
            if (finishMatch.pwd) { session.pwd = finishMatch.pwd; persistSession(session); }
            const currentExitCode = finishMatch.exitCode;
            const exitHandler = () => {
                let snapshotAnsi = "";
                let snapshotCols = 120;
                let snapshotRows = 24;
                if (session.headlessTerminal && session.serializeAddon) {
                    snapshotAnsi = session.serializeAddon.serialize();
                    snapshotCols = session.headlessTerminal.cols;
                    snapshotRows = session.headlessTerminal.rows;
                }
                const closedCell = session.cells.find(c => c.id === currentCellId);
                const wasTui = !!(closedCell && (closedCell.usedTui || closedCell.inlineTuiLike));
                if (closedCell) {
                    closedCell.snapshotAnsi = wasTui ? "" : snapshotAnsi;
                    closedCell.snapshotCols = snapshotCols;
                    closedCell.snapshotRows = snapshotRows;
                    closedCell.exitCode = currentExitCode;
                    closedCell.pwd = currentPwd;
                    closedCell.usedTui = wasTui;
                    closedCell.finishedAt = Date.now();
                    persistCell(session, closedCell);
                }
                for (const ws of session.clients) ws.send(JSON.stringify({ type: 'exit', exitCode: currentExitCode, cellId: currentCellId, pwd: currentPwd, snapshotAnsi: wasTui ? "" : snapshotAnsi, snapshotCols, snapshotRows, usedTui: wasTui }));
                if (session.pendingQueue.length > 0) {
                    const nextCmd = session.pendingQueue.shift();
                    startCommand(session, nextCmd.cellId, nextCmd.data);
                }
            };
            setTimeout(exitHandler, 300);
            session.activeCellId = null;
            session.tailBuf = session.tailBuf.substring(finishMatch.matchEnd);
            session.sentPos = 0;
        } else {
            const toSend = session.tailBuf.substring(session.sentPos);
            if (toSend.length > 0) {
                if (cell) cell.output = (cell.output || "") + toSend;
                for (const ws of session.clients) ws.send(JSON.stringify({ type: 'output', data: toSend, cellId: session.activeCellId }));
                session.sentPos = session.tailBuf.length;
            }
        }
      } else {
          if (finishMatch && !session.isPtyReady) {
              session.isPtyReady = true;
              if (finishMatch.pwd) session.pwd = finishMatch.pwd;
              session.tailBuf = session.tailBuf.substring(finishMatch.matchEnd);
              session.sentPos = 0;
          }
          if (session.tailBuf.length > 50000) {
              const toRemove = session.tailBuf.length - 10000;
              session.tailBuf = session.tailBuf.substring(toRemove);
              session.sentPos = Math.max(0, session.sentPos - toRemove);
          }
      }
  });
}

function startCommand(session, cellId, commandData) {
    debugLog(`[COMMAND_START] session ${session.id} cellId=${cellId} cmd=${commandData}`);
    session.activeCellId = cellId; session.isTuiActive = false;
    const newCell = { id: cellId, command: commandData, output: "", isRunning: true, executablePwd: session.pwd, startedAt: Date.now() };
    session.cells.push(newCell);
    persistCell(session, newCell);
    if (session.headlessTerminal) {
        try { session.headlessTerminal.dispose(); } catch (e) {}
        session.headlessTerminal = null;
        session.serializeAddon = null;
    }
    {
        const { cols, rows } = calculateMinSize(session);
        session.headlessTerminal = new Terminal({ cols, rows, allowProposedApi: true, convertEol: true, scrollback: 5000 });
        session.serializeAddon = new SerializeAddon();
        session.headlessTerminal.loadAddon(session.serializeAddon);
    }
    const newCellMsg = JSON.stringify({ type: 'new_cell', cellId, command: commandData });
    // Broadcast to other clients (originating client already added it via UI)
    // Wait, the originating client currently relies on the message too. 
    // Actually, it's safer to let the client handle it, but we MUST ensure keys are unique.
    for (const ws of session.clients) if (ws.readyState === 1) ws.send(newCellMsg);
    if (session.tailBuf.length > 0 && !session.tailBuf.includes('\x1b[2J')) {
        session.headlessTerminal.write(session.tailBuf);
        const outputMsg = JSON.stringify({ type: 'output', data: session.tailBuf, cellId: cellId });
        for (const ws of session.clients) if (ws.readyState === 1) ws.send(outputMsg);
        session.tailBuf = ""; session.sentPos = 0;
    } else { session.tailBuf = ""; session.sentPos = 0; }
    session.ptyProcess.write(commandData + '\r\n');
}

wss.on('connection', (ws, req) => {
  let activeId = null;
  ws.on('message', (m) => {
    try {
      const msg = JSON.parse(m.toString());
      const touched = sessions.get(activeId);
      if (touched) touched.lastActivity = Date.now();
      if (msg.type === 'join_session') {
        activeId = msg.sessionId || uuidv4();
        const s = createSession(activeId);
        s.lastActivity = Date.now();
        s.clients.add(ws);
        debugLog(`[WS_JOIN] session ${activeId}`);
        if (msg.cols && msg.rows) { ws.requestedCols = msg.cols; ws.requestedRows = msg.rows; handleResize(s); }
        ws.send(JSON.stringify({ 
            type: 'session_init', sessionId: s.id, pwd: s.pwd, cells: s.cells, 
            isTuiActive: s.isTuiActive, activeCellId: s.activeCellId 
        }));
        if (s.headlessTerminal && s.serializeAddon) {
            ws.send(JSON.stringify({ type: 'sync', cellId: s.activeCellId, data: s.serializeAddon.serialize() }));
        }
      } else if (msg.type === 'start') {
        const s = sessions.get(activeId);
        if (s) { 
            if (s.activeCellId !== null) s.pendingQueue.push({ cellId: msg.cellId, data: msg.data });
            else startCommand(s, msg.cellId, msg.data);
        }
      } else if (msg.type === 'input') {
        const s = sessions.get(activeId);
        if (s) s.ptyProcess.write(msg.data);
      } else if (msg.type === 'resize') {
        ws.requestedCols = msg.cols; ws.requestedRows = msg.rows;
        const s = sessions.get(activeId);
        if (s) handleResize(s);
      }
    } catch (e) { console.error("WS Message error:", e); }
  });
  ws.on('close', () => { if (activeId) { const s = sessions.get(activeId); if (s) s.clients.delete(ws); } });
});

function destroySession(sessionId, reason) {
    const s = sessions.get(sessionId);
    if (!s) return false;
    debugLog(`[SESSION_DESTROY] ${sessionId} reason=${reason}`);
    try { if (s.ptyProcess) s.ptyProcess.kill('SIGKILL'); } catch (e) {}
    try { if (s.headlessTerminal) s.headlessTerminal.dispose(); } catch (e) {}
    try { if (s.rcPath && fs.existsSync(s.rcPath)) fs.unlinkSync(s.rcPath); } catch (e) {}
    try { if (s.rcDir && fs.existsSync(s.rcDir)) fs.rmSync(s.rcDir, { recursive: true, force: true }); } catch (e) {}
    try { persistence.deleteSession(db, sessionId); } catch (e) { debugLog(`[DB_ERR] deleteSession ${sessionId}: ${e.message}`); }
    for (const ws of s.clients) {
        try { ws.send(JSON.stringify({ type: 'session_destroyed', sessionId, reason })); } catch (e) {}
    }
    sessions.delete(sessionId);
    return true;
}

const IDLE_TIMEOUT_MS = parseInt(process.env.TERMBOOK_IDLE_TIMEOUT_MS || (60 * 60 * 1000), 10);
const GC_INTERVAL_MS = 5 * 60 * 1000;
setInterval(() => {
    const now = Date.now();
    for (const [id, s] of sessions.entries()) {
        if (s.clients.size > 0) continue;
        if (s.activeCellId) continue;
        if (now - s.lastActivity > IDLE_TIMEOUT_MS) destroySession(id, 'idle_timeout');
    }
}, GC_INTERVAL_MS);

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
app.get('/api/config', (req, res) => res.json(config));
app.get('/api/sessions', (req, res) => res.json({ sessions: Array.from(sessions.values()).map(s => ({ id: s.id || "", pwd: s.pwd || "", cells: s.cells || [] })) }));
app.get('/api/sessions/:id', (req, res) => {
  const s = sessions.get(req.params.id);
  if (s) res.json({ id: s.id, pwd: s.pwd, cells: s.cells });
  else res.status(404).json({ error: 'Not found' });
});
app.delete('/api/sessions/:id', (req, res) => {
  if (destroySession(req.params.id, 'user_request')) res.json({ ok: true });
  else res.status(404).json({ error: 'Not found' });
});

const PORT = process.env.PORT || 4001;
if (require.main === module) {
  server.listen(PORT, () => console.log(`[*] Backend server listening on port ${PORT}`));
}
module.exports = { app, server };
