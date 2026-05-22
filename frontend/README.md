# Termbook frontend

React + Vite + xterm.js client for Termbook. See the
[top-level README](../README.md) for project overview, install, and run
instructions, and [`AGENTS.md`](../AGENTS.md) for the engineering
contract.

## Quick commands

```bash
npm install
npm run dev           # Vite dev server on :4000 (HMR disabled — see vite.config.js)
npm run build         # production build → dist/
npm run lint          # eslint src/

# Tests
npm run test:visual   # 40 functional + motion-regression tests (~3 min)
npm run test:e2e      # 61 end-to-end tests with screenshots/video (~6 min)
npm run test:all      # both
```

## Layout

```
src/
├── main.jsx           React entry point
├── App.jsx            session/cell/WS state (~1320 lines, single file by design)
├── NotebookCell.jsx   per-cell rendering (live xterm + snapshot HTML)
├── TuiModal.jsx       full-screen TUI host (vim, htop, etc.)
├── debug.js           ring-buffer logger (window.__tbDebug() in DevTools)
└── index.css          all styles

tests/
├── visual/            fast functional + motion-regression suite
└── e2e/               full human-workflow tests with video + pixel goldens

playwright.visual.config.js   visual suite config
playwright.e2e.config.js      e2e suite config
vite.config.js                Vite dev server config (HMR off, /api proxy → :4001)
eslint.config.js
```

## Things worth knowing

- **HMR is intentionally disabled** in `vite.config.js`. xterm.js's
  internal renderer state survives HMR component swaps and gets
  corrupted mid-session. Hard-reload (Cmd+Shift+R) after frontend
  edits.
- The Vite dev server proxies `/api` and `/ws` to `localhost:4001`
  (the backend).
- We use the WebGL renderer for xterm.js (`@xterm/addon-webgl`) so
  the cursor stays pixel-aligned in nvim/vim/etc. Falls back to DOM
  silently if WebGL is unavailable.
- All styles live in `src/index.css`. There's no `App.css` or
  CSS-in-JS layer.

See [`docs/architecture.md`](../docs/architecture.md) and
[`docs/decisions.md`](../docs/decisions.md) for the why-it's-this-way
details.
