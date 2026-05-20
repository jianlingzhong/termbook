// Parses shell-integration OSC markers out of a PTY tail buffer.
//
// Markers we understand:
//   - OSC 133 ; D ; <exit> ; <salt>      → command finish (with cryptographic salt)
//   - OSC 7  ; file://host/<pwd>          → cwd update
//   - OSC 1338 ; TBENV ; <k=v;...>        → Termbook env (venv/conda/branch/host)
//
// Both BEL (\x07) and ST (\x1b\\) are accepted as terminators because
// Powerlevel10k emits ST.
//
// SALTS — IMPORTANT. The salt is a per-shell cryptographic nonce installed
// into PROMPT_COMMAND. It prevents:
//   (a) malicious remote output from forging a cell-close
//   (b) shell-integration plugins (p10k, atuin, fzf) on remote shells from
//       prematurely closing the local cell they're piped into
//
// parseOutput accepts an array of salts. Each PTY may carry markers from
// two shells stacked on top of each other:
//   - LOCAL bash with `localSalt`            (always present)
//   - REMOTE bash/zsh with `sshSalt`         (after we inject Path B integration
//                                             inside an active `ssh` cell)
// The first matching salt wins. Returns `which` field telling caller which
// salt matched, so the backend can decide whether to close a local cell or
// a remote cell.
//
// `allowUnsalted=true` is a backward-compat escape hatch for the bootstrap
// case where the local shell hasn't yet emitted its first PROMPT_COMMAND
// (we're still learning the initial pwd). Real cells should pass false.

function parseOutput(tailBuf, salts = [], { allowUnsalted = false } = {}) {
  // Accept either: array of salts, or a single salt string (back-compat).
  if (typeof salts === 'string') salts = salts ? [salts] : [];

  const pwdRegex = /\x1b\]7;file:\/\/(.*?)(?=\x07|\x1b\\)/;
  const envRegex = /\x1b\]1338;TBENV;([^\x07\x1b]*)(?:\x07|\x1b\\)/;
  const anyExitRegex = /\x1b\]133;D;(\d+)(?:;[^\x07\x1b]+)?(?:\x07|\x1b\\)/;

  // Try each salt in order. The "winning" salt determines `which`.
  let exitMatch = null;
  let whichSalt = null; // 'local', 'ssh', or 'unsalted'
  let whichIndex = -1;
  for (let i = 0; i < salts.length; i++) {
    const salt = salts[i];
    if (!salt) continue;
    const re = new RegExp(`\\x1b\\]133;D;(\\d+);${salt}(?:\\x07|\\x1b\\\\)`);
    const m = tailBuf.match(re);
    if (m) {
      // Earliest match wins — important when both shells emit close to each
      // other (e.g., the moment remote bash closes a cell AND local bash
      // closes the ssh cell — we want the inner one first).
      if (!exitMatch || m.index < exitMatch.index) {
        exitMatch = m;
        whichIndex = i;
      }
    }
  }
  if (exitMatch) {
    whichSalt = (whichIndex === 0) ? 'local' : (whichIndex === 1 ? 'ssh' : `salt${whichIndex}`);
  } else if (allowUnsalted) {
    exitMatch = tailBuf.match(anyExitRegex);
    if (exitMatch) whichSalt = 'unsalted';
  }
  if (!exitMatch) return null;

  const pwdMatch = tailBuf.match(pwdRegex);
  const envMatch = tailBuf.match(envRegex);

  const indices = [exitMatch.index, exitMatch.index + exitMatch[0].length];
  if (pwdMatch) indices.push(pwdMatch.index, pwdMatch.index + pwdMatch[0].length);
  if (envMatch) indices.push(envMatch.index, envMatch.index + envMatch[0].length);
  const firstIndex = Math.min(...indices);
  const lastIndex = Math.max(...indices);

  let pwd = null;
  if (pwdMatch) {
    pwd = pwdMatch[1];
    if (pwd.indexOf('/') !== -1) pwd = pwd.substring(pwd.indexOf('/'));
  }

  let env = null;
  if (envMatch) {
    env = {};
    for (const pair of envMatch[1].split(';')) {
      const eq = pair.indexOf('=');
      if (eq < 0) continue;
      const k = pair.slice(0, eq);
      const v = pair.slice(eq + 1);
      if (k) env[k] = v;
    }
  }

  return {
    exitCode: parseInt(exitMatch[1], 10),
    pwd,
    env,
    which: whichSalt,
    before: tailBuf.substring(0, firstIndex),
    firstIndex,
    matchEnd: lastIndex,
  };
}

module.exports = { parseOutput };
