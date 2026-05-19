function parseOutput(tailBuf, salt = '') {
  const saltedRegex = salt
    ? new RegExp(`\\x1b\\]133;D;(\\d+);${salt}(?:\\x07|\\x1b\\\\)`)
    : null;
  const anyExitRegex = /\x1b\]133;D;(\d+)(?:;[^\x07\x1b]+)?(?:\x07|\x1b\\)/;
  const pwdRegex = /\x1b\]7;file:\/\/(.*?)(?=\x07|\x1b\\)/;
  // Custom Termbook env marker: OSC 1338 ; TBENV ; key=val ; key=val BEL/ST
  const envRegex = /\x1b\]1338;TBENV;([^\x07\x1b]*)(?:\x07|\x1b\\)/;

  let exitMatch = saltedRegex ? tailBuf.match(saltedRegex) : null;
  if (!exitMatch) exitMatch = tailBuf.match(anyExitRegex);

  const pwdMatch = tailBuf.match(pwdRegex);
  const envMatch = tailBuf.match(envRegex);
  if (!exitMatch) return null;

  const indices = [exitMatch.index, exitMatch.index + exitMatch[0].length];
  if (pwdMatch) {
    indices.push(pwdMatch.index, pwdMatch.index + pwdMatch[0].length);
  }
  if (envMatch) {
    indices.push(envMatch.index, envMatch.index + envMatch[0].length);
  }
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
    before: tailBuf.substring(0, firstIndex),
    firstIndex,
    matchEnd: lastIndex,
  };
}
module.exports = { parseOutput };
