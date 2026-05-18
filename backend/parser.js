function parseOutput(tailBuf, salt = '') {
  const saltedRegex = salt
    ? new RegExp(`\\x1b\\]133;D;(\\d+);${salt}(?:\\x07|\\x1b\\\\)`)
    : null;
  const anyExitRegex = /\x1b\]133;D;(\d+)(?:;[^\x07\x1b]+)?(?:\x07|\x1b\\)/;
  const pwdRegex = /\x1b\]7;file:\/\/(.*?)(?=\x07|\x1b\\)/;

  let exitMatch = saltedRegex ? tailBuf.match(saltedRegex) : null;
  if (!exitMatch) exitMatch = tailBuf.match(anyExitRegex);

  const pwdMatch = tailBuf.match(pwdRegex);
  if (!exitMatch) return null;

  const firstIndex = pwdMatch
    ? Math.min(exitMatch.index, pwdMatch.index)
    : exitMatch.index;
  const lastIndex = pwdMatch
    ? Math.max(exitMatch.index + exitMatch[0].length, pwdMatch.index + pwdMatch[0].length)
    : exitMatch.index + exitMatch[0].length;

  let pwd = null;
  if (pwdMatch) {
    pwd = pwdMatch[1];
    if (pwd.indexOf('/') !== -1) pwd = pwd.substring(pwd.indexOf('/'));
  }

  return {
    exitCode: parseInt(exitMatch[1], 10),
    pwd,
    before: tailBuf.substring(0, firstIndex),
    firstIndex,
    matchEnd: lastIndex,
  };
}
module.exports = { parseOutput };
