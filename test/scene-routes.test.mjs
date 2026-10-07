// Real-server tests for the scene routes: boots server.js against a fake
// herdr daemon and a fixture $HOME, drives /api/scene over HTTP and SSE,
// and restarts the daemon to prove card lists persist.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 17783 + (process.pid % 100);
const BASE = `http://127.0.0.1:${PORT}`;
const PANE = 'w1:p1';
const CWD = '/work/proj';
const SCOPE = enc('pane:w1:p1');

function enc(s) {
  return encodeURIComponent(s);
}

let home;
let stateDir;
let daemon;
let server;

// ---------- fake herdr (ndjson over unix socket, one request per connection) ----------
function startDaemon(sock) {
  const srv = net.createServer((conn) => {
    let buf = '';
    conn.on('data', (d) => {
      buf += d;
      const nl = buf.indexOf('\n');
      if (nl === -1) return;
      let msg;
      try { msg = JSON.parse(buf.slice(0, nl)); } catch { conn.destroy(); return; }
      const reply = (result) => conn.write(`${JSON.stringify({ id: msg.id, result })}\n`);
      switch (msg.method) {
        case 'session.snapshot':
          reply({
            snapshot: {
              agents: [{ pane_id: PANE, workspace_id: 'w1', tab_id: 't1', agent: 'claude', agent_status: 'idle', cwd: CWD, terminal_title_stripped: 'claude', revision: 1 }],
              workspaces: [{ workspace_id: 'w1', number: 1, label: 'w1' }],
              tabs: [{ tab_id: 't1', workspace_id: 'w1', number: 1, label: 't1', pane_count: 1 }],
            },
          });
          break;
        case 'pane.process_info':
          reply({ process_info: { foreground_processes: [] } }); // no pid → finder uses the launch cwd
          break;
        case 'agent.read':
          reply({ read: { text: 'idle\n' } });
          break;
        case 'events.subscribe':
          conn.write(`${JSON.stringify({ id: msg.id, result: { ok: true } })}\n`);
          return;
        default:
          conn.write(`${JSON.stringify({ id: msg.id, error: { code: 'no_method', message: msg.method } })}\n`);
      }
      conn.end();
    });
  });
  return new Promise((res) => srv.listen(sock, () => res(srv)));
}

// ---------- http helpers ----------
async function get(p, expect = 200) {
  const r = await fetch(`${BASE}${p}`);
  const j = await r.json();
  assert.equal(r.status, expect, `GET ${p} → ${JSON.stringify(j).slice(0, 200)}`);
  return j;
}
async function post(p, body, expect = 200) {
  const r = await fetch(`${BASE}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  assert.equal(r.status, expect, `POST ${p} → ${JSON.stringify(j).slice(0, 200)}`);
  return j;
}

/** Open an SSE stream; resolve with collected frames once pred(frames) holds. */
function sseCollect(p, pred, { timeoutMs = 8000, after } = {}) {
  return new Promise((resolve, reject) => {
    const frames = [];
    const req = http.get(`${BASE}${p}`, (res) => {
      let buf = '';
      const timer = setTimeout(() => {
        req.destroy();
        reject(new Error(`sse timeout; frames: ${JSON.stringify(frames).slice(0, 500)}`));
      }, timeoutMs);
      let kicked = false;
      res.on('data', (d) => {
        buf += d;
        let sep;
        while ((sep = buf.indexOf('\n\n')) !== -1) {
          const frame = buf.slice(0, sep);
          buf = buf.slice(sep + 2);
          const event = /^event: (.*)$/m.exec(frame)?.[1];
          if (!event) continue; // retry: preamble
          const data = /^data: (.*)$/m.exec(frame)?.[1];
          let parsed = data;
          try { parsed = JSON.parse(data); } catch {}
          frames.push({ event, data: parsed });
          if (pred(frames)) {
            clearTimeout(timer);
            req.destroy();
            resolve(frames);
            return;
          }
        }
        // once the first frame is in, fire the side effect the test waits on
        if (!kicked && after && frames.length) {
          kicked = true;
          after().catch(reject);
        }
      });
    });
    req.on('error', reject);
  });
}

async function bootServer() {
  server = spawn(process.execPath, ['server.js', '--port', String(PORT), '--host', '127.0.0.1'], {
    cwd: ROOT,
    env: { ...process.env, HOME: home, HERDR_SOCK: path.join(home, 'herdr.sock'), HERDR_WEB_STATE: stateDir, HERDR_WEB_TOKEN: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let err = '';
  server.stderr.on('data', (d) => { err += d; });
  for (let i = 0; i < 60; i += 1) {
    try {
      const r = await fetch(`${BASE}/api/roster`);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`server did not come up: ${err}`);
}

test.before(async () => {
  home = await fsp.mkdtemp(path.join(os.tmpdir(), 'herdr-scene-home-'));
  stateDir = path.join(home, 'state');
  // a claude session file for the pane so the transcript stream has something to read
  const proj = path.join(home, '.claude', 'projects', CWD.replace(/[/.]/g, '-'));
  await fsp.mkdir(proj, { recursive: true });
  const line = (o) => `${JSON.stringify(o)}\n`;
  await fsp.writeFile(
    path.join(proj, 'sess-1.jsonl'),
    line({ type: 'user', message: { role: 'user', content: 'hello there' }, timestamp: '2026-10-06T00:00:00Z' })
      + line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'hi back' }] }, timestamp: '2026-10-06T00:00:01Z' }),
  );
  daemon = await startDaemon(path.join(home, 'herdr.sock'));
  await bootServer();
});

test.after(async () => {
  server?.kill();
  daemon?.close();
  if (home) await fsp.rm(home, { recursive: true, force: true });
});

test('catalog lists the plugins with their actions', async () => {
  const { plugins } = await get('/api/scene-plugins');
  const names = plugins.map((p) => p.name).sort();
  assert.deepEqual(names, ['command-watch', 'service-control', 'summary']);
  const svc = plugins.find((p) => p.name === 'service-control');
  assert.deepEqual(Object.keys(svc.actions), ['restart', 'stop', 'start']);
  assert.equal(svc.live, true);
  assert.equal(plugins.find((p) => p.name === 'summary').live, false);
});

test('scope must be kind:id', async () => {
  const j = await get('/api/scene/nonsense', 400);
  assert.match(j.error, /scope/);
});

test('ops: mount, validation errors, unknown ids', async () => {
  const snap = await post(`/api/scene/${SCOPE}/ops`, {
    ops: [{ op: 'mount', plugin: 'summary', id: 'state', title: 'State', props: { body: '**hi**' } }],
  });
  assert.equal(snap.rev, 1);
  assert.equal(snap.cards[0].id, 'state');
  // a bare op object and a bare array are accepted too
  const s2 = await post(`/api/scene/${SCOPE}/ops`, { op: 'update', id: 'state', title: 'State 2' });
  assert.equal(s2.cards[0].title, 'State 2');
  const s3 = await post(`/api/scene/${SCOPE}/ops`, [{ op: 'move', id: 'state', to: 0 }]);
  assert.equal(s3.rev, 3);

  let j = await post(`/api/scene/${SCOPE}/ops`, { ops: [{ op: 'mount', plugin: 'nope' }] }, 400);
  assert.match(j.error, /unknown plugin/);
  j = await post(`/api/scene/${SCOPE}/ops`, { ops: [{ op: 'unmount', id: 'ghost' }] }, 404);
  assert.match(j.error, /no card/);
  j = await post(`/api/scene/${SCOPE}/ops`, { ops: [{ op: 'mount', plugin: 'summary', props: {} }] }, 400);
  assert.match(j.error, /body required/);
  j = await post(`/api/scene/${SCOPE}/ops`, { nothing: true }, 400);
  assert.match(j.error, /ops/);
  // a batch with one bad op lands nothing
  await post(`/api/scene/${SCOPE}/ops`, { ops: [{ op: 'mount', plugin: 'summary', id: 'x', props: { body: 'x' } }, { op: 'dance' }] }, 400);
  const after = await get(`/api/scene/${SCOPE}`);
  assert.equal(after.cards.length, 1);
  assert.equal(after.rev, 3);
});

test('stream: snapshot on connect, scene frame per rev, data frame from a live source', async () => {
  const frames = await sseCollect(
    `/api/scene/${SCOPE}/stream`,
    (fs) => fs.some((f) => f.event === 'data' && f.data?.data?.value === 42),
    {
      after: () => post(`/api/scene/${SCOPE}/ops`, {
        ops: [{ op: 'mount', plugin: 'command-watch', id: 'n', props: { cmd: 'echo 42', render: 'gauge', interval: 60000 } }],
      }),
    },
  );
  assert.equal(frames[0].event, 'scene');
  assert.equal(frames[0].data.scope, 'pane:w1:p1');
  const sceneFrames = frames.filter((f) => f.event === 'scene');
  assert.ok(sceneFrames.length >= 2, 'a scene frame followed the mount');
  assert.equal(sceneFrames.at(-1).data.rev, 4);
  const data = frames.find((f) => f.event === 'data');
  assert.equal(data.data.id, 'n');
  assert.equal(data.data.data.ok, true);
  // late joiners get the last data in the snapshot
  const snap = await get(`/api/scene/${SCOPE}`);
  assert.equal(snap.cards.find((c) => c.id === 'n').data.value, 42);
});

test('card actions: only plugins that declare them, only cards that exist', async () => {
  let j = await post(`/api/scene/${SCOPE}/cards/state/action`, { action: 'restart' }, 400);
  assert.match(j.error, /no action/);
  j = await post(`/api/scene/${SCOPE}/cards/ghost/action`, { action: 'restart' }, 404);
  assert.match(j.error, /no card/);
  j = await post(`/api/scene/${SCOPE}/cards/state/action`, {}, 400);
  assert.match(j.error, /action/);
});

test('service-control: unit names are validated at the route', async () => {
  const j = await post(`/api/scene/${SCOPE}/ops`, {
    ops: [{ op: 'mount', plugin: 'service-control', id: 's', props: { unit: 'x; rm -rf /' } }],
  }, 400);
  assert.match(j.error, /unit must match/);
});

test('scenes index lists only non-empty scopes', async () => {
  await post(`/api/scene/${enc('pane:other')}/ops`, { ops: [{ op: 'mount', plugin: 'summary', id: 'a', props: { body: 'a' } }] });
  await post(`/api/scene/${enc('pane:other')}/ops`, { ops: [{ op: 'clear' }] });
  const { scenes } = await get('/api/scene');
  assert.deepEqual(scenes.map((s) => s.scope), ['pane:w1:p1']);
  assert.equal(scenes[0].cards, 2);
});

test('agent stream emits an offset frame after events', async () => {
  const frames = await sseCollect(
    `/api/agent/${enc(PANE)}/stream?offset=0`,
    (fs) => fs.some((f) => f.event === 'offset'),
  );
  const i = frames.findIndex((f) => f.event === 'events');
  assert.ok(i !== -1, 'events frame arrived');
  assert.equal(frames[i].data[0].kind, 'user');
  assert.equal(frames[i + 1].event, 'offset');
  assert.ok(Number(frames[i + 1].data) > 0, 'offset is a byte position');
});

test('persistence: card lists survive a daemon restart, data refills', async () => {
  await new Promise((r) => setTimeout(r, 600)); // debounced save
  const saved = JSON.parse(await fsp.readFile(path.join(stateDir, 'scenes.json'), 'utf8'));
  assert.deepEqual(Object.keys(saved.scenes), ['pane:w1:p1']);
  assert.equal(saved.scenes['pane:w1:p1'].cards.length, 2);
  assert.equal('data' in saved.scenes['pane:w1:p1'].cards[1], false);

  server.kill();
  await new Promise((r) => server.once('exit', r));
  await bootServer();
  const snap = await get(`/api/scene/${SCOPE}`);
  assert.deepEqual(snap.cards.map((c) => c.id), ['state', 'n']);
  assert.equal(snap.rev, 4);
  // the command-watch source restarted and polled again
  for (let i = 0; i < 30 && snap.cards[1].data == null; i += 1) {
    await new Promise((r) => setTimeout(r, 100));
    Object.assign(snap, await get(`/api/scene/${SCOPE}`));
  }
  assert.equal(snap.cards[1].data?.value, 42);
});
