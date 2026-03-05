import React, { useState, useEffect, useRef } from 'react';
import 'xterm/css/xterm.css';

export default function TuiModal({ activeTerminal }) {
  const terminalRef = useRef(null);
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    if (!activeTerminal || !terminalRef.current) return;
    const { terminal, fitAddon } = activeTerminal;

    // Ensure correct theme
    terminal.options.theme = { ...terminal.options.theme, background: '#000000' };
    window.__ACTIVE_TERM = terminal;

    const performFit = () => {
        const el = terminalRef.current;
        if (!el || !terminal.element) return;
        try {
            // Ask fitAddon for physical dims but do not apply them.
            // We must send them to the backend to get confirmed.
            const dims = fitAddon.proposeDimensions();
            if (dims && dims.cols > 0 && dims.rows > 0) {
                window.dispatchEvent(new CustomEvent('tui-resize-request', { detail: { cols: dims.cols, rows: dims.rows }}));
            }

            requestAnimationFrame(() => {
                terminal.focus();
                terminal.refresh(0, terminal.rows - 1);
            });
        } catch (e) { 
            console.error("Critical TUI Fit error:", e); 
        }
    };
    
    // Use ResizeObserver on the container to detect when the modal actually has size
    const ro = new ResizeObserver(() => {
        performFit();
    });
    
    if (terminalRef.current) {
        ro.observe(terminalRef.current);
    }
    
    // Initial fits
    performFit();
    setTimeout(performFit, 100);
    setTimeout(performFit, 500);

    const intervalId = setInterval(performFit, 5000);

    let debounceTimer;
    const resizeHandler = () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(performFit, 200);
    };
    window.addEventListener('resize', resizeHandler);

    return () => {
        ro.disconnect();
        clearInterval(intervalId);
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
                if (term.element && term.element.parentElement !== el) {
                    el.innerHTML = '';
                    el.appendChild(term.element);
                    term.focus();
                    terminalRef.current = el;
                } else if (!term.element) {
                    term.open(el);
                    term.focus();
                    terminalRef.current = el;
                } else {
                    terminalRef.current = el;
                }
            } 
        }} />
      </div>
    </div>
  );
}
