function parseOutput(tailBuf, salt = '') {
  const saltMatcher = salt ? `;${salt}` : '(?:;[^\\\\x07]+)?';



  const exitRegex = new RegExp(`\\x1b\\]133;D;(\\d+)${saltMatcher}\\x07`);
  const pwdRegex = /\x1b\]7;file:\/\/(.*?)(?=\x07)/;
  const exitMatch = tailBuf.match(exitRegex);
  const pwdMatch = tailBuf.match(pwdRegex);
  if (exitMatch && pwdMatch) {
    const firstIndex = Math.min(exitMatch.index, pwdMatch.index);
    const lastIndex = Math.max(exitMatch.index + exitMatch[0].length, pwdMatch.index + pwdMatch[0].length);
    let pwd = pwdMatch[1];
    if (pwd.indexOf('/') !== -1) {
        pwd = pwd.substring(pwd.indexOf('/'));
    }
    return { exitCode: parseInt(exitMatch[1], 10), pwd, before: tailBuf.substring(0, firstIndex), firstIndex, matchEnd: lastIndex };
  }

  return null;
}
module.exports = { parseOutput };
