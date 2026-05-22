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
const completion = require('./completion');
const envDetect = require('./env_detect');
const sshMod = require('./ssh');

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
        // the SSH integration state. See top of attachPtyHandlers + startCommand for
        // the state machine. These are runtime-only (never persisted) — a
        // restored session always starts in non-SSH mode.
        sshActive: false,
        sshHost: null,
        sshOuterCellId: null,
        sshPromptSalt: null,
        sshState: 'idle', // 'idle' | 'pending' | 'injecting' | 'active' | 'failed'
        sshIdleTimer: null,
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
    // When a TUI app is active (modal open), the cell xterm is not
    // visible — only the modal terminal matters. Use the MAX of any
    // client requesting a "TUI" size (those that have flagged tuiCols
    // / tuiRows on the WS connection) so the PTY matches what the
    // modal actually shows. Otherwise, fall back to MIN across regular
    // clients (so a small inline cell doesn't get cropped output).
    //
    // Without this distinction, a session with both a cell xterm
    // (small, e.g. 145x24) and a modal xterm (big, e.g. 182x42) would
    // have the PTY sized to min(145,182)x min(24,42) = 145x24 → nvim
    // would draw at 24 rows even though the modal can show 42 → 18 rows
    // of empty space below the status line (visible in the user's
    // screenshot).
    if (session.isTuiActive) {
        let maxCols = 0, maxRows = 0;
        for (const client of session.clients) {
            if (client.tuiCols) maxCols = Math.max(maxCols, client.tuiCols);
            if (client.tuiRows) maxRows = Math.max(maxRows, client.tuiRows);
        }
        if (maxCols > 0 && maxRows > 0) return { cols: maxCols, rows: maxRows };
        // Fall through to the min logic if no tui size has been reported yet.
    }
    let minCols = Infinity;
    let minRows = Infinity;
    for (const client of session.clients) {
        if (client.requestedCols) minCols = Math.min(minCols, client.requestedCols);
        if (client.requestedRows) minRows = Math.min(minRows, client.requestedRows);
    }
    // Defaults when no client has reported a size yet (e.g. between
    // PTY spawn and the first 'resize' from the frontend). Bumping rows
    // from 24 → 40 covers most modal heights — important because a TUI
    // app (nvim, less, htop) that starts at 24 rows and gets resized to
    // 40+ during its initial draw can get into weird half-redrawn
    // states on some hosts. Bigger initial size, fewer surprises.
    if (minCols === Infinity) minCols = 120;
    if (minRows === Infinity) minRows = 40;
    return { cols: minCols, rows: minRows };
}

function handleResize(session) {
    if (!session.ptyProcess) return;
    const { cols, rows } = calculateMinSize(session);
    debugLog(`[RESIZE] session ${session.id} -> ${cols}x${rows} (isTuiActive=${session.isTuiActive}, clients=${session.clients.size})`);
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
  // The OSC 1338 TBENV marker lets the backend pick up shell-side env vars
  // (VIRTUAL_ENV, CONDA_DEFAULT_ENV) that the parent process can't see.
  // Each PROMPT_COMMAND tick emits venv=<basename> and conda=<name>; keys
  // are omitted when empty. We use bash parameter expansion (${var##*/})
  // instead of $(basename ...) because escaping inner quotes inside the
  // single-quoted PROMPT_COMMAND is fragile and produced trailing-quote
  // artifacts. Git branch is detected backend-side from pwd.
  const tbenvSnippet = '__tb_venv="${VIRTUAL_ENV:+venv=${VIRTUAL_ENV##*/}}"; __tb_conda="${CONDA_DEFAULT_ENV:+conda=$CONDA_DEFAULT_ENV}"; __tb_env="$__tb_venv${__tb_venv:+${__tb_conda:+;}}$__tb_conda"; printf "\\033]1338;TBENV;%s\\007" "$__tb_env"';
  return [
    `cd ${JSON.stringify(projectRoot)}`,
    `export PS1=' '`,
    `export PS2=' '`,
    // Emit OSC 1338 (env) BEFORE OSC 133;D (finish marker) so the env
    // marker is guaranteed to be in tailBuf when parseOutput sees the
    // 133;D marker. Otherwise the env marker arrives in a later chunk
    // and gets discarded with the rest of the tailBuf after cell close.
    `export PROMPT_COMMAND='__tbexit=$?; ${tbenvSnippet}; printf "\\033]133;D;%s;%s\\007\\033]7;file://localhost%s\\007" "$__tbexit" "${promptSalt}" "$PWD"'`,
    `export CLICOLOR=1`,
    `export CLICOLOR_FORCE=1`,
    `export LSCOLORS='ExGxFxdaCxDaDahbadeche'`,
    `export TERM=xterm-256color`,
    // Tell python venv / conda not to mutate PS1. We display this info as
    // chips on the cell instead. Without these, the prompt becomes
    // "(venv) " and that prefix leaks into the next cell's output.
    `export VIRTUAL_ENV_DISABLE_PROMPT=1`,
    `export CONDA_CHANGEPS1=false`,
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
  // Build the PTY env, stripping CI-detection markers that some tools
  // (e.g. gemini-cli, npm, chalk, Ink) use to switch into a non-interactive
  // / no-color "headless" mode. We ARE an interactive terminal, so these
  // shouldn't be inherited from however the backend was launched.
  //
  // Strip:
  //   CI / GITHUB_ACTIONS / etc.: many CLIs (gemini-cli) go into headless
  //   mode and break when they see CI=true.
  //   TMUX / STY: if Termbook was launched from a tmux/screen session,
  //   these leak into the child env. Apps that detect them (notably
  //   neovim) assume they're INSIDE tmux and disable features like
  //   alt-screen, mouse passthrough, true-color — because tmux is
  //   supposed to handle those. The child shell+nvim should think
  //   they're in a regular standalone terminal (Termbook), not inside
  //   nested tmux.
  //   NO_COLOR: parent may have it set for non-color output; we want
  //   color in cells.
  // Also reset TERM to xterm-256color so anything that saw TERM=dumb on
  // the parent gets a real terminal.
  const childEnv = { ...process.env };
  for (const k of [
    'CI', 'CONTINUOUS_INTEGRATION', 'GITHUB_ACTIONS', 'BUILDKITE', 'RUN_ID',
    'GITLAB_CI', 'JENKINS_URL', 'NO_COLOR',
    'TMUX', 'TMUX_PANE', 'TMUX_PLUGIN_MANAGER_PATH',
    'STY',                  // screen(1)
    'ZELLIJ', 'ZELLIJ_PANE_ID', 'ZELLIJ_SESSION_NAME', // zellij
  ]) {
    delete childEnv[k];
  }
  childEnv.TERM = 'xterm-256color';
  childEnv.COLORTERM = 'truecolor';
  childEnv.FORCE_COLOR = '3';
  // Some terminals advertise themselves so apps can opt-in to richer
  // integrations. Identify ourselves as Termbook.
  childEnv.TERM_PROGRAM = 'termbook';
  const ptyProcess = pty.spawn(shell, ['--rcfile', rcPath, '-i'], {
    name: 'xterm-256color',
    cols: 120,
    rows: 40,
    cwd: startCwd,
    env: childEnv,
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
    // the SSH integration state — see attachPtyHandlers / startCommand. Runtime-only.
    sshActive: false,
    sshHost: null,
    sshOuterCellId: null,
    sshPromptSalt: null,
    sshState: 'idle',
    sshIdleTimer: null,
    createdAt: Date.now(),
    lastActivity: Date.now()
  };
  sessions.set(sessionId, session);
  persistSession(session);
  spawnPtyForSession(session);
  return session;
}

// ──────────────────────────────────────────────────────────────────────
// the SSH integration helpers
// ──────────────────────────────────────────────────────────────────────
//
// When a cell command starts with `ssh ...` (not a single-shot, not opted
// out), we treat it as a SSH-integration candidate. The high-level lifecycle:
//
//   idle ──[user submits `ssh host`]──> pending
//   pending ──[remote prompt detected + 600ms idle]──> injecting
//   injecting ──[we write bootstrap line to PTY]──> active
//   active ──[parser sees `which='ssh'` finishMatch]──> next remote cell
//   active ──[parser sees `which='local'` finishMatch]──> idle (ssh exited)
//
// In `active` state:
//   - Each user `start` message creates a NEW remote cell and writes
//     `cmd + '\r'` to the existing PTY (no new PTY spawn).
//   - Each `which='ssh'` finishMatch closes the current remote cell with
//     the REMOTE exit code / pwd / env.
//
// The OUTER ssh cell is closed (exit 0, marked usedSshSession=true) at the
// moment we successfully inject + see the first remote prompt close. After
// that, the user sees a chain of remote cells each tagged with the SSH
// chip.
//
// If injection never succeeds within INJECT_TIMEOUT_MS, we mark the
// session `sshState='failed'` and fall back to today's "pre-integration"
// behavior (cell stays open, unsalted markers may close things).

const SSH_INJECT_IDLE_MS = 600;        // quiet window after prompt before we inject
// 12s is generous enough to cover slow remote hosts (high-latency links,
// remote shells that need to load p10k themes / oh-my-zsh plugins) while
// still being short enough that a truly broken inject (non-bash/zsh
// shell, output suppression) doesn't leave the user staring at a frozen
// cell for an uncomfortable amount of time.
const SSH_INJECT_TIMEOUT_MS = 12000;

function clearSshState(session) {
  if (session.sshIdleTimer) { clearTimeout(session.sshIdleTimer); session.sshIdleTimer = null; }
  // Reject any in-flight remote completion requests; they can't possibly
  // succeed now that the ssh session is gone.
  if (session.pendingCompletions && session.pendingCompletions.length > 0) {
      for (const pc of session.pendingCompletions) {
          try { pc.reject(new Error('ssh session ended')); } catch (e) {}
      }
      session.pendingCompletions = [];
  }
  session.completionLeftover = '';
  session.sshActive = false;
  session.sshHost = null;
  session.sshOuterCellId = null;
  session.sshPromptSalt = null;
  session.sshState = 'idle';
}

// Ask the remote shell to complete `input`. Returns a Promise<{candidates,
// currentToken}>. Times out after timeoutMs and resolves with an empty
// candidate list rather than throwing — Tab should never throw at the user.
//
// The mechanism: write `\x15__tb_complete '<reqId>' '<prefix>'\r` to the
// PTY. The injected __tb_complete function emits salted TBCMP markers.
// onData detects + strips them; we resolve here.
//
// Concurrency: a per-session counter generates reqIds, so multiple in-flight
// Tabs (rare but possible) don't confuse each other.
const REMOTE_COMPLETION_TIMEOUT_MS = 600;
function requestRemoteCompletion(session, input, timeoutMs = REMOTE_COMPLETION_TIMEOUT_MS) {
    return new Promise((resolve) => {
        // Split input into pre + currentToken on the LAST space (mirrors
        // local completion semantics). Token may be empty (e.g. user typed
        // "ls " + Tab to list cwd).
        const lastSpace = input.lastIndexOf(' ');
        const currentToken = lastSpace >= 0 ? input.slice(lastSpace + 1) : input;
        // First-token detection: no spaces means user is typing the COMMAND
        // name → ask remote for executables on PATH + builtins/aliases.
        // Otherwise it's a path/argument → glob in the remote cwd.
        const kind = (lastSpace < 0) ? 'cmd' : 'path';
        if (!session.pendingCompletions) session.pendingCompletions = [];
        session.sshCompletionReqCounter = (session.sshCompletionReqCounter || 0) + 1;
        const reqId = `rc${session.sshCompletionReqCounter}`;
        let settled = false;
        const settle = (result) => { if (!settled) { settled = true; resolve(result); } };
        const pc = {
            reqId,
            resolve: (r) => settle({ candidates: r.candidates, currentToken, kind }),
            reject: () => settle({ candidates: [], currentToken, kind }),
        };
        session.pendingCompletions.push(pc);
        try {
            session.ptyProcess.write(sshMod.buildRemoteCompletionRequest(reqId, currentToken, kind));
        } catch (e) {
            session.pendingCompletions = session.pendingCompletions.filter(p => p !== pc);
            settle({ candidates: [], currentToken, kind });
            return;
        }
        setTimeout(() => {
            if (!settled) {
                // Remove from queue (the response may still arrive late;
                // onData will just find no matching pending entry and
                // forward the bytes — acceptable harmless cosmetic).
                session.pendingCompletions = session.pendingCompletions.filter(p => p !== pc);
                settle({ candidates: [], currentToken });
            }
        }, timeoutMs);
    });
}

function performSshInjection(session) {
  if (session.sshState !== 'injecting') return;
  const snippet = sshMod.buildRemoteIntegration(session.sshPromptSalt);
  debugLog(`[SSH_INJECT] session ${session.id} writing bootstrap (${snippet.length} bytes)`);
  // Write bootstrap + carriage return. The remote shell will execute it.
  // Bootstrap starts with `stty -echo` so further keystrokes don't echo,
  // and ends with one immediate __tb_remote_prompt call that emits the
  // first salted marker. When parseOutput sees that marker with which='ssh',
  // attachPtyHandlers transitions the state to 'active' and closes the
  // outer ssh cell.
  try {
    session.ptyProcess.write(snippet + '\r');
  } catch (e) {
    debugLog(`[SSH_INJECT_FAIL] write error: ${e.message}`);
    session.sshState = 'failed';
    return;
  }
  // Safety timer: if we don't see the salted marker within INJECT_TIMEOUT_MS,
  // give up (e.g. remote shell wasn't bash/zsh, or eaten silently).
  setTimeout(() => {
    if (session.sshState === 'injecting') {
      debugLog(`[SSH_INJECT_TIMEOUT] session ${session.id} no salted marker after ${SSH_INJECT_TIMEOUT_MS}ms — fallback`);
      session.sshState = 'failed';
    }
  }, SSH_INJECT_TIMEOUT_MS);
}

// Called from onData when we're in sshState='pending'. Looks at the most
// recent chunk + tailBuf, and if the tail looks like a fresh remote prompt
// awaiting input, schedules an injection after SSH_INJECT_IDLE_MS of quiet.
function maybeScheduleSshInjection(session) {
  if (session.sshState !== 'pending') return;
  if (!sshMod.looksLikeRemotePromptReady(session.tailBuf.slice(-2000))) return;
  if (session.sshIdleTimer) clearTimeout(session.sshIdleTimer);
  session.sshIdleTimer = setTimeout(() => {
    if (session.sshState !== 'pending') return;
    session.sshState = 'injecting';
    performSshInjection(session);
  }, SSH_INJECT_IDLE_MS);
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

      // ── the SSH integration: remote completion RPC response handling ──
      // If a TBCMP/TBCMPEND pair appears in the incoming chunk (or across
      // chunks), extract candidates and STRIP the entire request+response
      // range from the chunk so they don't leak into tailBuf, the headless
      // terminal, or the broadcast stream. The TBCMP markers carry the
      // per-SSH salt + the request's reqId so we ignore unrelated ones.
      if (session.sshActive && session.pendingCompletions && session.pendingCompletions.length > 0) {
          // Combine any unfinished leftover from a previous chunk + this chunk.
          let merged = (session.completionLeftover || '') + dataStr;
          let changed = true;
          while (changed) {
              changed = false;
              for (let i = 0; i < session.pendingCompletions.length; i++) {
                  const pc = session.pendingCompletions[i];
                  const found = sshMod.parseRemoteCompletionResponse(merged, pc.reqId, session.sshPromptSalt);
                  if (found) {
                      // Strip the range from merged.
                      merged = merged.slice(0, found.rangeStart) + merged.slice(found.rangeEnd);
                      pc.resolve({ candidates: found.candidates, count: found.count });
                      session.pendingCompletions.splice(i, 1);
                      changed = true;
                      break;
                  }
              }
          }
          // If a TBCMP start marker is still present without END, this chunk
          // is partial — buffer the whole thing for next time. Otherwise
          // emit merged as the new dataStr.
          if (merged.includes('\x1b]1339;TBCMP;')) {
              // Save up to 16KB tail to avoid unbounded growth on truly stuck responses.
              session.completionLeftover = merged.length < 16384 ? merged : merged.slice(-16384);
              dataStr = '';
          } else {
              session.completionLeftover = '';
              dataStr = merged;
          }
      }

      session.tailBuf += dataStr;
      if (session.headlessTerminal) session.headlessTerminal.write(dataStr);

      // the SSH integration: in 'pending' state, watch tailBuf for a remote prompt.
      // We schedule (or reset) an injection timer; when output goes quiet
      // for SSH_INJECT_IDLE_MS, we write the integration bootstrap.
      if (session.sshState === 'pending') {
          maybeScheduleSshInjection(session);
      }

      // ── TUI detection: alt-screen + content-based fallback ──
      //
      // Standard signal: \x1b[?1049h (DECSET 1049 — enter alt-screen
      // buffer). Classic vim, less, htop, etc. all emit this on startup
      // and we open the modal immediately.
      //
      // Fallback for modern apps that DON'T use alt-screen (notably
      // neovim ≥0.9 in many configs — it draws in-place using absolute
      // cursor positioning instead of swapping buffers): we observe a
      // combination of "I am taking over the screen" signals that no
      // normal command (cat, echo, ls, grep, gemini-cli, etc.) ever
      // emits in combination:
      //   * bracketed paste enable (\x1b[?2004h) — interactive line
      //     editor sentinel
      //   * mouse mode enable (\x1b[?100x{h}|?1004h|?1006h) — only TUI
      //     apps want raw mouse events
      //   * cursor hide (\x1b[?25l) — TUIs typically hide cursor while
      //     redrawing
      //   * 5+ absolute cursor positions (\x1b[N;NH) — fullscreen
      //     redraws use these heavily; line-streaming output doesn't
      // We require AT LEAST TWO distinct strong signals before
      // promoting, so a CLI that just hides the cursor briefly (e.g.
      // a progress spinner) doesn't trigger promotion. The strong
      // signals are: mouseMode, bracketedPaste-with-cursorHide, OR
      // many absolute positions.
      //
      // This is a "real terminal" approach — we don't blacklist or
      // whitelist app NAMES; we observe BEHAVIOR. If the user runs an
      // unknown app that genuinely takes over the screen, it gets
      // promoted. If they run `nvim --headless cat-mode-thing` (which
      // wouldn't use these signals), it stays inline.
      if (session.activeCellId && session._tuiSignals && !session._tuiSignals.promoted) {
          const s = session._tuiSignals;
          if (dataStr.includes('\x1b[?1049h')) s.altscreen = true;
          if (/\x1b\[\?(1000|1002|1003|1004|1006|1015|1016)h/.test(dataStr)) s.mouseMode = true;
          if (dataStr.includes('\x1b[?25l')) s.cursorHide = true;
          if (dataStr.includes('\x1b[?2004h')) s.bracketedPaste = true;
          const absMatches = dataStr.match(/\x1b\[\d+;\d+H/g);
          if (absMatches) s.absolutePositions += absMatches.length;

          // Promote when we have strong signals.
          const strongCount =
              (s.altscreen ? 1 : 0) +
              (s.mouseMode ? 1 : 0) +
              (s.absolutePositions >= 5 ? 1 : 0) +
              (s.cursorHide && s.bracketedPaste ? 1 : 0);

          if (strongCount >= 2 || s.altscreen) {
              s.promoted = true;
              session.isTuiActive = true;
              const tuiCell = session.cells.find(c => c.id === session.activeCellId);
              // Mark the cell as "currently in TUI mode" so the frontend
              // opens the modal. We do NOT set usedTui yet — usedTui is
              // about whether the FINAL snapshot is throwaway TUI screen
              // content, and we only know that at cell-close time. A
              // command like `brew install` enters alt-screen briefly
              // for a progress display, then exits alt-screen and writes
              // SUMMARY output to the main screen — that summary IS the
              // snapshot the user wants to see, not hidden behind an
              // "Interactive session ended" placeholder.
              //
              // The close-handler (see ~30 lines below) sets usedTui only
              // if session.isTuiActive is still true at close time (i.e.
              // the cell ended WHILE in alt-screen, like vim/nvim).
              if (tuiCell) tuiCell._promotedTui = true;
              debugLog(`[TUI_PROMOTE] session ${sessionId} cellId=${session.activeCellId} signals=${JSON.stringify(s)}`);
              for (const ws of session.clients) ws.send(JSON.stringify({ type: 'tui_enter', cellId: session.activeCellId }));
              // Note: we previously sent `\x1b[18t` (CSI window-size
              // query) here to nudge nvim into a full redraw at the new
              // post-modal size. Removed because:
              //   - classic vim treats it as literal `8t` input chars
              //     and inserts them into the buffer (test F caught this)
              //   - nvim's SIGWINCH handler already does the right thing
              //     when PTY resize fires after the modal opens
              // Any redraw race that remains is now nvim-side and not
              // worth fighting from our end.
          }
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

      // SSH-aware salt list: when we've injected a SSH integration into a
      // remote shell, BOTH the local bash salt and the per-SSH salt close
      // cells (the inner one wins on earliest index). `which` in finishMatch
      // tells us which.
      //
      // `allowUnsalted`: TRUE when SSH is NOT active so that today's "leaky
      // the SSH integration" still works for users on shells with built-in OSC 133
      // (p10k, etc.) BEFORE they hit an `ssh ...` command. The moment SSH
      // is active, we require salted markers — this is what makes the
      // remote cell boundaries SAFE (no remote-shell-emitted unsalted
      // marker can close a the SSH integration cell).
      const allowUnsalted = !session.sshActive;
      const finishMatch = parseOutput(
          session.tailBuf,
          [session.promptSalt, session.sshPromptSalt].filter(Boolean),
          { allowUnsalted },
      );
      if (session.activeCellId && finishMatch) {
          debugLog(`[FINISH] which=${finishMatch.which} exit=${finishMatch.exitCode} pwd=${JSON.stringify(finishMatch.pwd)} env=${JSON.stringify(finishMatch.env || {})}`);
      }
      if (session.activeCellId) {
        const cell = session.cells.find(c => c.id === session.activeCellId);
        if (finishMatch && !session.isTuiActive) {
            // ── the SSH integration: special handling for the BOOTSTRAP success signal ──
            // When sshState='injecting' and we get a which='ssh' finishMatch,
            // it means our bootstrap line just executed on the remote shell
            // and __tb_remote_prompt fired. The marker is the SECOND output
            // (the first being the echoed bootstrap line itself). We close
            // the outer ssh cell now with usedSshSession=true; the next
            // user-typed remote command will open a fresh remote cell.
            //
            // We deliberately DON'T treat this as a real "command finished" —
            // we still close the outer cell, then transition to 'active'.
            // Allow the late-arrival case: a salted marker that comes AFTER
            // SSH_INJECT_TIMEOUT_MS fired (sshState='failed') still triggers
            // the active transition. The user gets full the SSH integration even if the
            // first prompt took longer than expected.
            if ((session.sshState === 'injecting' || session.sshState === 'failed') && finishMatch.which === 'ssh') {
                debugLog(`[SSH_INJECT_OK] session ${sessionId} (was ${session.sshState}) — outer cell ${session.activeCellId} closes, transitioning to active`);
                session.sshState = 'active';
                if (session.sshIdleTimer) { clearTimeout(session.sshIdleTimer); session.sshIdleTimer = null; }
                // Update remote pwd from the integration's first emission.
                if (finishMatch.pwd) session.pwd = finishMatch.pwd;
                // Fall through to the normal close logic below; the outer
                // cell is closed as a normal cell with exit 0. Mark it
                // usedSshSession so frontend can render a clean "SSH session
                // started" placeholder instead of the noisy bootstrap echo.
                const outerCell = session.cells.find(c => c.id === session.sshOuterCellId);
                if (outerCell) outerCell.usedSshSession = true;
                // Broadcast: the SSH integration is now active. Frontend will start
                // forwarding control keys (Ctrl+C/D/L) from the chat input
                // to the remote PTY when no cell is currently running.
                for (const ws of session.clients) ws.send(JSON.stringify({
                    type: 'ssh_state', sshActive: true, sshHost: session.sshHost,
                }));
            }
            debugLog(`[CELL_CLOSE] session ${sessionId} cellId=${session.activeCellId} which=${finishMatch.which} bytesEmitted=${session._cellBytesEmitted || 0} durationMs=${Date.now() - (session._cellStartTime || Date.now())} clients=${session.clients.size}`);
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
            const shellEnv = finishMatch.env || {};
            // For remote cells (which='ssh'), env chips come from the remote
            // shell's TBENV emission (branch=<git>, host=<hostname>, plus
            // venv/conda). For local cells (which='local'), git branch is
            // detected from the local filesystem at currentPwd.
            const isRemoteCell = finishMatch.which === 'ssh';
            const gitBranch = isRemoteCell
                ? (shellEnv.branch || null)
                : envDetect.detectGitBranch(currentPwd);
            const virtualEnv = shellEnv.venv || null;
            const condaEnv = shellEnv.conda || null;
            const remoteHost = isRemoteCell ? (shellEnv.host || session.sshHost || null) : null;
            const wasSshSession = !!(cell && cell.usedSshSession);
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
                // Determine whether the snapshot is meaningful or just a
                // throwaway TUI screen.
                //
                // Rule: the cell was a "real TUI" (snapshot hidden, show
                // "Interactive session ended" placeholder) IF:
                //   1. It was promoted to TUI mode at some point
                //      (_promotedTui=true), AND
                //   2. Its main-screen snapshot at close is essentially
                //      empty — just whitespace + a prompt char or two.
                //
                // vim/nvim/less/htop: enter alt-screen, stay there, exit
                // at close → main screen has only the bash prompt that
                // was there before → snapshot is empty → wasTui=true.
                //
                // brew install / npm install: stream output, enter
                // alt-screen briefly, exit, write SUMMARY → snapshot has
                // real content → wasTui=false, show it.
                //
                // gemini-cli (inlineTuiLike, high ANSI score, no
                // alt-screen): never promoted, snapshot always shown.
                let wasTui = false;
                if (closedCell && closedCell._promotedTui) {
                    // Strip ANSI escapes and whitespace; what remains?
                    const visibleContent = (snapshotAnsi || '')
                        .replace(/\x1b\][^\x07]*\x07/g, '')   // OSC seqs
                        .replace(/\x1b\[[0-9;:?]*[a-zA-Z]/g, '') // CSI seqs
                        .replace(/\x1b[()*+][\x20-\x7e]/g, '') // charset seqs
                        .replace(/[\s\u00a0❯$#%>]/g, '')      // whitespace + prompt chars
                        .length;
                    wasTui = visibleContent < 10;
                }
                if (closedCell) {
                    closedCell.snapshotAnsi = wasTui ? "" : snapshotAnsi;
                    closedCell.snapshotCols = snapshotCols;
                    closedCell.snapshotRows = snapshotRows;
                    closedCell.exitCode = currentExitCode;
                    closedCell.pwd = currentPwd;
                    closedCell.usedTui = wasTui;
                    closedCell.finishedAt = Date.now();
                    closedCell.gitBranch = gitBranch;
                    closedCell.virtualEnv = virtualEnv;
                    closedCell.condaEnv = condaEnv;
                    closedCell.remoteHost = remoteHost;
                    closedCell.usedSshSession = wasSshSession;
                    persistCell(session, closedCell);
                }
                for (const ws of session.clients) ws.send(JSON.stringify({
                    type: 'exit',
                    exitCode: currentExitCode,
                    cellId: currentCellId,
                    pwd: currentPwd,
                    snapshotAnsi: wasTui ? "" : snapshotAnsi,
                    snapshotCols, snapshotRows,
                    usedTui: wasTui,
                    gitBranch, virtualEnv, condaEnv,
                    remoteHost,
                    usedSshSession: wasSshSession,
                }));
                if (session.pendingQueue.length > 0) {
                    const nextCmd = session.pendingQueue.shift();
                    startCommand(session, nextCmd.cellId, nextCmd.data);
                }
            };
            setTimeout(exitHandler, 300);
            // ── the SSH integration: if a which='local' finishMatch arrived while
            // sshActive, that means the OUTER ssh process exited (control
            // returned to our local bash). Tear down SSH state so subsequent
            // commands are normal local cells again.
            if (session.sshActive && finishMatch.which === 'local') {
                debugLog(`[SSH_END] session ${sessionId} outer ssh exited`);
                clearSshState(session);
                // Broadcast: back to normal local mode. Chat input stops
                // forwarding control keys.
                for (const ws of session.clients) ws.send(JSON.stringify({
                    type: 'ssh_state', sshActive: false, sshHost: null,
                }));
            }
            session.activeCellId = null;
            session.tailBuf = session.tailBuf.substring(finishMatch.matchEnd);
            session.sentPos = 0;
        } else {
            const toSend = session.tailBuf.substring(session.sentPos);
            if (toSend.length > 0) {
                if (cell) cell.output = (cell.output || "") + toSend;
                session._cellBytesEmitted = (session._cellBytesEmitted || 0) + toSend.length;
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
    // Per-cell byte counter for diagnostics. Logged at CELL_CLOSE so we
    // can tell whether "stuck cell" was due to no output reaching it,
    // output reaching it but no finish marker, etc.
    session._cellBytesEmitted = 0;
    session._cellStartTime = Date.now();

    // ── the SSH integration detection ──
    // If we're starting a NEW top-level command (not already inside an
    // active SSH session), inspect commandData. When it's an interactive
    // `ssh user@host`, transition to sshState='pending' so the onData
    // handler will inject our integration once the remote prompt shows up.
    // Single-shot ssh (with a trailing remote command) is left alone — it
    // behaves identically to any other local one-shot command.
    let isSshOuterStart = false;
    let inSshContext = session.sshActive && session.sshState === 'active';
    if (!inSshContext) {
        const sshInfo = sshMod.parseSshCommand(commandData);
        if (sshInfo.isSsh && !sshInfo.isSingleShot && !sshInfo.optOut) {
            session.sshActive = true;
            session.sshHost = sshInfo.host;
            session.sshOuterCellId = cellId;
            session.sshPromptSalt = uuidv4().replace(/-/g, '');
            session.sshState = 'pending';
            isSshOuterStart = true;
            // Replace commandData with the cleaned form (--no-termbook stripped).
            commandData = sshInfo.cleanedCommand;
            debugLog(`[SSH_START] session ${session.id} host=${sshInfo.host} salt=${session.sshPromptSalt}`);
        }
    }

    session.activeCellId = cellId; session.isTuiActive = false;
    session._tuiSignals = { altscreen: false, mouseMode: false, cursorHide: false, absolutePositions: 0, promoted: false };

    const newCell = {
        id: cellId,
        command: commandData,
        output: "",
        isRunning: true,
        executablePwd: session.pwd,
        startedAt: Date.now(),
        // Tag remote cells with the SSH host so the frontend can render
        // a 🔌 chip. Only set for cells issued WHILE in an active SSH
        // session — the outer `ssh ...` cell itself is NOT tagged this
        // way (it's tagged later with usedSshSession instead).
        remoteHost: inSshContext ? session.sshHost : null,
    };
    session.cells.push(newCell);
    persistCell(session, newCell);

    // Recreate the headless terminal at the cell boundary so the snapshot
    // covers only this cell's output. EXCEPTION: when we're inside an
    // active SSH session, the PTY is shared with the remote shell and we
    // want headless terminal to be cell-scoped too — same logic applies.
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
    const newCellMsg = JSON.stringify({
        type: 'new_cell',
        cellId,
        command: commandData,
        remoteHost: newCell.remoteHost,
    });
    for (const ws of session.clients) if (ws.readyState === 1) ws.send(newCellMsg);
    if (session.tailBuf.length > 0 && !session.tailBuf.includes('\x1b[2J')) {
        // In an the active SSH integration SSH cell, tailBuf at this point contains the
        // remote shell's next-prompt redraw (drawn between cells). It's
        // visual noise — the user doesn't care that the remote shell
        // re-printed "~  ❯" before they hit Enter. Discard it AND don't
        // write it into the new headlessTerminal.
        // For local cells, this is residual output that legitimately
        // belongs in the next cell.
        if (!inSshContext) {
            session.headlessTerminal.write(session.tailBuf);
            const outputMsg = JSON.stringify({ type: 'output', data: session.tailBuf, cellId: cellId });
            for (const ws of session.clients) if (ws.readyState === 1) ws.send(outputMsg);
        }
        session.tailBuf = ""; session.sentPos = 0;
    } else { session.tailBuf = ""; session.sentPos = 0; }
    // Send '\r' only (not '\r\n'). The TTY line discipline maps '\r' to '\n'
    // when ICRNL is set (default), which is what bash needs to execute the
    // line. Sending '\r\n' leaves a stray '\n' in the input queue that a
    // subsequent `read` (or anything reading stdin) would consume as an
    // empty line.
    session.ptyProcess.write(commandData + '\r');
    void isSshOuterStart; // (reserved for future use; currently the state machine handles it)
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
            isTuiActive: s.isTuiActive, activeCellId: s.activeCellId,
            // the SSH integration state — frontend uses sshActive to forward
            // control keys (Ctrl+C/D/L) from the chat input to the remote
            // shell PTY when the user is idle between remote commands.
            sshActive: !!s.sshActive && s.sshState === 'active',
            sshHost: s.sshHost || null,
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
        // Frontend can flag a resize as coming from the TUI modal (vs the
        // inline cell xterm). When a TUI app is active, calculateMinSize
        // uses the MAX of tuiCols/tuiRows (so the modal's real size wins
        // over any small inline-cell size still being reported).
        if (msg.isTui) {
            ws.tuiCols = msg.cols; ws.tuiRows = msg.rows;
        } else {
            ws.requestedCols = msg.cols; ws.requestedRows = msg.rows;
        }
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
app.get('/api/config', (req, res) => {
    // Include localHostname so the frontend can show the actual machine
    // name in the prompt prefix when not in SSH ("localhost ❯" by default
    // is more accurate than the generic "termbook ❯").
    res.json({ ...config, localHostname: os.hostname().replace(/\.local$/, '') });
});
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

app.get('/api/complete', async (req, res) => {
    const input = String(req.query.input || '');
    const sessionId = String(req.query.sessionId || '');
    const s = sessions.get(sessionId);
    const cwd = (s && s.pwd) || process.cwd();
    try {
        // When inside an the active SSH integration SSH session, completion MUST hit the
        // REMOTE filesystem (the local /api/complete would otherwise resolve
        // paths against the local fs, which is wrong on real remote hosts).
        // The integration's __tb_complete function does the work over the
        // existing PTY using a salted RPC.
        if (s && s.sshActive && s.sshState === 'active') {
            const remote = await requestRemoteCompletion(s, input);
            // Map remote candidate strings to the {value, isDir, type} shape
            // local completion uses, so frontend doesn't need a special
            // code path. For 'cmd' kind, treat candidates as executables
            // (no trailing slash, never directories).
            const candidates = remote.candidates.map(raw => {
                const isDir = raw.endsWith('/');
                const value = isDir ? raw.slice(0, -1) : raw;
                return { value, isDir, type: remote.kind === 'cmd' ? 'exec' : 'file' };
            });
            return res.json({ input, cwd, currentToken: remote.currentToken, candidates, source: 'remote', kind: remote.kind });
        }
        const result = completion.complete(input, cwd, USER_ALIASES);
        res.json({
            input,
            cwd,
            currentToken: result.currentToken,
            candidates: result.candidates,
            source: 'local',
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

const PORT = process.env.PORT || 4001;
// Bind to loopback by default. Termbook has no authentication; anyone who
// can reach :4001 gets a shell as the server user. Binding to 0.0.0.0
// would expose that shell to every device on the LAN. To intentionally
// expose Termbook beyond loopback (e.g. behind a reverse proxy with
// auth), set TERMBOOK_BIND=0.0.0.0.
// See SECURITY.md for the full threat model.
const HOST = process.env.TERMBOOK_BIND || '127.0.0.1';
if (require.main === module) {
  server.listen(PORT, HOST, () => console.log(`[*] Backend server listening on ${HOST}:${PORT}`));
}
module.exports = { app, server };
