import { defineConfig } from 'vite';

/**
 * Dev: Vite serves the UI on :5173 and proxies the Colyseus HTTP + WebSocket
 * routes to the game server on :2567, so the client always talks to the same
 * origin (identical to production, where the Node server serves the bundle).
 */
const SERVER = process.env.SERVER_URL ?? 'http://localhost:2567';

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: SERVER, changeOrigin: true },
      '/healthz': { target: SERVER, changeOrigin: true },
      '/matchmake': { target: SERVER, changeOrigin: true, ws: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    target: 'es2020',
  },
});
