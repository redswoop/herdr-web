#!/usr/bin/env node
/**
 * Single-origin dev proxy for the react-native-web audition.
 *
 * Metro serves the Expo app on one port and the herdr daemon serves the API on
 * another, so a browser pointed at Metro makes every /api call cross-origin —
 * and the daemon sends no CORS headers (by design: it's a same-origin PWA
 * backend). Safari reports that as a bare "Load failed".
 *
 * This fronts both on one origin so the app can run with baseUrl='' and every
 * request is same-origin. No daemon changes, no CORS, no root (tailscale serve
 * needs sudo to add a port).
 *
 *   node tools/dev-origin.mjs [--port 8083] [--api 7683] [--app 8082]
 *
 * Streaming is piped, never buffered — the transcript SSE stream depends on it.
 */
import http from 'node:http';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? dflt : Number(process.argv[i + 1]);
};

const PORT = arg('port', 8083);
const API = arg('api', 7683);
const APP = arg('app', 8082);

const server = http.createServer((req, res) => {
  const toApi = req.url === '/api' || req.url.startsWith('/api/') || req.url.startsWith('/api?');
  const port = toApi ? API : APP;

  const headers = { ...req.headers, host: `127.0.0.1:${port}` };
  delete headers['accept-encoding']; // no transform on a stream we just pipe

  const up = http.request({ host: '127.0.0.1', port, path: req.url, method: req.method, headers });

  up.on('response', (r) => {
    res.writeHead(r.statusCode ?? 502, r.headers);
    if (typeof res.flushHeaders === 'function') res.flushHeaders(); // SSE: first byte now
    r.pipe(res);
  });
  up.on('error', (e) => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: `dev-origin: ${port} unreachable — ${e.message}` }));
  });

  req.pipe(up);
  res.on('close', () => up.destroy());
});

// SSE and long-poll connections must not be cut by the default 2min timeout
server.timeout = 0;
server.headersTimeout = 0;
server.requestTimeout = 0;

server.listen(PORT, '0.0.0.0', () => {
  console.log(`dev-origin on http://0.0.0.0:${PORT}  →  /api ⇒ :${API}, /* ⇒ :${APP}`);
});
