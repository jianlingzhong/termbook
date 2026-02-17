import React, { useEffect, useRef, useState } from 'react';
import 'xterm/css/xterm.css';
import { Folder } from 'lucide-react';

export default function NotebookCell({
  id,
  snapshot,
  activeTerminal,
  initialCommand,
  executablePwd,
  isTuiActive
}) {
  const terminalRef = useRef(null);
  const [isAttached, setIsAttached] = useState(false);

  useEffect(() => {
    // Only attach if snapshot is null
    if (snapshot === null && activeTerminal && terminalRef.current && !isTuiActive) {
      const { terminal, fitAddon } = activeTerminal;

      if (terminal.element?.parentElement !== terminalRef.current) {
        terminalRef.current.innerHTML = '';
        if (terminal.element) {
          // Reparent safely without wiping buffer
          terminalRef.current.appendChild(terminal.element);
        } else {
          terminal.open(terminalRef.current);
        }
        fitAddon.fit();
        setIsAttached(true);
      }

      return () => {
        setIsAttached(false);
      };
    } else {
      setIsAttached(false);
    }
  }, [snapshot, activeTerminal, id, isTuiActive]);

  const showSnapshot = snapshot !== null;
  // Use a very lenient check for snapshot text
  const hasSnapshotText = showSnapshot && (/\S/.test(snapshot.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ')));

  // Always show if attached (running) OR if we have a non-empty snapshot.
  // This ensures empty output commands collapse but active ones don't.
  const showOutput = isAttached || hasSnapshotText;

  return (
    <div className="notebook-cell">
      <div className="cell-header">
        <div className="cell-header-left">
          <span className="prompt-arrow">❯</span>
          <div className="input-container">
            <div className="read-only-command" style={{ fontFamily: 'var(--font-mono)', fontSize: '14px', color: 'var(--text-primary)' }}>
              {initialCommand}
            </div>
          </div>
        </div>
        {executablePwd && (
          <div className="cell-header-breadcrumb" title={executablePwd}>
            <Folder size={12} style={{ color: 'var(--accent-cyan)' }} />
            <span>{(() => {
              const parts = executablePwd.split('/').filter(Boolean);
              if (parts.length <= 3) return executablePwd;
              return '.../' + parts.slice(-3).join('/');
            })()}</span>
          </div>
        )}
      </div>

      <div className={`cell-output ${showSnapshot ? 'snapshot-output' : ''} ${!showOutput ? 'cell-output-collapsed' : ''}`}>
        {showSnapshot ? (
          <div dangerouslySetInnerHTML={{ __html: snapshot }} />
        ) : (
          <div ref={terminalRef} />
        )}
      </div>
    </div>
  );
}
