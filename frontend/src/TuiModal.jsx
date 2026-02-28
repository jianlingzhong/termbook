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
            // Let container size determine terminal size
            el.style.display = 'block';

            try {
                fitAddon.fit();
            } catch (fitErr) {
                console.warn("FitAddon.fit() failed, using default fallback:", fitErr);
                terminal.resize(80, 24);
            }
            
            // Ensure we have at least reasonable dimensions
            if (terminal.rows < 5 || terminal.cols < 5) {
                terminal.resize(80, 24);
            }
            
            terminal.scrollToBottom();
            terminal.refresh(0, terminal.rows - 1);
            terminal.focus();
        } catch (e) { 
            console.error("Critical TUI Fit error:", e); 
            // Absolute fallback
            try { terminal.resize(80, 24); } catch(inner) {}
        }
    };
    
    // Multiple delayed fits for rendering lifecycle
    setTimeout(performFit, 50);
    setTimeout(performFit, 250);
    setTimeout(performFit, 1000);
    setTimeout(performFit, 3000);
    const interval = setInterval(performFit, 5000);

    return () => {
        clearInterval(interval);
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
