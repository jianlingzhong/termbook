import React, { useEffect, useRef } from 'react';
import 'xterm/css/xterm.css';

export default function TuiModal({ activeTerminal, onClose }) {
  const terminalRef = useRef(null);

  useEffect(() => {
    if (!activeTerminal) return;

    const { terminal, fitAddon } = activeTerminal;

    if (terminalRef.current) {
      if (terminal.element?.parentElement !== terminalRef.current) {
        terminalRef.current.innerHTML = '';
        terminal.open(terminalRef.current);
      }
      
      const performFit = () => {
        if (terminalRef.current) {
          fitAddon.fit();
          terminal.refresh(0, terminal.rows - 1);
        }
      };

      document.fonts.ready.then(performFit);
      setTimeout(performFit, 100); // Increased delay for webkit

      const resizeObserver = new ResizeObserver(() => {
        performFit();
        terminal.focus();
      });
      resizeObserver.observe(terminalRef.current);
      terminal._modalResizeObserver = resizeObserver;

      const focusTerm = () => {
        if (terminal && terminal.textarea) {
          terminal.focus();
        }
      };
      
      setTimeout(focusTerm, 50);
      terminalRef.current.addEventListener('mousedown', focusTerm);
      terminalRef.current.addEventListener('click', focusTerm);

      const focusInterval = setInterval(focusTerm, 500);
      terminal._modalFocusInterval = focusInterval;
    }

    return () => {
      if (terminal._modalResizeObserver) {
        terminal._modalResizeObserver.disconnect();
      }
      if (terminal._modalFocusInterval) {
        clearInterval(terminal._modalFocusInterval);
      }
    };
  }, [activeTerminal]);

  if (!activeTerminal) return null;

  return (
    <div className="tui-modal-overlay">
      <div className="tui-terminal-container" ref={terminalRef} />
    </div>
  );
}
