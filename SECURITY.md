# Security policy

## Threat model

Termbook is designed for **single-user, localhost-only** use. The threat
boundary is:

- **The local user is fully trusted.** They own the shell anyway.
- **The local browser is trusted** to faithfully forward keystrokes
  and not run arbitrary code outside its sandbox.
- **The local network is NOT trusted to host Termbook itself.** Do
  NOT bind the backend to `0.0.0.0` or expose port 4001/4000 beyond
  loopback. There is no authentication.

What this means in practice:

| Scenario | Termbook's behavior |
|---|---|
| `localhost:4000` opened in your browser | Intended. Gives you a shell. |
| Same Termbook server reached over LAN | **Anyone on the LAN gets your shell.** Don't do this. |
| Public deployment | Don't. You're handing out a shell. |

## Currently in-scope concerns

Since the model is "your machine, your browser, your shell," these are
the security-relevant invariants Termbook tries to maintain:

1. **Salted OSC 133 markers** prevent untrusted command output (or
   remote shells in SSH "Path B" mode) from forging cell-close events
   that could surface false success/failure to the user. See
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
  whatever your local shell can do. If a TUI app has an escape, that's
  the app's bug.
- **AI-related issues**: there is no LLM integration in v1.0.

## Reporting

Found something concerning? Open a regular GitHub issue if the impact
is low (e.g., "the placeholder text could be misleading"). For anything
that could let a remote attacker reach the local server, email the
maintainer directly — see [`package.json`](package.json) for the
current contact address. Please don't disclose publicly until there's
a fix.

There is no bounty program. This is a personal project; I'll do my
best to respond within a week.
