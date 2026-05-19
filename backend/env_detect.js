const cp = require('child_process');
const path = require('path');
const fs = require('fs');

const CACHE_TTL_MS = 5_000;
const cache = new Map();

function fromCache(key) {
    const entry = cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.ts > CACHE_TTL_MS) {
        cache.delete(key);
        return null;
    }
    return entry.value;
}

function setCache(key, value) {
    cache.set(key, { ts: Date.now(), value });
    if (cache.size > 200) {
        const oldest = cache.keys().next().value;
        cache.delete(oldest);
    }
}

function detectGitBranch(cwd) {
    if (!cwd || !fs.existsSync(cwd)) return null;
    const key = `git:${cwd}`;
    const cached = fromCache(key);
    if (cached !== null) return cached;
    let branch = null;
    try {
        const out = cp.execSync('git rev-parse --abbrev-ref HEAD 2>/dev/null', {
            cwd, encoding: 'utf8', timeout: 500,
            stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
        if (out && out !== 'HEAD') {
            branch = out;
        } else if (out === 'HEAD') {
            const sha = cp.execSync('git rev-parse --short HEAD 2>/dev/null', {
                cwd, encoding: 'utf8', timeout: 500,
                stdio: ['ignore', 'pipe', 'ignore'],
            }).trim();
            if (sha) branch = `(${sha})`;
        }
    } catch {}
    setCache(key, branch);
    return branch;
}

function detectVirtualEnv(ptyEnv) {
    if (!ptyEnv) return null;
    const venv = ptyEnv.VIRTUAL_ENV;
    if (venv && typeof venv === 'string' && venv.length > 0) {
        return path.basename(venv);
    }
    return null;
}

function detectCondaEnv(ptyEnv) {
    if (!ptyEnv) return null;
    const conda = ptyEnv.CONDA_DEFAULT_ENV;
    if (conda && typeof conda === 'string' && conda.length > 0 && conda !== 'base') {
        return conda;
    }
    return null;
}

function detectEnvironment(cwd, ptyEnv) {
    return {
        gitBranch: detectGitBranch(cwd),
        virtualEnv: detectVirtualEnv(ptyEnv),
        condaEnv: detectCondaEnv(ptyEnv),
    };
}

function clearCache() { cache.clear(); }

module.exports = { detectEnvironment, detectGitBranch, detectVirtualEnv, detectCondaEnv, clearCache };
