import React, { useState, useEffect, useRef } from 'react';
import '@xterm/xterm/css/xterm.css';

export default function TuiModal({ activeTerminal, requestResize }) {
  const terminalRef = useRef(null);
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    if (!activeTerminal || !terminalRef.current) return;
    const { terminal, fitAddon } = activeTerminal;

    terminal.options.theme = { ...terminal.options.theme, background: '#000000' };
    window.__ACTIVE_TERM = terminal;

    let lastCols = -1, lastRows = -1;
    const performFit = () => {
        const el = terminalRef.current;
        if (!el || !terminal.element) return;
        try {
            fitAddon.fit();
            const cols = terminal.cols;
            const rows = terminal.rows;
            if (cols > 0 && rows > 0 && (cols !== lastCols || rows !== lastRows)) {
                lastCols = cols;
                lastRows = rows;
                if (requestResize) requestResize(cols, rows);
                window.dispatchEvent(new CustomEvent('tui-resize-request', { detail: { cols, rows }}));
            }
            // Multiple refresh kicks: terminal.refresh(0, rows-1) tells
            // the renderer to repaint all visible rows. With WebGL the
            // canvas needs to be invalidated; doing it after a frame
            // ensures the new dimensions are observed.
            requestAnimationFrame(() => {
                terminal.focus();
                terminal.refresh(0, terminal.rows - 1);
            });
            // A second refresh after a longer delay — covers the case
            // where the TUI app (nvim) sent its initial draw at the
            // pre-resize size and needs a nudge to repaint at the
            // current size.
            setTimeout(() => {
                try { terminal.refresh(0, terminal.rows - 1); } catch {}
            }, 400);
        } catch (e) {
            console.error("TUI Fit error:", e);
        }
    };

    const forceRedraw = () => {
        if (!terminal.element) return;
        try { terminal.refresh(0, terminal.rows - 1); } catch (e) {}
    };

    const ro = new ResizeObserver(() => performFit());
    ro.observe(terminalRef.current);

    performFit();
    const t1 = setTimeout(performFit, 50);
    const t2 = setTimeout(() => { performFit(); forceRedraw(); }, 200);
    const t3 = setTimeout(forceRedraw, 500);
    const t4 = setTimeout(forceRedraw, 1000);

    let debounceTimer;
    const resizeHandler = () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(performFit, 200);
    };
    window.addEventListener('resize', resizeHandler);

    return () => {
        ro.disconnect();
        clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); clearTimeout(t4);
        window.removeEventListener('resize', resizeHandler);
        clearTimeout(debounceTimer);
    };
  }, [activeTerminal, isMaximized]);

  return (
    <div className="tui-modal-overlay">
      <div className={`tui-window ${isMaximized ? 'maximized' : ''}`}>
        <div className="tui-window-header">
          <div className="tui-traffic-lights">
            <div className="tui-traffic-light red"></div>
            <div className="tui-traffic-light yellow"></div>
            <div className="tui-traffic-light green" onClick={() => setIsMaximized(!isMaximized)}></div>
          </div>
        </div>
        <div className="tui-terminal-container" ref={el => {
            if (el && activeTerminal?.terminal) {
                const term = activeTerminal.terminal;
                // attach() (provided by App.jsx getOrCreateTerminal)
                // handles open/move + WebGL load in one place. Same
                // code path as the live cell.
                if (activeTerminal.attach) {
                    activeTerminal.attach(el);
                } else if (!term.element) {
                    term.open(el);
                } else if (term.element.parentElement !== el) {
                    el.innerHTML = '';
                    el.appendChild(term.element);
                }
                term.focus();
                terminalRef.current = el;
            }
        }} />
      </div>
    </div>
  );
}
