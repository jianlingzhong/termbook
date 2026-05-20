import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Folder, Copy, RotateCcw, Check, AlertTriangle, GitBranch, Package, Server } from 'lucide-react';
import { Terminal } from 'xterm';
import { SerializeAddon } from '@xterm/addon-serialize';

function formatDuration(ms) {
    if (ms == null || ms < 0) return '';
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`;
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    return `${m}m ${s}s`;
}

function formatTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function stripAnsi(s) {
    if (!s) return '';
    return s.replace(/\x1b\][^\x07]*\x07/g, '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\x1b\([B0]/g, '').replace(/\r\n?/g, '\n');
}

function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function ansiToPlainHtml(ansi) {
    const stripped = stripAnsi(ansi).replace(/\n+$/, '');
    if (!stripped.trim()) return '';
    return `<pre style="margin:0;font-family:monospace;color:#e0e5ff;white-space:pre-wrap;line-height:1.6;font-size:13px">${escapeHtml(stripped)}</pre>`;
}

function trimSnapshotRows(html) {
    const rowRegex = /<div><span([^>]*)>([\s\S]*?)<\/span><\/div>/g;
    const rows = [];
    let match;
    while ((match = rowRegex.exec(html)) !== null) {
        const content = match[2];
        const stripped = content.replace(/<[^>]+>/g, '');
        const trimmed = stripped.replace(/[\s\u00a0]/g, '');
        rows.push({
            start: match.index,
            end: match.index + match[0].length,
            empty: trimmed.length === 0,
        });
    }
    if (rows.length === 0) return html;
    let first = 0;
    while (first < rows.length && rows[first].empty) first++;
    let last = rows.length - 1;
    while (last >= 0 && rows[last].empty) last--;
    if (first > last) return '';
    const prefix = html.substring(0, rows[first].start);
    const middle = html.substring(rows[first].start, rows[last].end);
    const suffix = html.substring(rows[rows.length - 1].end);
    let result = prefix + middle + suffix;
    result = result.replace(/<div><span([^>]*)>([ \u00a0]+)([^<])/, '<div><span$1>$3');
    return result;
}

export default function NotebookCell({ id, snapshotAnsi, snapshotCols, snapshotRows, activeTerminal, initialCommand, executablePwd, isRunning, isTuiActive, requestResize, exitCode, startedAt, finishedAt, usedTui, gitBranch, virtualEnv, condaEnv, remoteHost, usedSshSession, onRerun }) {
  const terminalRef = useRef(null);
  const [isTerminalAttached, setIsTerminalAttached] = useState(false);
  const [renderedSnapshot, setRenderedSnapshot] = useState(null);
  const [liveContentRows, setLiveContentRows] = useState(0);
  const plainPlaceholder = useMemo(() => snapshotAnsi ? ansiToPlainHtml(snapshotAnsi) : null, [snapshotAnsi]);
  const displaySnapshot = renderedSnapshot || plainPlaceholder;

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
            rows: Math.max(24, snapshotRows || 24),
            cols: Math.max(80, snapshotCols || 120),
            allowProposedApi: true,
            scrollback: 5000
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
                       .replace(/background-color:\s*#ffff00/g, 'background-color: transparent')
                       // SerializeAddon bakes in `font-family: courier-new` and
                       // `font-size: 15px` which are wider than our CSS choice
                       // and leave horizontal space empty on wide displays.
                       // Strip them so the snapshot inherits .snapshot-output's
                       // JetBrains Mono at 13px.
                       .replace(/font-family:\s*[^;"']+;?/gi, '')
                       .replace(/font-size:\s*[^;"']+;?/gi, '');
            cleaned = trimSnapshotRows(cleaned);
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

        // Debounced + deduped resize: only emit when dimensions actually change,
        // and at most once per 200ms. Prevents the SIGWINCH storm from
        // ResizeObserver micro-fires during layout shuffles.
        let debounceTimer = null;
        let lastCols = -1;
        let lastRows = -1;
        const emitResize = () => {
            debounceTimer = null;
            try {
                fitAddon.fit();
                const dims = fitAddon.proposeDimensions();
                if (!dims || !requestResize) return;
                // 1-col safety margin (was 4) to avoid horizontal scrollbar
                // due to sub-pixel rounding. Larger margins waste 3+ cols of
                // screen real estate on wide displays.
                const safeCols = Math.max(10, dims.cols - 1);
                const safeRows = dims.rows;
                if (safeCols === lastCols && safeRows === lastRows) return;
                lastCols = safeCols;
                lastRows = safeRows;
                requestResize(safeCols, safeRows);
            } catch (e) {}
        };
        const scheduleResize = () => {
            if (debounceTimer) return;
            debounceTimer = setTimeout(emitResize, 200);
        };

        const initialTimer = setTimeout(emitResize, 100);
        const ro = new ResizeObserver(scheduleResize);
        ro.observe(terminalRef.current);

        const updateContentRows = () => {
            try {
                const buf = terminal.buffer.active;
                let lastRow = 0;
                for (let i = 0; i < buf.length; i++) {
                    const line = buf.getLine(i);
                    if (line && line.translateToString(true).trim().length > 0) lastRow = i + 1;
                }
                const cursorAbs = (buf.baseY || 0) + (buf.cursorY || 0) + 1;
                setLiveContentRows(Math.max(lastRow, cursorAbs));
            } catch (e) {}
        };
        updateContentRows();
        const contentTick = setInterval(updateContentRows, 80);

        return () => {
            ro.disconnect();
            clearTimeout(initialTimer);
            if (debounceTimer) clearTimeout(debounceTimer);
            clearInterval(contentTick);
        };
    }
  }, [id, renderedSnapshot, activeTerminal, isTerminalAttached, isTuiActive, requestResize]);

  const [copied, setCopied] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const outputRef = useRef(null);
  const copy = async (what, value) => {
    try { await navigator.clipboard.writeText(value); setCopied(what); setTimeout(() => setCopied(null), 1200); } catch {}
  };
  const failed = exitCode != null && exitCode !== 0;
  const duration = startedAt && finishedAt ? finishedAt - startedAt : null;

  useEffect(() => {
    if (!renderedSnapshot) return;
    const el = outputRef.current;
    if (!el) return;
    const check = () => setOverflowing(el.scrollHeight > el.clientHeight + 2);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [renderedSnapshot, expanded]);
  const cellClasses = ['notebook-cell'];
  if (isRunning) cellClasses.push('active-cell');
  if (failed) cellClasses.push('failed-cell');
  if (!isRunning && exitCode === 0) cellClasses.push('success-cell');

  return (
    <div className={cellClasses.join(' ')} data-cell-id={id}>
      <div className="cell-header">
        <div className="cell-header-left">
            {isRunning ? (
                <span className="cell-status running" title="Running"><span className="running-spinner" aria-hidden="true" /></span>
            ) : failed ? (
                <span className="cell-status failed" title={`Exit ${exitCode}`}><AlertTriangle size={12} /></span>
            ) : exitCode === 0 ? (
                <span className="cell-status success" title="Exit 0"><Check size={12} /></span>
            ) : (
                <span className="prompt-arrow">❯</span>
            )}
            <span className="read-only-command">{initialCommand}</span>
            {failed && <span className="exit-code-badge" title={`Exit ${exitCode}`}>exit {exitCode}</span>}
        </div>
        <div className="cell-header-right">
            {duration != null && <span className="cell-duration" title={`Took ${duration}ms`}>{formatDuration(duration)}</span>}
            {startedAt != null && <span className="cell-time" title={new Date(startedAt).toLocaleString()}>{formatTime(startedAt)}</span>}
            {!isRunning && initialCommand && (
                <>
                  <button className="cell-icon-btn" title={copied === 'cmd' ? 'Copied!' : 'Copy command'} onClick={(e) => { e.stopPropagation(); copy('cmd', initialCommand); }}>
                    {copied === 'cmd' ? <Check size={12} /> : <Copy size={12} />}
                  </button>
                  {onRerun && (
                    <button className="cell-icon-btn" title="Re-run" onClick={(e) => { e.stopPropagation(); onRerun(initialCommand); }}>
                      <RotateCcw size={12} />
                    </button>
                  )}
                </>
            )}
            {remoteHost && (
                <div className="cell-env-chip cell-env-chip-ssh" title={`SSH: ${remoteHost}`}>
                    <Server size={11} />
                    <span>{remoteHost}</span>
                </div>
            )}
            {gitBranch && (
                <div className="cell-env-chip cell-env-chip-git" title={`git: ${gitBranch}`}>
                    <GitBranch size={11} />
                    <span>{gitBranch}</span>
                </div>
            )}
            {virtualEnv && (
                <div className="cell-env-chip cell-env-chip-venv" title={`venv: ${virtualEnv}`}>
                    <Package size={11} />
                    <span>{virtualEnv}</span>
                </div>
            )}
            {condaEnv && (
                <div className="cell-env-chip cell-env-chip-conda" title={`conda: ${condaEnv}`}>
                    <Package size={11} />
                    <span>{condaEnv}</span>
                </div>
            )}
            {executablePwd && (
                <div className="cell-header-breadcrumb" title={executablePwd}>
                    <Folder size={12} color="var(--accent-cyan)" />
                    <span>{executablePwd.split('/').slice(-3).join('/')}</span>
                </div>
            )}
        </div>
      </div>
      <div className="cell-output-wrap">
        <div
          ref={outputRef}
          className="cell-output"
          style={
            (usedTui || usedSshSession) && !isRunning
              ? { minHeight: '32px', background: '#000', overflow: 'hidden' }
              : displaySnapshot
              // Snapshot cap leaves room for the chat input (~150px) so the
              // overflow hint isn't covered by the input gradient.
              ? { maxHeight: expanded ? 'none' : 'calc(80vh - 100px)', overflowY: expanded ? 'visible' : 'auto', background: '#000' }
              : isTuiActive
                ? { height: '120px', minHeight: '120px', background: '#000' }
                : (() => {
                    const lineH = 22;
                    const padding = 12;
                    const contentH = Math.max(1, liveContentRows) * lineH + padding;
                    const maxH = Math.floor(window.innerHeight * 0.8);
                    const h = Math.min(contentH, maxH);
                    return { height: `${h}px`, minHeight: '32px', maxHeight: `${maxH}px`, background: '#000', overflow: 'hidden', transition: 'height 0.12s ease-out' };
                  })()
          }
        >
          {usedTui && !isRunning && (
            <div className="tui-completed-placeholder">Interactive session ended</div>
          )}
          {usedSshSession && !isRunning && (
            <div className="tui-completed-placeholder">SSH session — each remote command appears as its own cell below</div>
          )}
          {!usedTui && !usedSshSession && displaySnapshot && (
            <div
              className="snapshot-output"
              dangerouslySetInnerHTML={{ __html: displaySnapshot }}
              style={{ width: '100%' }}
            />
          )}
          {!usedTui && !usedSshSession && !displaySnapshot && isTuiActive && (
            <div className="tui-placeholder">Interactive TUI session active in modal...</div>
          )}
          {!usedTui && !usedSshSession && !displaySnapshot && !isTuiActive && (
            <div className="live-terminal" ref={terminalRefCallback} style={{ width: '100%', height: '100%' }} />
          )}
        </div>
        {renderedSnapshot && overflowing && !expanded && (
          <div className="cell-overflow-hint" onClick={() => setExpanded(true)}>
            <span>Show all ({Math.ceil((outputRef.current?.scrollHeight || 0) / 22)} lines)</span>
          </div>
        )}
        {renderedSnapshot && expanded && (
          <div className="cell-collapse-btn">
            <button onClick={() => setExpanded(false)}>Collapse</button>
          </div>
        )}
      </div>
    </div>
  );
}
