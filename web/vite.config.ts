import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Builds into ../public, which server.js serves from disk per-request.
// Dev: `npm run dev` proxies /api to the live daemon — real agents, HMR UI.
export default defineConfig({
  plugins: [react()],
  publicDir: 'static',
  build: { outDir: '../public', emptyOutDir: true },
  optimizeDeps: { exclude: ['@herdr/shared'] },
  server: {
    port: 5174,
    // dev is reached by LAN/tailnet hostname, not localhost
    allowedHosts: ['stormer', '.ts.net'],
    fs: { allow: ['..'] },
    proxy: { '/api': 'http://localhost:7683' },
  },
});
