import React, { useRef, useEffect } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from '@xterm/addon-fit';
import 'xterm/css/xterm.css';

export default function Test() {
  const terminalRef = useRef(null);
  
  useEffect(() => {
    const term = new Terminal({ rows: 20 });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalRef.current);
    fitAddon.fit();
    
    // Simulate resizing without xterm resize
    const usedRows = 5;
    const rowHeight = term.element.clientHeight / term.rows || 18;
    terminalRef.current.style.height = `${usedRows * rowHeight}px`;
    terminalRef.current.style.overflow = 'hidden';
    
    term.write('Test text line 1\nLine 2\nLine 3\nLine 4\nLine 5');
  }, []);
  
  return <div ref={terminalRef} />;
}
