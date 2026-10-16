// Real-server e2e for claude pane→session correlation: the actual server.js
// against a fixture $HOME and a fake herdr daemon, with real child processes
// standing in for the panes' claude pids (/proc reads are live). Reproduces
// the session bleed seen in the web UI: two title-less claude panes in one
// cwd both resolved to whichever jsonl was written last, so a prompt in pane
// A made pane B's stream reset onto A's transcript.
//   cwd1: panes A, B — bound exactly via ~/.claude/sessions/<pid>.json
//   cwd2: panes C (older process), D (younger) — no registry (older claude),
//         allocated jointly: youngest first, newest unclaimed file each
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
const PORT = 17883 + (process.pid % 100);
const BASE = `http://127.0.0.1:${PORT}`;

let home;
let cwd1;
let cwd2;
const procs = {}; // pane -> child process
let daemon;
let server;

const slug = (cwd) => cwd.replace(/[/.]/g, '-');
const projDir = (cwd) => path.join(home, '.claude', 'projects', slug(cwd));
const sessFile = (cwd, id) => path.join(projDir(cwd), `${id}.jsonl`);
const line = (obj) => `${JSON.stringify(obj)}\n`;
const userLine = (text) => line({ type: 'user', message: { role: 'user', content: text }, timestamp: new Date().toISOString() });
const replyLine = (text) => line({
  type: 'assistant',
  message: { role: 'assistant', content: [{ type: 'text', text }] },
  timestamp: new Date().toISOString(),
});

async function mkSession(cwd, id, text, { mtime } = {}) {
  await fsp.mkdir(projDir(cwd), { recursive: true });
  const p = sessFile(cwd, id);
  await fsp.writeFile(p, userLine(text) + replyLine(`re: ${text}`));
  if (mtime) await fsp.utimes(p, new Date(mtime), new Date(mtime));
  return p;
}

async function procStart(pid) {
  const stat = await fsp.readFile(`/proc/${pid}/stat`, 'utf8');
  return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19];
}

async function mkRegistry(pid, sessionId, cwd) {
  const dir = path.join(home, '.claude', 'sessions');
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, `${pid}.json`), JSON.stringify({
    pid, sessionId, cwd, startedAt: Date.now(), procStart: await procStart(pid), version: '2.1.292',
  }));
}

// ---------- fake herdr daemon (ndjson over unix socket, 1 req/conn) ----------

const pane = (paneId, cwd) => ({
  pane_id: paneId,
  workspace_id: 'w1',
  tab_id: 't1',
  agent: 'claude',
  agent_status: 'idle',
  cwd,
  terminal_title_stripped: '', // no ai-title yet — the bleed case
  revision: 1,
});

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
              agents: [pane('w1:pA', cwd1), pane('w1:pB', cwd1), pane('w1:pC', cwd2), pane('w1:pD', cwd2)],
              workspaces: [{ workspace_id: 'w1', number: 1, label: 'w1' }],
              tabs: [{ tab_id: 't1', workspace_id: 'w1', number: 1, label: 't1', pane_count: 4 }],
            },
          });
          break;
        case 'pane.process_info': {
          const pid = procs[msg.params.pane_id]?.pid;
          reply({ process_info: { foreground_processes: pid ? [{ name: 'claude', pid }] : [] } });
          break;
        }
        case 'agent.read':
          reply({ read: { text: 'idle screen\n' } });
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

const api = async (p) => {
  const r = await fetch(`${BASE}/api/${p}`);
  assert.equal(r.status, 200, `GET /api/${p}`);
  return r.json();
};
const transcriptId = async (paneId) => (await api(`agent/${encodeURIComponent(paneId)}/transcript`)).sessionId;

/** Resolve with the first SSE frame matching pred, reject on timeout. */
function sseWait(p, pred, { timeoutMs = 8000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get(`${BASE}/api/${p}`, (res) => {
      let buf = '';
      const timer = setTimeout(() => {
        req.destroy();
        reject(new Error(`sse timeout; got: ${buf.slice(0, 400)}`));
      }, timeoutMs);
      res.on('data', (d) => {
        buf += d;
        let sep;
        while ((sep = buf.indexOf('\n\n')) !== -1) {
          const frame = buf.slice(0, sep);
          buf = buf.slice(sep + 2);
          const event = /^event: (.*)$/m.exec(frame)?.[1];
          const data = /^data: (.*)$/m.exec(frame)?.[1];
          const parsed = { event, data: data ? JSON.parse(data) : null };
          if (pred(parsed)) {
            clearTimeout(timer);
            req.destroy();
            resolve(parsed);
            return;
          }
        }
      });
    });
    req.on('error', reject);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- boot / teardown ----------

test.before(async () => {
  home = await fsp.mkdtemp(path.join(os.tmpdir(), 'herdr-claude-e2e-home-'));
  cwd1 = await fsp.mkdtemp(path.join(os.tmpdir(), 'herdr-claude-e2e-cwd1-'));
  cwd2 = await fsp.mkdtemp(path.join(os.tmpdir(), 'herdr-claude-e2e-cwd2-'));

  procs['w1:pA'] = spawn('sleep', ['600']);
  procs['w1:pB'] = spawn('sleep', ['600']);
  procs['w1:pC'] = spawn('sleep', ['600']);
  await sleep(200); // D is unambiguously the younger process (/proc starttime is 10ms ticks)
  procs['w1:pD'] = spawn('sleep', ['600']);

  const now = Date.now();
  // cwd1: both registered. sess-b is the newest file — the old ladder would
  // have handed it to A as well.
  await mkSession(cwd1, 'sess-a', 'hello from pane A', { mtime: now - 60_000 });
  await mkSession(cwd1, 'sess-b', 'hello from pane B', { mtime: now });
  await mkRegistry(procs['w1:pA'].pid, 'sess-a', cwd1);
  await mkRegistry(procs['w1:pB'].pid, 'sess-b', cwd1);
  // cwd2: no registry. Both files were created after both processes
  // started, so each pane's created-since window holds both.
  await mkSession(cwd2, 'sess-c', 'hello from pane C', { mtime: now - 60_000 });
  await mkSession(cwd2, 'sess-d', 'hello from pane D', { mtime: now });

  const sock = path.join(home, 'herdr.sock');
  daemon = await startDaemon(sock);

  server = spawn(process.execPath, ['server.js', '--port', String(PORT), '--host', '127.0.0.1'], {
    cwd: ROOT,
    env: { ...process.env, HOME: home, HERDR_SOCK: sock, HERDR_WEB_TOKEN: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let bootLog = '';
  server.stdout.on('data', (d) => { bootLog += d; });
  server.stderr.on('data', (d) => { bootLog += d; });

  const deadline = Date.now() + 15_000;
  for (;;) {
    try {
      const r = await fetch(`${BASE}/api/roster`);
      if (r.ok && (await r.json()).agents?.length === 4) break;
    } catch {}
    if (Date.now() > deadline) throw new Error(`server never came up:\n${bootLog}`);
    await sleep(200);
  }
});

test.after(async () => {
  server?.kill();
  daemon?.close();
  for (const p of Object.values(procs)) p?.kill();
  for (const d of [home, cwd1, cwd2]) {
    if (d) await fsp.rm(d, { recursive: true, force: true });
  }
});

// ---------- the tests ----------

test('claude e2e: registry binds each pane to its own session, newest-mtime be damned', async () => {
  assert.equal(await transcriptId('w1:pA'), 'sess-a');
  assert.equal(await transcriptId('w1:pB'), 'sess-b');
});

test('claude e2e: a prompt landing in pane A leaves pane B where it was', async () => {
  await fsp.appendFile(sessFile(cwd1, 'sess-a'), userLine('second prompt in A') + replyLine('A again'));
  assert.equal(await transcriptId('w1:pB'), 'sess-b');
  assert.equal(await transcriptId('w1:pA'), 'sess-a');
});

test('claude e2e: pane B\'s stream never resets onto A\'s transcript', async () => {
  const { size } = await fsp.stat(sessFile(cwd1, 'sess-b'));
  // the stream re-resolves its binding every 5th tick (~3.5s); keep A the
  // freshest file the whole time and expect silence from B
  const poke = setInterval(() => fsp.appendFile(sessFile(cwd1, 'sess-a'), userLine('A keeps typing')).catch(() => {}), 500);
  try {
    await assert.rejects(
      sseWait(`agent/${encodeURIComponent('w1:pB')}/stream?offset=${size}`, (f) => f.event === 'reset', { timeoutMs: 5500 }),
      /sse timeout/,
      'B must not receive a reset while A is the newest file',
    );
  } finally {
    clearInterval(poke);
  }
});

test('claude e2e: without the registry, siblings split the files youngest-first', async () => {
  // D (younger) takes the newest file; C (older) gets the next unclaimed one
  // instead of also landing on sess-d
  assert.equal(await transcriptId('w1:pD'), 'sess-d');
  assert.equal(await transcriptId('w1:pC'), 'sess-c');
});

test('claude e2e: a prompt in the younger pane does not steal the older one', async () => {
  await fsp.appendFile(sessFile(cwd2, 'sess-d'), userLine('second prompt in D') + replyLine('D again'));
  assert.equal(await transcriptId('w1:pC'), 'sess-c');
  assert.equal(await transcriptId('w1:pD'), 'sess-d');
});

test('claude e2e: roster carries the same bindings as the transcript route', async () => {
  const roster = await api('roster');
  const byPane = Object.fromEntries(roster.agents.map((a) => [a.paneId, a.sessionId]));
  assert.deepEqual(byPane, { 'w1:pA': 'sess-a', 'w1:pB': 'sess-b', 'w1:pC': 'sess-c', 'w1:pD': 'sess-d' });
});
