// Token-mode auth boundary, against the real server.js. The no-token mode
// (HERDR_WEB_TOKEN='') is exercised by server-e2e.test.mjs — this file covers
// the enforced mode: /api 401s without credentials, ?token= enrolls the
// HttpOnly cookie, the cookie alone then works, and the shell stays open so
// the client-side TokenGate can render.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 17883 + (process.pid % 100);
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = 's3cret-tok';

let home;
let daemon;
let server;

// minimal fake herdr: empty snapshot is enough for auth tests
function startDaemon(sock) {
  const srv = net.createServer((conn) => {
    let buf = '';
    conn.on('data', (d) => {
      buf += d;
      const nl = buf.indexOf('\n');
      if (nl === -1) return;
      let msg;
      try { msg = JSON.parse(buf.slice(0, nl)); } catch { conn.destroy(); return; }
      if (msg.method === 'events.subscribe') {
        conn.write(`${JSON.stringify({ id: msg.id, result: { ok: true } })}\n`);
        return; // hold open
      }
      conn.write(`${JSON.stringify({
        id: msg.id,
        result: msg.method === 'session.snapshot'
          ? { snapshot: { agents: [], workspaces: [], tabs: [] } }
          : {},
      })}\n`);
      conn.end();
    });
  });
  return new Promise((res) => srv.listen(sock, () => res(srv)));
}

test.before(async () => {
  home = await fsp.mkdtemp(path.join(os.tmpdir(), 'herdr-auth-home-'));
  const sock = path.join(home, 'herdr.sock');
  daemon = await startDaemon(sock);
  server = spawn(process.execPath, ['server.js', '--port', String(PORT), '--host', '127.0.0.1'], {
    cwd: ROOT,
    env: { ...process.env, HOME: home, HERDR_SOCK: sock, HERDR_WEB_TOKEN: TOKEN },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let bootLog = '';
  server.stdout.on('data', (d) => { bootLog += d; });
  server.stderr.on('data', (d) => { bootLog += d; });
  const deadline = Date.now() + 15_000;
  for (;;) {
    try {
      // the shell is served without auth — readiness probe that never 401s
      const r = await fetch(`${BASE}/`);
      if (r.status < 500) break;
    } catch {}
    if (Date.now() > deadline) throw new Error(`server never came up:\n${bootLog}`);
    await new Promise((r) => setTimeout(r, 200));
  }
});

test.after(async () => {
  server?.kill();
  daemon?.close();
  if (home) await fsp.rm(home, { recursive: true, force: true });
});

test('auth: /api 401s without a token', async () => {
  const r = await fetch(`${BASE}/api/roster`);
  assert.equal(r.status, 401);
});

test('auth: /api 401s with a WRONG token', async () => {
  const r = await fetch(`${BASE}/api/roster?token=nope`);
  assert.equal(r.status, 401);
  assert.equal(r.headers.get('set-cookie'), null, 'a bad token must never enroll a cookie');
});

test('auth: ?token= grants access and enrolls the HttpOnly cookie', async () => {
  const r = await fetch(`${BASE}/api/roster?token=${TOKEN}`);
  assert.equal(r.status, 200);
  const cookie = r.headers.get('set-cookie') ?? '';
  assert.match(cookie, /hw_token=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);

  // the cookie alone now works
  const r2 = await fetch(`${BASE}/api/roster`, {
    headers: { cookie: cookie.split(';')[0] },
  });
  assert.equal(r2.status, 200);
  const body = await r2.json();
  assert.ok(Array.isArray(body.agents));
});

test('auth: the static shell serves WITHOUT auth so TokenGate can render', async () => {
  const r = await fetch(`${BASE}/`);
  assert.notEqual(r.status, 401, 'a cookie-less phone must be able to load the shell');
});

test('auth: ?token= on a shell URL enrolls the cookie (the shared-link flow)', async () => {
  const r = await fetch(`${BASE}/?token=${TOKEN}`, { redirect: 'manual' });
  assert.match(r.headers.get('set-cookie') ?? '', /hw_token=/);
});

test('auth: POST endpoints are gated too', async () => {
  const r = await fetch(`${BASE}/api/agent/${encodeURIComponent('w1:p1')}/prompt`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'hi' }),
  });
  assert.equal(r.status, 401);
});
