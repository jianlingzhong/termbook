const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const cp = require('child_process');
const os = require('os');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { parseOutput } = require('./parser');

const configPath = path.join(__dirname, '..', 'app_config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const sessions = new Map();

function createSession(sessionId) {
  if (sessions.has(sessionId)) return sessions.get(sessionId);
  const projectRoot = path.join(__dirname, '..');
  const rcPath = path.join(__dirname, `${config.markerPrefix.toLowerCase()}_bashrc_${sessionId}`);
  fs.writeFileSync(rcPath, `cd ${projectRoot}; export PS1=''; export PROMPT_COMMAND='echo -ne "\\033]133;D;$?\\007\\033]7;file://localhost$PWD\\007"'; stty -echo;\n`);
  const pythonArgs = [path.join(__dirname, 'pty_wrapper.py'), '/bin/bash', '--rcfile', rcPath, '-i'];
  
  console.log(`[*] Starting PTY wrapper for session ${sessionId}...`);
  const ptyProcess = cp.spawn('python3', pythonArgs, { cwd: projectRoot, env: { ...process.env, TERM: 'xterm-256color' }, stdio: ['pipe', 'pipe', 'pipe', 'pipe'] });
  
  ptyProcess.on('error', (err) => console.error(`[PTY ERROR] ${err}`));
  ptyProcess.on('exit', (code) => console.log(`[PTY EXIT] session ${sessionId} code ${code}`));

  const resizePipe = ptyProcess.stdio[3];
  const session = { id: sessionId, ptyProcess, resizePipe, activeCellId: null, isPtyReady: false, tailBuf: "", clients: new Set(), cells: [], pwd: projectRoot, rcPath, isTuiActive: false };
  sessions.set(sessionId, session);

  ptyProcess.stderr.on('data', (data) => console.error(`[PTY STDERR] ${data.toString()}`));

    ptyProcess.stdout.on('data', (data) => {
      session.tailBuf += data.toString();

      // TUI Detection (check from sentPos)
      const tuiEnterIdx = session.tailBuf.indexOf('\x1b[?1049h', session.sentPos);
      if (tuiEnterIdx !== -1 && !session.isTuiActive) {
          session.isTuiActive = true;
          for (const ws of session.clients) ws.send(JSON.stringify({ type: 'tui_enter', cellId: session.activeCellId }));
      }
      const tuiExitIdx = session.tailBuf.indexOf('\x1b[?1049l', session.sentPos);
      if (tuiExitIdx !== -1 && session.isTuiActive) {
          session.isTuiActive = false;
          for (const ws of session.clients) ws.send(JSON.stringify({ type: 'tui_exit', cellId: session.activeCellId }));
      }

      const finishMatch = parseOutput(session.tailBuf);
      
      if (session.activeCellId) {
        const cell = session.cells.find(c => c.id === session.activeCellId);
        
        if (finishMatch && !session.isTuiActive) {
            // Send only up to the prompt
            const toSend = session.tailBuf.substring(session.sentPos, finishMatch.firstIndex);
            if (toSend.length > 0) {
                if (cell) cell.output = (cell.output || "") + toSend;
                for (const ws of session.clients) ws.send(JSON.stringify({ type: 'output', data: toSend, cellId: session.activeCellId }));
            }
            // Command finished
            if (cell) cell.isRunning = false;
            for (const ws of session.clients) ws.send(JSON.stringify({ type: 'exit', exitCode: finishMatch.exitCode, cellId: session.activeCellId, pwd: finishMatch.pwd }));
            session.activeCellId = null;
            session.tailBuf = session.tailBuf.substring(finishMatch.matchEnd);
            session.sentPos = 0;
        } else {
            // No prompt yet, stream all unsent data
            const toSend = session.tailBuf.substring(session.sentPos);
            if (toSend.length > 0) {
                if (cell) cell.output = (cell.output || "") + toSend;
                for (const ws of session.clients) ws.send(JSON.stringify({ type: 'output', data: toSend, cellId: session.activeCellId }));
                session.sentPos = session.tailBuf.length;
            }
        }
      } else if (finishMatch && !session.isPtyReady) {
          session.isPtyReady = true;
          session.pwd = finishMatch.pwd;
          session.tailBuf = session.tailBuf.substring(finishMatch.matchEnd);
          session.sentPos = 0;
      }

      // Memory protection
      if (session.tailBuf.length > 10000 && session.sentPos > 5000) {
          const toRemove = session.sentPos - 1000;
          session.tailBuf = session.tailBuf.substring(toRemove);
          session.sentPos -= toRemove;
      }
    });

  return session;
}

wss.on('connection', (ws, req) => {
  console.log(`[WS CONNECT] ${req.socket.remoteAddress}`);
  let activeId = null;
  ws.on('message', (m) => {
    try {
      const msg = JSON.parse(m.toString());
      if (msg.type === 'join_session') {
        activeId = msg.sessionId || uuidv4();
        const s = createSession(activeId);
        s.clients.add(ws);
        ws.send(JSON.stringify({ type: 'session_init', sessionId: s.id, pwd: s.pwd, cells: s.cells, isTuiActive: s.isTuiActive, activeCellId: s.activeCellId }));
      } else if (msg.type === 'start') {
        const s = sessions.get(activeId);
        if (s) { 
          s.activeCellId = msg.cellId; 
          s.tailBuf = "";
          s.isTuiActive = false;
          s.cells.push({ id: msg.cellId, command: msg.data, output: "", isRunning: true, executablePwd: s.pwd });
          s.ptyProcess.stdin.write(msg.data + '\n'); 
        }
      } else if (msg.type === 'input') {
        const s = sessions.get(activeId);
        if (s) s.ptyProcess.stdin.write(msg.data);
      } else if (msg.type === 'resize') {
        const s = sessions.get(activeId);
        if (s && s.resizePipe) s.resizePipe.write(JSON.stringify({ type: 'resize', rows: msg.rows, cols: msg.cols }) + '\n');
      }
    } catch (e) { console.error("WS Message error:", e); }
  });

  ws.on('close', () => {
    if (activeId) {
      const s = sessions.get(activeId);
      if (s) {
        s.clients.delete(ws);
        if (s.clients.size === 0) {
          try { s.ptyProcess.kill('SIGKILL'); } catch(e) {}
          if (fs.existsSync(s.rcPath)) fs.unlinkSync(s.rcPath);
          sessions.delete(activeId);
        }
      }
    }
  });
});

app.get('/api/config', (req, res) => res.json(config));
app.get('/api/sessions', (req, res) => res.json({ sessions: Array.from(sessions.values()).map(s => ({ id: s.id, pwd: s.pwd, cells: s.cells })) }));
app.get('/api/sessions/:id', (req, res) => {
  const s = sessions.get(req.params.id);
  if (s) res.json({ id: s.id, pwd: s.pwd, cells: s.cells });
  else res.status(404).json({ error: 'Not found' });
});

const PORT = process.env.PORT || 4001;
server.listen(PORT, () => console.log(`[*] Backend server listening on port ${PORT}`));

module.exports = { app, server };
