import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Folder } from 'lucide-react';

export default function NotebookCell({ id, snapshot, activeTerminal, initialCommand, executablePwd, isRunning, isTuiActive }) {
  const terminalRef = useRef(null);
  const containerRef = useRef(null);
  const [isTerminalAttached, setIsTerminalAttached] = useState(false);

  const terminalRefCallback = useCallback(node => {
    if (node !== null) {
      terminalRef.current = node;
      setIsTerminalAttached(true);
    }
  }, []);

  useEffect(() => {
    const isLive = !snapshot && !isTuiActive;
    if (isLive && activeTerminal && isTerminalAttached && terminalRef.current) {
        const { terminal, fitAddon } = activeTerminal;
        
        if (!terminal.element) {
            terminal.open(terminalRef.current);
            terminal.focus();
        } else if (terminal.element.parentElement !== terminalRef.current) {
            terminalRef.current.innerHTML = '';
            terminalRef.current.appendChild(terminal.element);
            terminal.focus();
        }

        const handleResize = () => {
            if (!terminal.element || !containerRef.current) return;
            try {
                fitAddon.fit();
                const buffer = terminal.buffer.active;
                // Use total rows that have content or cursor position to determine height
                const contentRows = buffer.baseY + buffer.cursorY + 1;
                // During TUI transitions, ensure we don't clip the 24-row standard if it's active
                const targetRows = Math.max(1, Math.min(100, contentRows));
                if (terminal.rows !== targetRows) {
                    terminal.resize(terminal.cols, targetRows);
                }
            } catch(e){}
        };

        const ro = new ResizeObserver(handleResize);
        ro.observe(terminalRef.current);
        const resizeDisposable = terminal.onResize(handleResize);
        const dataDisposable = terminal.onData(() => setTimeout(handleResize, 10));
        
        setTimeout(handleResize, 50);
        const poll = setInterval(handleResize, 1000);

        return () => {
            ro.disconnect();
            resizeDisposable.dispose();
            dataDisposable.dispose();
            clearInterval(poll);
        };
    }
  }, [id, snapshot, activeTerminal, isTerminalAttached, isRunning, isTuiActive]);

  const showSnapshot = !!snapshot;
  const snapshotRef = useRef(null);

  useEffect(() => {
    if (showSnapshot && snapshotRef.current) {
        const el = snapshotRef.current.parentElement;
        if (el) {
            el.scrollTop = el.scrollHeight;
            el.style.height = 'auto';
        }
    }
  }, [showSnapshot, snapshot]);

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
      <div className="cell-output" ref={containerRef}>
        {showSnapshot && (
          <div ref={snapshotRef} className="snapshot-output" dangerouslySetInnerHTML={{ __html: snapshot }} style={{ width: '100%' }} />
        )}
        {!showSnapshot && isTuiActive && (
          <div className="tui-placeholder">Interactive TUI session active in modal...</div>
        )}
        {!showSnapshot && !isTuiActive && (
          <div className="live-terminal" ref={terminalRefCallback} style={{ width: '100%', minHeight: '24px' }} />
        )}
      </div>
    </div>
  );
}
