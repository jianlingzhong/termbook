import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Folder } from 'lucide-react';
import { Terminal } from 'xterm';
import { SerializeAddon } from '@xterm/addon-serialize';

export default function NotebookCell({ id, snapshotAnsi, activeTerminal, initialCommand, executablePwd, isRunning, isTuiActive, requestResize }) {
  const terminalRef = useRef(null);
  const [isTerminalAttached, setIsTerminalAttached] = useState(false);
  const [renderedSnapshot, setRenderedSnapshot] = useState(null);

  const terminalRefCallback = useCallback(node => {
    if (node !== null) {
      terminalRef.current = node;
      setIsTerminalAttached(true);
    }
  }, []);

  useEffect(() => {
    if (snapshotAnsi && !renderedSnapshot) {
        const tempTerm = new Terminal({
            theme: { background: '#000000', foreground: '#e0e5ff' },
            rows: 24, cols: 120, allowProposedApi: true
        });
        const tempSerialize = new SerializeAddon();
        tempTerm.loadAddon(tempSerialize);
        tempTerm.write(snapshotAnsi, () => {
            const html = tempSerialize.serializeAsHTML();
            let cleaned = html;
            const bodyMatch = cleaned.match(/<body[^>]*>([\s\S]*)<\/body>/i);
            if (bodyMatch && bodyMatch[1]) cleaned = bodyMatch[1];
            cleaned = cleaned.replace(/color:\s*#000000/g, 'color: #e0e5ff')
                       .replace(/background-color:\s*#ffffff/g, 'background-color: transparent')
                       .replace(/background-color:\s*#ffff00/g, 'background-color: transparent');
            setRenderedSnapshot(cleaned);
            tempTerm.dispose();
        });
    }
  }, [id, snapshotAnsi, renderedSnapshot]);

  useEffect(() => {
    const isLive = !renderedSnapshot && !isTuiActive;
    if (isLive && activeTerminal && isTerminalAttached && terminalRef.current) {
        const { terminal, fitAddon } = activeTerminal;
        if (!terminal.element) {
            terminal.open(terminalRef.current);
            // Do not focus terminal in normal mode (keeps focus on input)
        } else if (terminal.element.parentElement !== terminalRef.current) {
            terminalRef.current.innerHTML = '';
            terminalRef.current.appendChild(terminal.element);
        }

        const handleResize = () => {
            try {
                fitAddon.fit();
                const dims = fitAddon.proposeDimensions();
                if (dims && requestResize) {
                    // Larger safety buffer to prevent edge clipping (scrollbar etc)
                    const safeCols = Math.max(10, dims.cols - 4); 
                    requestResize(safeCols, dims.rows);
                }
            } catch (e) {}
        };
        setTimeout(handleResize, 100);
        const ro = new ResizeObserver(() => setTimeout(handleResize, 50));
        ro.observe(terminalRef.current);
        return () => ro.disconnect();
    }
  }, [id, renderedSnapshot, activeTerminal, isTerminalAttached, isTuiActive, requestResize]);

  return (
    <div className={`notebook-cell ${isRunning ? 'active-cell' : ''}`}>
      <div className="cell-header">
        <div className="cell-header-left">
            <span className="prompt-arrow">❯</span>
            <span className="read-only-command">{initialCommand}</span>
        </div>
        {executablePwd && (
            <div className="cell-header-breadcrumb" title={executablePwd}>
                <Folder size={12} color="var(--accent-cyan)" />
                <span>{executablePwd.split('/').slice(-3).join('/')}</span>
            </div>
        )}
      </div>
      <div className="cell-output" style={{ height: '480px', minHeight: '480px', background: '#000' }}>
        {renderedSnapshot && (
          <div className="snapshot-output" dangerouslySetInnerHTML={{ __html: renderedSnapshot }} style={{ width: '100%', height: '100%', overflowY: 'auto' }} />
        )}
        {!renderedSnapshot && isTuiActive && (
          <div className="tui-placeholder">Interactive TUI session active in modal...</div>
        )}
        {!renderedSnapshot && !isTuiActive && (
          <div className="live-terminal" ref={terminalRefCallback} style={{ width: '100%', height: '100%' }} />
        )}
      </div>
    </div>
  );
}
