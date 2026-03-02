import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Folder } from 'lucide-react';

export default function NotebookCell({ id, snapshot, activeTerminal, initialCommand, executablePwd, isRunning, isTuiActive }) {
  const terminalRef = useRef(null);
  const containerRef = useRef(null);
  const [isTerminalAttached, setIsTerminalAttached] = useState(false);
  const maxReachedRowsRef = useRef(1);
  const lastCursorYRef = useRef(0);
  const lastBaseYRef = useRef(0);
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

        const cursorMoveDisposable = terminal.onCursorMove(() => {
            const buffer = terminal.buffer.active;
            if (buffer.cursorY < lastCursorYRef.current && buffer.baseY === lastBaseYRef.current) {
                if (!activeTerminal.isInteractive) {
                    activeTerminal.isInteractive = true;
                    // Trigger an immediate resize to snap to full size
                    setTimeout(handleResize, 10);
                }
            }
            lastCursorYRef.current = buffer.cursorY;
            lastBaseYRef.current = buffer.baseY;
        });

        const handleResize = () => {
            if (!terminal.element || !containerRef.current) return;
            try {
                const dims = fitAddon.proposeDimensions();
                if (!dims) return;

                const buffer = terminal.buffer.active;
                // Use total rows that have content or cursor position to determine height
                const contentRows = buffer.baseY + buffer.cursorY + 1;
                
                // Prevent shrinking (High-Water Mark)
                if (!activeTerminal.isInteractive && contentRows > maxReachedRowsRef.current) {
                    maxReachedRowsRef.current = contentRows;
                }
                const highWaterRows = maxReachedRowsRef.current;

                // Viewport-aware max rows (approx 20px per row, leaving some buffer for header/input)
                const maxRows = Math.floor((window.innerHeight - 200) / 20);
                const safeMaxRows = Math.max(10, maxRows);
                
                let targetRows;
                if (activeTerminal.isInteractive) {
                    targetRows = safeMaxRows;
                } else {
                    targetRows = Math.max(1, Math.min(safeMaxRows, highWaterRows));
                }
                
                if (terminal.rows !== targetRows || terminal.cols !== dims.cols) {
                    terminal.resize(dims.cols, targetRows);
                }

                // Smart Auto-Scroll the Container
                const scrollContainer = terminalRef.current.closest('.notebook-content');
                if (scrollContainer) {
                    const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
                    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
                    if (isAtBottom) {
                        scrollContainer.scrollTop = scrollContainer.scrollHeight;
                    }
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
            cursorMoveDisposable.dispose();
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
