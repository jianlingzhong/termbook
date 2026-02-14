import React, { useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SerializeAddon } from '@xterm/addon-serialize';
import 'xterm/css/xterm.css';

export default function TuiModal({ activeWebSocket, onClose, cellId }) {
  const terminalRef = useRef(null);
  const xtermRef = useRef(null);

  useEffect(() => {
    if (!activeWebSocket) return;

    const term = new Terminal({
      theme: {
        background: '#131520',
        foreground: '#e0e5ff',
        cursor: '#00ecec',
      },
      convertEol: true,
      cursorBlink: true
    });

    const fitAddon = new FitAddon();
    const serializeAddon = new SerializeAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(serializeAddon);

    term.onResize(({ cols, rows }) => {
      activeWebSocket.send(JSON.stringify({ type: 'resize', cols, rows }));
    });

    if (terminalRef.current) {
      try {
        term.open(terminalRef.current);
        fitAddon.fit();
      } catch (err) {
        console.error("XTERM FIT CRASH:", err);
      }
    }

    xtermRef.current = term;

    const handleMessage = (event) => {
      const msg = JSON.parse(event.data);
      if (cellId && msg.cellId !== cellId) return;
      if (msg.type === 'output') {
        term.write(msg.data);
        if (msg.data.match(/\x1b\[\?1049l/)) {
          setTimeout(() => {
            const rawHtml = serializeAddon.serializeAsHTML();
            const snapshotHtml = rawHtml.replace(/color:\s*#000000;\s*background-color:\s*#ffffff;/i, 'color: #c0caf5; background-color: transparent;');
            onClose(snapshotHtml);
          }, 150);
        }
      } else if (msg.type === 'tui_exit') {
        setTimeout(() => {
          const rawHtml = serializeAddon.serializeAsHTML();
          const snapshotHtml = rawHtml.replace(/color:\s*#000000;\s*background-color:\s*#ffffff;/i, 'color: #c0caf5; background-color: transparent;');
          onClose(snapshotHtml);
        }, 150);
      }
    };

    activeWebSocket.addEventListener('message', handleMessage);

    term.onData((data) => {
      activeWebSocket.send(JSON.stringify({ type: 'input', data }));
    });

    const handleResize = () => fitAddon.fit();
    window.addEventListener('resize', handleResize);

    return () => {
      activeWebSocket.removeEventListener('message', handleMessage);
      window.removeEventListener('resize', handleResize);
      term.dispose();
    };
  }, [activeWebSocket, cellId]);

  if (!activeWebSocket) return null;

  return (
    <div className="tui-modal-overlay">
      <div className="tui-terminal-container" ref={terminalRef} />
    </div>
  );
}
