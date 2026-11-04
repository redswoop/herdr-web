import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// The transcript page as ONE html file (scripts, css and fonts inlined), which
// Capra ships as an asset and hosts in a WebView. `npm run build:tx` at the
// root. Dev iteration doesn't use this: /webview.html on the normal dev server
// serves the same entry with the harness panel.
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  publicDir: false,
  build: {
    outDir: '../mobile/assets/tx',
    emptyOutDir: true,
    rollupOptions: { input: 'webview.html' },
    assetsInlineLimit: Number.MAX_SAFE_INTEGER, // fonts become data: URIs
    cssCodeSplit: false,
    target: ['safari16', 'chrome110'],
  },
  optimizeDeps: { exclude: ['@herdr/shared', '@redswoop/cyberdos'] },
  server: { fs: { allow: ['..'] } },
});
