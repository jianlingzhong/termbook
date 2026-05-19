const fs = require('fs');
const path = require('path');
const os = require('os');

const BUILTINS = [
    'cd', 'pwd', 'echo', 'export', 'unset', 'alias', 'unalias', 'history',
    'jobs', 'kill', 'fg', 'bg', 'wait', 'exec', 'source', '.', 'eval',
    'set', 'shift', 'trap', 'umask', 'exit', 'return', 'true', 'false',
    'test', '[', 'type', 'which', 'help', 'read', 'printf',
];

let pathExecutables = null;
let pathExecutablesAt = 0;
const PATH_CACHE_MS = 30_000;

function listPathExecutables() {
    const now = Date.now();
    if (pathExecutables && (now - pathExecutablesAt) < PATH_CACHE_MS) {
        return pathExecutables;
    }
    const dirs = (process.env.PATH || '').split(':').filter(Boolean);
    const seen = new Set();
    for (const d of dirs) {
        try {
            for (const name of fs.readdirSync(d)) {
                if (seen.has(name)) continue;
                try {
                    const full = path.join(d, name);
                    const st = fs.statSync(full);
                    if (!st.isFile()) continue;
                    if (!(st.mode & 0o111)) continue;
                    seen.add(name);
                } catch {}
            }
        } catch {}
    }
    pathExecutables = Array.from(seen).sort();
    pathExecutablesAt = now;
    return pathExecutables;
}

function expandTilde(p) {
    if (!p) return p;
    if (p === '~') return os.homedir();
    if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
    return p;
}

function listPathCompletions(token, cwd) {
    const expanded = expandTilde(token);
    let dir, prefix;
    if (expanded.endsWith('/')) {
        dir = expanded;
        prefix = '';
    } else {
        dir = path.dirname(expanded) || '.';
        prefix = path.basename(expanded);
    }
    const absDir = path.isAbsolute(dir) ? dir : path.resolve(cwd, dir);
    let entries;
    try {
        entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
        return [];
    }
    const matches = entries
        .filter(e => e.name.startsWith(prefix))
        .filter(e => prefix.length > 0 || !e.name.startsWith('.'))
        .map(e => {
            const display = e.name + (e.isDirectory() ? '/' : '');
            const tokenPrefix = token.endsWith('/') ? token : (token.includes('/') ? token.slice(0, token.lastIndexOf('/') + 1) : '');
            return { value: tokenPrefix + display, display, isDir: e.isDirectory() };
        })
        .sort((a, b) => {
            if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
            return a.display.localeCompare(b.display);
        });
    return matches.slice(0, 50);
}

function tokenize(input) {
    const tokens = [];
    let cur = '';
    let i = 0;
    let inSingle = false;
    let inDouble = false;
    while (i < input.length) {
        const c = input[i];
        if (!inSingle && !inDouble && (c === ' ' || c === '\t')) {
            if (cur.length > 0) { tokens.push(cur); cur = ''; }
            i++;
            continue;
        }
        if (!inDouble && c === "'") { inSingle = !inSingle; cur += c; i++; continue; }
        if (!inSingle && c === '"') { inDouble = !inDouble; cur += c; i++; continue; }
        if (c === '\\' && i + 1 < input.length) { cur += c + input[i+1]; i += 2; continue; }
        cur += c;
        i++;
    }
    const endsWithSpace = input.length > 0 && (input.endsWith(' ') || input.endsWith('\t'));
    return { tokens, currentToken: endsWithSpace ? '' : cur, endsWithSpace };
}

function complete(input, cwd, extraAliases = []) {
    const { tokens, currentToken, endsWithSpace } = tokenize(input);
    const aliasNames = extraAliases.map(a => {
        const m = a.match(/^alias\s+([A-Za-z_][\w-]*)/);
        return m ? m[1] : null;
    }).filter(Boolean);

    const isFirstToken = tokens.length === 0;
    let candidates = [];

    if (isFirstToken && !currentToken.includes('/')) {
        const all = new Set([...BUILTINS, ...aliasNames, ...listPathExecutables()]);
        candidates = Array.from(all)
            .filter(n => n.startsWith(currentToken))
            .sort()
            .slice(0, 50)
            .map(n => ({ value: n, display: n, isDir: false }));
    } else {
        candidates = listPathCompletions(currentToken, cwd);
    }

    return { tokens, currentToken, candidates };
}

function applyCompletion(input, candidate) {
    const { currentToken } = tokenize(input);
    if (!currentToken) return input + candidate.value;
    if (input.endsWith(currentToken)) {
        return input.slice(0, input.length - currentToken.length) + candidate.value;
    }
    return input + candidate.value;
}

module.exports = { complete, applyCompletion, listPathExecutables, tokenize };
