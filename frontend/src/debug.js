// Lightweight always-on diagnostic logger.
//
// Goal: when a user reports a UI bug (e.g. "ls cell stuck spinning, no
// output"), they can run `__tbDebug()` in the browser console and get a
// JSON dump of the last few hundred events — terminal lifecycle, WS
// messages, errors, addon load results — so the bug can be diagnosed
// without local repro.
//
// Design constraints:
//   - Zero ceremony to use: just `import { tbLog } from './debug';`
//     and call `tbLog('CATEGORY', msg, optionalDetails)`.
//   - Ring buffer (last 500 events) so it can run forever without
//     leaking memory.
//   - Captures uncaught errors automatically via window 'error' and
//     'unhandledrejection' handlers.
//   - Exposes `window.__tbDebug()` for the user to invoke.
//   - Tiny perf cost: just pushes a small object to an array, no
//     stringification until dump time.
//
// NOT a replacement for backend's debugLog → ssr_debug.log. The two
// together (browser dump + ssr log) give us full bidirectional
// observability.

const MAX_EVENTS = 500;
const events = [];

export function tbLog(category, message, details) {
    const entry = {
        t: Date.now(),
        cat: category,
        msg: message,
    };
    if (details !== undefined) entry.d = details;
    events.push(entry);
    if (events.length > MAX_EVENTS) events.shift();
}

// Capture uncaught errors automatically — these are usually the most
// useful pieces of info for "something broke and I don't know what".
if (typeof window !== 'undefined') {
    window.addEventListener('error', (e) => {
        tbLog('ERROR', 'window.error', {
            message: e.message,
            file: e.filename,
            line: e.lineno,
            col: e.colno,
            stack: e.error?.stack?.split('\n').slice(0, 8).join('\n'),
        });
    });
    window.addEventListener('unhandledrejection', (e) => {
        tbLog('ERROR', 'unhandledrejection', {
            reason: String(e.reason),
            stack: e.reason?.stack?.split('\n').slice(0, 8).join('\n'),
        });
    });

    // Public dump function. Invoking it from the console pretty-prints
    // the ring buffer and also returns it as a string so the user can
    // copy/paste back to a maintainer / agent.
    window.__tbDebug = function tbDebugDump() {
        const lines = events.map(e => {
            const ts = new Date(e.t).toISOString().slice(11, 23);
            const d = e.d !== undefined ? '  ' + JSON.stringify(e.d) : '';
            return `[${ts}] [${e.cat}] ${e.msg}${d}`;
        });
        const text = lines.join('\n');
        // eslint-disable-next-line no-console
        console.log('=== Termbook debug dump (last ' + events.length + ' events) ===\n' + text);
        // Also copy to clipboard if available so the user can paste back.
        try {
            navigator.clipboard.writeText(text);
            // eslint-disable-next-line no-console
            console.log('(copied to clipboard)');
        } catch {}
        return text;
    };

    tbLog('BOOT', 'debug logger initialized', {
        ua: navigator.userAgent.slice(0, 120),
        viewport: `${window.innerWidth}x${window.innerHeight}`,
        dpr: window.devicePixelRatio,
        href: location.href,
    });
}
