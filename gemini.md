# Project Rules

- **Automated Verification Only**: All verification MUST be implemented via code automation. This includes browser simulation and human interaction simulation. Manual verification is strictly prohibited.
- **Configurability**: The project name and other global identifiers must be configurable via a central configuration file (`app_config.json`). Hardcoding names like "Argo" or "TermShell" is not allowed.
- **Screenshot Examination**: Whenever a screenshot is provided, you MUST examine it pixel by pixel. Pay special attention to any annotations or red markings regarding errors or requested features.

## Technical Pitfalls & Best Practices

- **Regex & Control Sequences**: When matching terminal escape sequences (like OSC 1337) in `server.js`, avoid over-escaping in `new RegExp` templates. Use hex escapes (`\x1b`, `\x07`) directly.
- **Terminal Snapshotting**: xterm.js and PTY operations are asynchronous. When generating a persistent snapshot of a command's output, implement a sufficient delay (e.g., 250ms+) after the completion marker is received to allow the terminal buffer to flush.
- **Port Management & Proxying**: Avoid hardcoding backend ports (e.g., `:3001`) in the frontend. Use relative URLs and configure the Vite proxy in `vite.config.js` to route `/api` and `/ws` traffic. This prevents connection mismatches and env-specific bugs.
- **Visual Diagnostics**: If Playwright tests timeout without output, use a browser subagent or screenshots immediately. This is the fastest way to catch "Blank Page" crashes caused by JavaScript `ReferenceError` during initial render.
- **Renaming Integrity**: After refactoring or renaming functions, perform a global `grep` search for the old string. LSPs may miss references in JSX props or event handlers.
