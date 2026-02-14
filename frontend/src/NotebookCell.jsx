import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SerializeAddon } from '@xterm/addon-serialize';
import 'xterm/css/xterm.css';
import { Play } from 'lucide-react';

export default function NotebookCell({ commandHistory, onTuiDetect, onTuiExit, onCommandFinish, id, snapshot, globalWs, initialCommand }) {
  const [input, setInput] = useState(initialCommand || '');
  const [isRunning, setIsRunning] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const [localSnapshot, setLocalSnapshot] = useState(null);

  const terminalRef = useRef(null);
  const xtermRef = useRef(null);
  const serializeRef = useRef(null);
  const wsRef = useRef(null);

  useEffect(() => {
    // Cleanup unmounted or deleted cells to prevent zombie listenrs
    return () => {
      if (wsRef.current) {
        // Do NOT close the global WebSocket, just nullify our internal reference
        wsRef.current = null;
      }
    };
  }, []);

  // Auto-execute upon mount
  useEffect(() => {
    if (initialCommand && !snapshot && !isRunning && !isDone && !xtermRef.current) {
      executeCommand();
    }
  }, [initialCommand, snapshot, isRunning, isDone]);

  // Removed interactive input handling

  const executeCommand = () => {
    if (!input.trim() || isRunning) return;
    setIsRunning(true);
    setLocalSnapshot(null);

    if (!xtermRef.current) {
      const term = new Terminal({
        rows: 20,
        theme: {
          background: '#1a1b26',
          foreground: '#c0caf5',
        },
        convertEol: true,
      });
      const fitAddon = new FitAddon();
      const serializeAddon = new SerializeAddon();
      term.loadAddon(fitAddon);
      term.loadAddon(serializeAddon);
      term.open(terminalRef.current);
      fitAddon.fit();
      xtermRef.current = term;
      serializeRef.current = serializeAddon;

      term.onData(data => {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'input', data }));
        }
      });

      // RELIABLE TUI DETECTION: Watch the buffer type directly instead of scraping chunks
      let wasAlternate = false;
      term.onRender(() => {
        if (!xtermRef.current) return;
        const isAlternate = xtermRef.current.buffer.active.type === 'alternate';

        if (isAlternate && !wasAlternate) {
          console.log("XTERM BUFFER SWITCHED TO ALTERNATE");
          onTuiDetect(globalWs);
          wasAlternate = true;
        } else if (!isAlternate && wasAlternate) {
          console.log("XTERM BUFFER SWITCHED TO NORMAL");
          if (xtermRef.current && serializeRef.current) {
            const rawHtml = serializeRef.current.serializeAsHTML();
            const snapshotHtml = rawHtml.replace(/color:\s*#000000;\s*background-color:\s*#ffffff;/i, 'color: #c0caf5; background-color: transparent;');
            setLocalSnapshot(snapshotHtml);
            onTuiExit(snapshotHtml);
          }
          wasAlternate = false;
        }
      });
    } else {
      xtermRef.current.clear();
    }

    wsRef.current = globalWs;

    const handleMessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.cellId !== id) return;
      if (msg.type === 'output') {
        // PLAYWRIGHT DEBUG ONLY
        console.log("NOTEBOOK RECEIVES CHUNK:", JSON.stringify(msg.data));
        if (msg.data.includes('\x1b[?1049h')) console.log("NOTEBOOK RECEIVES 1049h!", JSON.stringify(msg.data));
        if (msg.data.includes('\x1b[?1049l')) console.log("NOTEBOOK RECEIVES 1049l!", JSON.stringify(msg.data));
        // We rely on term.onRender below for TUI detection instead of chunk regexing.
        const data = msg.data;

        // We always write the full data to the active notebook cell's mirror terminal.
        // TuiModal will take care of slicing the snapshot properly on its own end.
        xtermRef.current.write(data, () => {
          if (xtermRef.current && terminalRef.current) {
            const activeBuffer = xtermRef.current.buffer.active;
            let lastViewportRow = 0;
            for (let i = 0; i < xtermRef.current.rows; i++) {
              const line = activeBuffer.getLine(activeBuffer.baseY + i);
              if (line && line.translateToString(true).trim().length > 0) {
                lastViewportRow = i;
              }
            }
            const viewportUsed = Math.max(1, lastViewportRow + 1, activeBuffer.cursorY + 1);
            let targetRows = xtermRef.current.rows;

            if (activeBuffer.baseY > 0 && activeBuffer.cursorY === xtermRef.current.rows - 1) {
              // If it pushes cleanly, expand aggressively (e.g. ls output)
              targetRows = Math.min(20, xtermRef.current.rows + activeBuffer.baseY);
            } else {
              // TUI clear-screen bounding box shrinkage without CSS decapitation (e.g. gemini)
              targetRows = Math.min(20, Math.max(2, viewportUsed));
            }

            if (targetRows !== xtermRef.current.rows) {
              xtermRef.current.resize(xtermRef.current.cols, targetRows);
              if (globalWs && globalWs.readyState === WebSocket.OPEN) {
                globalWs.send(JSON.stringify({ type: 'resize', cols: xtermRef.current.cols, rows: targetRows }));
              }
            }
          }
        });
      } else if (msg.type === 'exit') {
        setIsRunning(false);
        setIsDone(true);
        // The backend server.js natively extracts the PWD via regex and sends it here
        if (onCommandFinish) onCommandFinish(input, msg.pwd);

        // ADD DELAY TO WAIT FOR XTERM ASYNC WRITE QUEUE TO FLUSH BEFORE SNAPSHOTTING
        setTimeout(() => {
          if (xtermRef.current && serializeRef.current) {
            // Shrink the terminal to fit exact content before snapshotting to remove massive bottom padding
            const activeBuffer = xtermRef.current.buffer.active;
            let lastContentRow = 0;
            for (let i = 0; i < activeBuffer.length; i++) {
              const line = activeBuffer.getLine(i);
              if (line && line.translateToString(true).trim().length > 0) {
                lastContentRow = i;
              }
            }
            const contentHeight = Math.max(1, lastContentRow + 1);
            // Don't shrink to more than the original viewport rows just in case
            xtermRef.current.resize(xtermRef.current.cols, Math.min(xtermRef.current.rows, contentHeight));

            const rawHtml = serializeRef.current.serializeAsHTML();
            const snapshotHtml = rawHtml.replace(/color:\s*#000000;\s*background-color:\s*#ffffff;/i, 'color: #c0caf5; background-color: transparent;');
            setLocalSnapshot(snapshotHtml);
            // We don't need the active WebGL context anymore for this completed cell
            xtermRef.current.dispose();
            xtermRef.current = null;
            serializeRef.current = null;
          }
        }, 250);

        // We are using a shared session WS! Do not close it!
        globalWs.removeEventListener('message', handleMessage);
        wsRef.current = null;
      }
    };

    globalWs.addEventListener('message', handleMessage);

    const startPayload = JSON.stringify({ type: 'start', data: input, cellId: id });
    const resizePayload = xtermRef.current ? JSON.stringify({ type: 'resize', cols: xtermRef.current.cols, rows: xtermRef.current.rows }) : null;

    if (globalWs.readyState === WebSocket.OPEN) {
      globalWs.send(startPayload);
      if (resizePayload) globalWs.send(resizePayload);
    } else {
      globalWs.addEventListener('open', () => {
        globalWs.send(startPayload);
        if (resizePayload) globalWs.send(resizePayload);
      });
    }
  };

  useEffect(() => {
    return () => {
      // Unmount listener safely if cell is deleted
    };
  }, []);

  const finalSnapshot = snapshot !== undefined && snapshot !== null ? snapshot : localSnapshot;

  return (
    <div className="notebook-cell">
      <div className="cell-header">
        <span className="prompt-arrow">❯</span>
        <div className="input-container">
          <div className="read-only-command" style={{ fontFamily: 'var(--font-mono)', fontSize: '14px', color: 'var(--text-primary)' }}>
            {input}
          </div>
        </div>
      </div>

      {finalSnapshot ? (
        <div
          className="cell-output snapshot-output"
          dangerouslySetInnerHTML={{ __html: finalSnapshot || '' }}
        />
      ) : (
        <div
          ref={terminalRef}
          className="cell-output"
        />
      )}
    </div>
  );
}
