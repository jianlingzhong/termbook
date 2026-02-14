const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const cp = require('child_process');
const os = require('os');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const configPath = path.join(__dirname, '..', 'app_config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

const app = express();
// Lock down CORS to the frontend development server
app.use(cors({ origin: 'http://localhost:5173' }));
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const shell = os.platform() === 'win32' ? 'powershell.exe' : process.env.SHELL || 'bash';

// Map of sessionId -> { ptyProcess, ptyStartQueue, activeCellId, isPtyReady, tailBuf, clients: Set<ws>, pwd: string }
const sessions = new Map();

// Helper to reliably kill PTY children
function killSession(sessionId) {
  const session = sessions.get(sessionId);
  if (session && session.ptyProcess) {
    try {
      session.ptyProcess.kill('SIGKILL');
    } catch (e) {
      console.error(`Failed to kill PTY for session ${sessionId}:`, e);
    }
  }
  sessions.delete(sessionId);
}

// Global cleanup handlers for zombie processes
['exit', 'SIGINT', 'SIGTERM'].forEach((sig) => {
  process.on(sig, () => {
    for (const [sessionId, session] of sessions.entries()) {
      killSession(sessionId);
    }
    if (sig !== 'exit') process.exit(0);
  });
});

function createSession(sessionId) {
  if (sessions.has(sessionId)) return sessions.get(sessionId);

  // The PROMPT_COMMAND now forcefully evaluates the exit code ($?) and PWD as part of the done signal
  const rcPrefix = config.markerPrefix.toLowerCase();
  const rcPath = path.join(__dirname, `${rcPrefix}_bashrc_${sessionId}`);
  fs.writeFileSync(rcPath, `export PS1=''; export PROMPT_COMMAND='echo -ne "\\\\033]1337;${config.markerPrefix}Done;${sessionId};$PWD;$?\\\\007"'; stty -echo;\n`);

  const pythonArgs = [
    path.join(__dirname, 'pty_wrapper.py'),
    '/bin/bash', '--rcfile', rcPath, '-i'
  ];

  const ptyProcess = cp.spawn('python3', pythonArgs, {
    cwd: process.env.HOME,
    env: { ...process.env, TERM: 'xterm-256color' },
    stdio: ['pipe', 'pipe', 'pipe', 'pipe']
  });

  const session = {
    id: sessionId,
    ptyProcess,
    ptyStartQueue: [],
    activeCellId: null,
    isPtyReady: false,
    tailBuf: "",
    clients: new Set(),
    pwd: process.env.HOME,
    rcPath
  };

  sessions.set(sessionId, session);

  // Clear screen to hide initialization commands
  setTimeout(() => ptyProcess.stdin.write("clear\n"), 100);

  // Initialize invisible Prompt completion tracking
  ptyProcess.stdout.on('data', (data) => {
    const str = data.toString();
    session.tailBuf += str;
    if (session.tailBuf.length > 500) session.tailBuf = session.tailBuf.slice(-500);

    const doneRegex = new RegExp(`\\x1b\\]1337;${config.markerPrefix}Done;${sessionId};([^;]*);(\\d+)\\x07`);

    /* Boot sequence check BEFORE activeCellId */
    if (!session.isPtyReady && doneRegex.test(session.tailBuf)) {
      session.isPtyReady = true;
      const match = session.tailBuf.match(doneRegex);
      if (match) {
        session.pwd = match[1];
      }
      session.tailBuf = session.tailBuf.replace(doneRegex, '');

      // Drain the queue
      while (session.ptyStartQueue.length > 0) {
        const msg = session.ptyStartQueue.shift();
        session.activeCellId = msg.cellId;
        if (session.ptyProcess && session.ptyProcess.stdin) {
          session.ptyProcess.stdin.write(msg.data.trim() + '\n');
        }
      }
      return;
    }

    if (session.activeCellId && session.clients.size > 0) {
      // Broadcast to all clients connected to this session
      for (const ws of session.clients) {
        if (ws.readyState === ws.OPEN) {
          if (str.includes('\x1b[?1049l')) {
            ws.send(JSON.stringify({ type: 'output', data: str.replace('\x1b[?1049l', ''), cellId: session.activeCellId }));
            ws.send(JSON.stringify({ type: 'tui_exit', cellId: session.activeCellId }));
          } else {
            ws.send(JSON.stringify({ type: 'output', data: str, cellId: session.activeCellId }));
          }
        }
      }

      const finishMatch = session.tailBuf.match(doneRegex);
      if (finishMatch) {
        session.pwd = finishMatch[1];
        const exitCode = parseInt(finishMatch[2], 10);

        for (const ws of session.clients) {
          if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({ type: 'exit', exitCode, cellId: session.activeCellId, pwd: session.pwd }));
          }
        }
        session.tailBuf = session.tailBuf.replace(doneRegex, '');
        session.activeCellId = null; // Yield the PTY lock
      }
    }
  });

  ptyProcess.stderr.on('data', (data) => {
    if (session.activeCellId) {
      for (const ws of session.clients) {
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ type: 'output', data: data.toString(), cellId: session.activeCellId }));
        }
      }
    }
  });

  ptyProcess.on('exit', (exitCode) => {
    // Clean up rc file
    if (fs.existsSync(session.rcPath)) {
      fs.unlinkSync(session.rcPath);
    }

    if (session.activeCellId) {
      for (const ws of session.clients) {
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ type: 'exit', exitCode, cellId: session.activeCellId, pwd: session.pwd }));
        }
      }
    }
    sessions.delete(sessionId);
  });

  // Hacky flag to prevent multiple listeners
  if (ptyProcess.stdio[3]) {
    ptyProcess.stdio[3].on('error', () => { });
    ptyProcess.stdio[3].readableObjectMode = true;
  }

  return session;
}

wss.on('connection', (ws) => {
  let activeSessionId = null;

  ws.on('message', (message) => {
    try {
      const msg = JSON.parse(message.toString());

      if (msg.type === 'join_session') {
        const sessionId = msg.sessionId || uuidv4();
        activeSessionId = sessionId;

        const session = createSession(sessionId);
        session.clients.add(ws);

        ws.send(JSON.stringify({
          type: 'session_init',
          sessionId: session.id,
          pwd: session.pwd,
          isReady: session.isPtyReady
        }));

      } else if (msg.type === 'start' && activeSessionId) {
        const session = sessions.get(activeSessionId);
        if (!session) return;

        if (!session.isPtyReady) {
          session.ptyStartQueue.push(msg);
          return;
        }

        session.activeCellId = msg.cellId; // Lock the PTY output
        session.tailBuf = ''; // FORCE CLEAR ANY STALE ${config.markerPrefix}Done STARDUST
        if (session.ptyProcess && session.ptyProcess.stdin) {
          session.ptyProcess.stdin.write(msg.data + '\n');
        }

      } else if (msg.type === 'input' && activeSessionId) {
        const session = sessions.get(activeSessionId);
        if (session && session.ptyProcess && session.ptyProcess.stdin) {
          session.ptyProcess.stdin.write(msg.data);
        }

      } else if (msg.type === 'resize' && activeSessionId) {
        const session = sessions.get(activeSessionId);
        if (session && session.ptyProcess && session.ptyProcess.stdio[3]) {
          try {
            session.ptyProcess.stdio[3].write(JSON.stringify({ type: 'resize', cols: msg.cols, rows: msg.rows }) + '\n');
          } catch (err) { }
        }
      }
    } catch (e) {
      console.error('Failed to parse message', e);
    }
  });

  ws.on('close', () => {
    if (activeSessionId) {
      const session = sessions.get(activeSessionId);
      if (session) {
        session.clients.delete(ws);
        // We do *not* kill the process here, leaving it alive for reconnection!
      }
    }
  });
});

// REST ENDPOINTS

// Get global config
app.get('/api/config', (req, res) => {
  res.json(config);
});

// Get active sessions
// Get active sessions
app.get('/api/sessions', (req, res) => {
  const activeSessions = Array.from(sessions.entries()).map(([id, session]) => ({
    id,
    pwd: session.pwd,
    status: session.isPtyReady ? 'ready' : 'initializing'
  }));
  res.json({ sessions: activeSessions });
});

// Delete a session
app.delete('/api/sessions/:id', (req, res) => {
  const { id } = req.params;
  if (sessions.has(id)) {
    killSession(id);
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Session not found' });
  }
});

// History API endpoint
app.get('/api/history', (req, res) => {
  const historyFile = shell.includes('zsh') ? '.zsh_history' : '.bash_history';
  const historyPath = path.join(process.env.HOME, historyFile);

  try {
    if (fs.existsSync(historyPath)) {
      const content = fs.readFileSync(historyPath, 'utf8');
      const lines = content.split('\n')
        .map(line => {
          if (line.startsWith(': ')) {
            const parts = line.split(';');
            return parts.length > 1 ? parts.slice(1).join(';').trim() : line.trim();
          }
          return line.trim();
        })
        .filter(line => line.length > 0);

      const uniqueLines = [...new Set(lines)].reverse().slice(0, 1000);
      res.json({ history: uniqueLines });
    } else {
      res.json({ history: [] });
    }
  } catch (error) {
    console.error('Error reading history:', error);
    res.status(500).json({ error: 'Failed to read history' });
  }
});

const PORT = 3001;
server.listen(PORT, () => {
  console.log(`${config.appName} Backend (Session-Aware) listening on http://localhost:${PORT}`);
});
