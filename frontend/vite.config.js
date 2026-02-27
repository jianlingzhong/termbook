import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 4000,
    host: '0.0.0.0',
    hmr: false, // Disable HMR to prevent reloads during tests
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
      ignored: ['**/screenshots/**', '**/test-results/**', '**/backend-*.log', '**/frontend-*.log', '**/audit_*.txt', '**/*.tmp', '**/node_modules/**']
    }
  }
})
