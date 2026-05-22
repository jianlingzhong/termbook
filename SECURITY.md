# Security policy

## Threat model

Termbook is designed for **single-user, localhost-only** use. The
threat boundary is:

- **The local user is fully trusted.** They own the shell anyway.
- **The local browser is trusted** to faithfully forward keystrokes
  and not run arbitrary code outside its sandbox.
- **The local network is NOT trusted to host Termbook itself.** Both
  the frontend dev server (`:4000`, via Vite) and the backend
  (`:4001`) bind to `127.0.0.1` by default, which keeps them
  reachable only from loopback. There is no authentication, so
  widening either bind (backend: `TERMBOOK_BIND=0.0.0.0`; frontend:
  edit `vite.config.js`) hands a shell to every device on the LAN.
  Don't do it without a reverse proxy in front that does auth.

  Note: widening **only** the frontend without widening the backend
  is *also* unsafe — the frontend proxies `/api` and `/ws` through to
  the backend's loopback :4001, so a network attacker reaching the
  frontend gets the same shell access as if the backend were exposed
  directly.

What this means in practice:

| Scenario | Termbook's behavior |
|---|---|
| `localhost:4000` opened in your browser | Intended. Gives you a shell. |
| Backend bound to `0.0.0.0` over LAN | **Anyone on the LAN gets your shell.** Don't do this without auth in front. |
| Public deployment | Don't. You're handing out a shell. |

## In-scope concerns

Since the model is "your machine, your browser, your shell," these
are the security-relevant invariants Termbook tries to maintain:

1. **Salted OSC 133 markers** prevent untrusted command output (or
   remote shells when the SSH integration is active) from forging
   cell-close events that could surface false success/failure. See
   [`docs/decisions.md#salted-marker`](docs/decisions.md#salted-marker)
   for the threat reasoning.

2. **`stty -echo`** in the shell rcfile ensures injected setup lines
   don't leak. The SSH integration follows the same pattern remotely.

3. **`localStorage`-stored settings** (theme, pinned commands) do not
   accept arbitrary HTML or scripts.

4. **No arbitrary code execution from the URL bar.** The frontend
   never `eval()`s anything from URL parameters or backend messages.

## Out-of-scope

- **CSRF**: Termbook accepts WS messages from any same-origin client
  to localhost. This is intentional (multiple browser tabs need to
  share a session). It also means **a malicious local webpage could
  open `ws://localhost:4001/ws` and submit commands** — but a local
  webpage running malicious code in your browser already has bigger
  problems.
- **Container/VM escapes via PTY tricks** — Termbook just exposes
  whatever the local shell can do. If a TUI app has an escape, that's
  the app's bug.
- **AI-related issues**: there is no LLM integration in v1.0.

## Reporting a vulnerability

If you find an issue that could let a remote attacker reach the
local server, or any other vulnerability you believe should be
addressed before public disclosure:

- **Use GitHub's private vulnerability reporting** at
  https://github.com/jianlingzhong/termbook/security/advisories/new
  (you'll need a GitHub account; the report is private until a fix
  ships).
- Or open a regular GitHub issue if the impact is low (e.g.
  "the placeholder text could be misleading").

Please don't disclose publicly until there's a fix. There is no
bounty program. Best-effort response within a week.
