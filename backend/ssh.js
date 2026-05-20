// SSH command parser + remote shell integration builder.
//
// Termbook's "Path B for SSH": when the user runs `ssh user@host`, we let
// SSH connect normally, then once the remote shell prompt is visible, we
// inject a tiny shell-integration snippet that makes the remote shell emit
// SALTED OSC 133 / OSC 7 / OSC 1338 markers — exactly the same markers our
// local bash emits, but with a separate per-SSH-session salt.
//
// Result: each command run on the remote becomes a proper Termbook cell
// with real remote pwd / git branch / exit code in the chips.
//
// The user can opt out per-invocation with `ssh --no-termbook host`, or
// globally via a setting. If injection fails (non-bash/zsh shell, weird
// motd, etc.), we degrade gracefully to "Path A" (one big SSH cell with
// passthrough).

// Parse a command string. Returns:
//   isSsh           : starts with `ssh` (not scp/sftp/ssh-keygen/etc.)
//   isSingleShot    : ssh has trailing non-option arg (e.g. `ssh host fortune`)
//                     — there's no interactive remote shell to inject into.
//   optOut          : user passed --no-termbook
//   host            : a friendly "user@host" string for the SSH chip
//   cleanedCommand  : the command with `--no-termbook` stripped (safe to forward)
function parseSshCommand(cmd) {
  const result = { isSsh: false, isSingleShot: false, optOut: false, host: null, cleanedCommand: cmd };
  if (typeof cmd !== 'string') return result;
  const trimmed = cmd.trim();
  // Must start with `ssh` followed by space or EOL — exclude `sshfs`, `scp`,
  // `ssh-keygen`, etc.
  const sshHead = /^ssh(\s|$)/;
  if (!sshHead.test(trimmed)) return result;
  result.isSsh = true;

  // Tokenize cheaply (whitespace split; doesn't handle quoted args perfectly
  // but good enough for typical ssh invocations).
  const tokens = trimmed.split(/\s+/);
  // Drop the leading `ssh`.
  let i = 1;

  // Flags that take an argument we should skip alongside.
  const flagsWithArg = new Set([
    '-p', '-l', '-i', '-o', '-J', '-F', '-L', '-R', '-D', '-W', '-w', '-Q',
    '-S', '-c', '-m', '-e', '-b', '-B', '-E', '-I', '-O',
  ]);

  // Walk tokens to find host (first non-option token) + detect --no-termbook
  // + detect a trailing remote command.
  let host = null;
  let hostIdx = -1;
  const cleaned = [tokens[0]];
  while (i < tokens.length) {
    const t = tokens[i];
    if (t === '--no-termbook' || t === '--no-tb') {
      result.optOut = true;
      // Skip — don't pass through to ssh
      i++;
      continue;
    }
    cleaned.push(t);
    if (t === '--') { i++; continue; }
    if (t.startsWith('-')) {
      if (flagsWithArg.has(t) && i + 1 < tokens.length) {
        cleaned.push(tokens[i + 1]);
        i += 2;
      } else {
        // Bundled like `-tt` or value-attached like `-p2222` — single token.
        i++;
      }
      continue;
    }
    // First non-option = host.
    if (!host) {
      host = t;
      hostIdx = cleaned.length - 1;
      i++;
      // If any tokens remain, they're a remote command → single-shot.
      if (i < tokens.length) result.isSingleShot = true;
      // Append the rest unchanged.
      while (i < tokens.length) { cleaned.push(tokens[i]); i++; }
      break;
    }
    i++;
  }

  result.host = host;
  result.cleanedCommand = cleaned.join(' ');
  return result;
}

// The remote shell integration snippet.
//
// Goals (in order of importance):
//   1. Emit OSC 133;D;<exit>;<salt> after each command so Termbook can close
//      the cell with the REAL remote exit code.
//   2. Emit OSC 7;file://<host>/<pwd> so the breadcrumb shows REMOTE pwd.
//   3. Emit OSC 1338;TBENV;branch=<>;venv=<>;... so chips show remote env.
//   4. Don't disturb the user's interactive experience more than necessary.
//      We override PS1/PS2/PROMPT_COMMAND for this shell session only; user's
//      rcfile is not modified, and `exit` reverts everything.
//
// We target bash and zsh. For zsh we install via `precmd` instead of
// PROMPT_COMMAND, because zsh ignores PROMPT_COMMAND (it's a bash thing).
//
// `salt` is a per-SSH-session salt (different from the local PROMPT_COMMAND
// salt). The remote injection must not know the local salt and vice versa,
// so a malicious remote can't forge cell-closes for the LOCAL bash.
function buildRemoteIntegration(salt) {
  // The whole bootstrap is sent as one line so it executes atomically once
  // user hits Enter. Notes:
  //   - `command -v` is POSIX-portable; works in bash and zsh.
  //   - Hostname is emitted as part of OSC 7 (file://HOSTNAME/PWD).
  //   - We `unset PROMPT_COMMAND` before re-setting it so we don't append to
  //     whatever p10k / oh-my-zsh installed.
  //   - For zsh, we use `precmd` (a function called before each prompt).
  //   - We deliberately leak NO `echo` output — the bootstrap is silent.
  //     `stty -echo` runs first so even our own bootstrap line isn't visible.
  //     (Caveat: by the time `stty -echo` executes, the line itself has
  //      already been echoed — that one-time flicker is unavoidable without
  //      more invasive tricks. We rely on a subsequent `clear` to hide it.)
  //
  // The bootstrap intentionally does the work in three phases joined by `;`:
  //   (a) stty -echo (stop echoing further keystrokes)
  //   (b) install prompt machinery (function definitions, PROMPT_COMMAND)
  //   (c) emit one immediate marker by calling the prompt fn manually so
  //       Termbook learns initial pwd/env without waiting for user's next cmd
  // Statements need explicit `;` separators because we send this as a SINGLE
  // line. The function body uses `;` internally too. Don't use newlines —
  // the remote shell would interpret each as a separate command at the
  // outer level after the function body closes, and the bootstrap text
  // would echo back over many lines.
  const lines = [
    `stty -echo 2>/dev/null`,
    `export PS1=' '`,
    `export PS2=' '`,
    `export VIRTUAL_ENV_DISABLE_PROMPT=1`,
    `export CONDA_CHANGEPS1=false`,
    // Function definition — body uses internal `;` separators.
    `__tb_remote_prompt() { ` +
      `local __tb_exit=$?; ` +
      `local __tb_branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null); ` +
      `local __tb_venv="\${VIRTUAL_ENV:+venv=\${VIRTUAL_ENV##*/}}"; ` +
      `local __tb_conda="\${CONDA_DEFAULT_ENV:+conda=$CONDA_DEFAULT_ENV}"; ` +
      `local __tb_host=\${HOSTNAME:-$(hostname 2>/dev/null)}; ` +
      `local __tb_env_pairs="$__tb_venv\${__tb_venv:+\${__tb_conda:+;}}$__tb_conda"; ` +
      `__tb_env_pairs="\${__tb_env_pairs}\${__tb_env_pairs:+\${__tb_branch:+;}}\${__tb_branch:+branch=$__tb_branch}"; ` +
      `__tb_env_pairs="\${__tb_env_pairs}\${__tb_env_pairs:+;}host=$__tb_host"; ` +
      `printf '\\033]1338;TBENV;%s\\007\\033]133;D;%s;${salt}\\007\\033]7;file://%s%s\\007' "$__tb_env_pairs" "$__tb_exit" "$__tb_host" "$PWD"; ` +
    `}`,
    // bash: PROMPT_COMMAND. zsh: precmd function (we set both for safety).
    `PROMPT_COMMAND='__tb_remote_prompt'`,
    `if [ -n "$ZSH_VERSION" ]; then precmd_functions=(__tb_remote_prompt); fi`,
    // Fire once immediately so Termbook learns initial state without waiting.
    `__tb_remote_prompt`,
  ];
  return lines.join('; ');
}

// Heuristic: does this chunk of PTY output look like a fresh remote shell
// prompt is now waiting for input? We use this to decide WHEN to inject.
//
// Triggers: the last non-empty line ends with a prompt-like char (`$`, `#`,
// `>`, `❯`) followed by optional whitespace, AND the last 600ms have had no
// further output (caller enforces the timing).
//
// Returns true on positive match. We deliberately keep this LENIENT because
// false positives are merely cosmetic (we inject during a quiet moment that
// turns out not to be a prompt — bootstrap text shows up). False negatives
// mean we never inject and silently degrade to Path A — also acceptable.
const PROMPT_TAIL_RE = /[\$#>❯%]\s*$/m;
function looksLikeRemotePromptReady(text) {
  if (!text) return false;
  // Strip trailing newline-only whitespace, then look at the very last visible line.
  const stripped = text.replace(/\s+$/, '');
  if (!stripped) return false;
  // Find last non-empty line
  const lines = stripped.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].replace(/\x1b\[[0-9;]*[a-zA-Z]/g, ''); // strip CSI for matching
    if (!line.trim()) continue;
    return PROMPT_TAIL_RE.test(line);
  }
  return false;
}

module.exports = {
  parseSshCommand,
  buildRemoteIntegration,
  looksLikeRemotePromptReady,
};
