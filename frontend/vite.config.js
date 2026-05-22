import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 4000,
    // Bind to loopback ONLY. The frontend dev server proxies /api and
    // /ws to the backend on :4001 (which is also loopback-only by
    // default; see backend/server.js). Binding to 0.0.0.0 would let a
    // network attacker reach the React app, which then opens
    // ws://<attacker-reachable-host>:4000/ws — Vite proxies that to
    // the backend's loopback :4001, and the backend hands out a shell.
    // To intentionally expose Termbook, run it behind a reverse proxy
    // with auth.
    host: '127.0.0.1',
    hmr: false, // Disable HMR — xterm.js state survives swaps and corrupts.
    proxy: {
      '/api': {
        target: 'http://localhost:4001',
        changeOrigin: true
      },
      '/ws': {
        target: 'ws://localhost:4001',
        ws: true
      }
    },
    watch: {
      ignored: ['**/test-results/**', '**/node_modules/**']
    }
  }
})
