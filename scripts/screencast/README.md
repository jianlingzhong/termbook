# Screencast generator

Regenerates `docs/termbook-demo.gif` — the animated demo embedded in the
top-level README.

## Why this exists

The README needs a demo that shows Termbook doing real things: running
shell commands, viewing output as scrollable cells, opening a TUI in
the modal, switching between sessions. A static screenshot can't
convey any of that.

## How to regenerate

```bash
# 1. Start Termbook (backend + frontend) on http://localhost:4000.
bash scripts/restart_servers.sh

# 2. Prep the throwaway demo workspace at /tmp/termbook-demo.
bash scripts/screencast/prep.sh

# 3. Record the screencast (~45s).
node scripts/screencast/record.mjs

# 4. Convert to optimized gif.
bash scripts/screencast/to-gif.sh

# 5. Copy to docs/ (where the README references it).
cp scripts/screencast/output/termbook-demo.gif docs/termbook-demo.gif
```

## Privacy guarantees

Everything shown in the recording is safe for public consumption:

- **All commands run in `/tmp/termbook-demo`** — a throwaway directory
  with three fake commits, a tiny README, and a tiny python file.
  Set up fresh by `prep.sh`.
- **The chat-input prompt hostname is overridden** to `localhost` via
  Playwright's `page.route` mock of `/api/config`. The recorder's
  real machine hostname (which Termbook normally shows) never appears.
- **The top pwd-breadcrumb is hidden** via injected CSS so the
  backend's launch directory (which would otherwise briefly show the
  recorder's home path) is invisible.
- **Per-cell pwd chips** containing the current `$USER` name or
  `/Users/<name>/` are masked via a MutationObserver in the injected
  init script — a defensive belt around the `cd /tmp/termbook-demo`
  early in the demo. The mask list is derived from the recorder's
  environment at runtime.

If you adapt this for your own fork:

- The default mask list already uses `$USER` from your environment,
  so any path under your home directory gets hidden automatically.
- Set `TERMBOOK_DEMO_MASK="org-name,project-name"` (comma-separated)
  to add more substrings to mask.
- `body.localHostname = 'localhost'` in `record.mjs` controls the
  hostname shown in the chat prompt.
- Edit `prep.sh` if you want different demo content.

## Files

- `prep.sh` — creates `/tmp/termbook-demo` with safe content + 3 git commits
- `record.mjs` — Playwright driver that records `output/video.webm`
- `to-gif.sh` — two-pass ffmpeg palette → optimized gif
- `.gitignore` — keeps the `output/` working dir out of git
