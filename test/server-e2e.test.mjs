// Real-server e2e for the pane→session correlation layer: boots the actual
// server.js against a fixture $HOME and a fake herdr daemon, with real child
// processes standing in for the panes' grok pids (pidAlive and /proc reads
// are live). Reproduces the active_sessions.json clobber that blanked grok
// panes in the clients: grok rewrites that file wholesale on every launch,
// so a concurrent session's entry vanishes while its process lives on.
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
const PORT = 17683 + (process.pid % 100); // parallel-run friendly
const BASE = `http://127.0.0.1:${PORT}`;

// ---------- fixture home ----------

let home;
let cwdA;
let cwdB;
let cwdC;
let grokA; // pane A's "grok" process — alive, but clobbered out of the registry
let grokB; // pane B's "grok" process — the last writer, still registered
let grokC; // pane C's process — cwd has only a stale session from yesterday
let daemon;
let server;

const enc = (p) => encodeURIComponent(p);
const iso = (ms) => new Date(ms).toISOString();

const updLine = (sessionId, update, { method = 'session/update', ms = Date.now() } = {}) =>
  `${JSON.stringify({
    timestamp: Math.floor(ms / 1000),
    method,
    params: { sessionId, update, _meta: { agentTimestampMs: ms } },
  })}\n`;

const chunk = (kind, text) => ({
  sessionUpdate: kind,
  content: { type: 'text', text },
});

async function mkGrokSession(cwd, sessionId, { createdAt, lines = [] }) {
  const dir = path.join(home, '.grok', 'sessions', enc(cwd), sessionId);
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(
    path.join(dir, 'summary.json'),
    JSON.stringify({ info: { id: sessionId, cwd }, created_at: iso(createdAt) }),
  );
  await fsp.writeFile(path.join(dir, 'updates.jsonl'), lines.join(''));
  return dir;
}

// ---------- fake herdr daemon (ndjson over unix socket, 1 req/conn) ----------

const pane = (paneId, cwd) => ({
  pane_id: paneId,
  workspace_id: 'w1',
  tab_id: 't1',
  agent: 'grok',
  agent_status: 'idle',
  cwd,
  terminal_title_stripped: 'grok',
  revision: 1,
});

const prompts = []; // agent.prompt params recorded by the fake daemon

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
              agents: [pane('w1:pA', cwdA), pane('w1:pB', cwdB), pane('w1:pC', cwdC)],
              workspaces: [{ workspace_id: 'w1', number: 1, label: 'w1' }],
              tabs: [{ tab_id: 't1', workspace_id: 'w1', number: 1, label: 't1', pane_count: 3 }],
            },
          });
          break;
        case 'pane.process_info': {
          const pid = { 'w1:pA': grokA.pid, 'w1:pB': grokB.pid, 'w1:pC': grokC.pid }[msg.params.pane_id];
          reply({ process_info: { foreground_processes: pid ? [{ name: 'grok', pid }] : [] } });
          break;
        }
        case 'agent.read':
          reply({ read: { text: 'idle screen\n' } });
          break;
        case 'agent.prompt':
          prompts.push(msg.params);
          reply({ ok: true });
          break;
        case 'events.subscribe':
          conn.write(`${JSON.stringify({ id: msg.id, result: { ok: true } })}\n`);
          return; // hold the stream open — closing reads as herdr-down
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

/** Collect SSE frames from an agent stream until pred(frame) or timeout. */
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

// ---------- boot / teardown ----------

test.before(async () => {
  home = await fsp.mkdtemp(path.join(os.tmpdir(), 'herdr-e2e-home-'));
  cwdA = await fsp.mkdtemp(path.join(os.tmpdir(), 'herdr-e2e-cwdA-'));
  cwdB = await fsp.mkdtemp(path.join(os.tmpdir(), 'herdr-e2e-cwdB-'));
  cwdC = await fsp.mkdtemp(path.join(os.tmpdir(), 'herdr-e2e-cwdC-'));

  grokA = spawn('sleep', ['600']);
  grokB = spawn('sleep', ['600']);
  grokC = spawn('sleep', ['600']);

  const now = Date.now();
  await mkGrokSession(cwdA, 'sess-a', {
    createdAt: now - 30_000, // near pane A's process start
    lines: [
      updLine('sess-a', chunk('user_message_chunk', 'hello from pane A')),
      updLine('sess-a', chunk('agent_message_chunk', 'A reply **bold**')),
      updLine('sess-a', {
        sessionUpdate: 'turn_completed',
        usage: { inputTokens: 100, outputTokens: 7 },
      }, { method: '_x.ai/session/update' }),
    ],
  });
  // decoy in the same cwd: created long before pane A's process — must lose
  await mkGrokSession(cwdA, 'sess-a-old', {
    createdAt: now - 86_400_000,
    lines: [updLine('sess-a-old', chunk('user_message_chunk', 'yesterday'))],
  });
  await mkGrokSession(cwdB, 'sess-b', {
    createdAt: now - 20_000,
    lines: [updLine('sess-b', chunk('user_message_chunk', 'hello from pane B'))],
  });
  // pane C's cwd holds ONLY a stale session — nothing near its start
  await mkGrokSession(cwdC, 'sess-c-old', {
    createdAt: now - 86_400_000,
    lines: [updLine('sess-c-old', chunk('user_message_chunk', 'ancient history'))],
  });

  // THE CLOBBER: grok B launched last and rewrote the registry with only
  // itself; grok A is alive but unregistered.
  await fsp.mkdir(path.join(home, '.grok'), { recursive: true });
  await fsp.writeFile(
    path.join(home, '.grok', 'active_sessions.json'),
    JSON.stringify([
      { session_id: 'sess-b', pid: grokB.pid, cwd: cwdB, opened_at: iso(now - 20_000) },
    ]),
  );

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
      if (r.ok) break;
    } catch {}
    if (Date.now() > deadline) throw new Error(`server never came up:\n${bootLog}`);
    await new Promise((r) => setTimeout(r, 200));
  }
});

test.after(async () => {
  server?.kill();
  daemon?.close();
  for (const p of [grokA, grokB, grokC]) p?.kill();
  for (const d of [home, cwdA, cwdB, cwdC]) {
    if (d) await fsp.rm(d, { recursive: true, force: true });
  }
});

// ---------- the tests ----------

test('e2e: registered pane binds via active_sessions pid match', async () => {
  const t = await api(`agent/${enc('w1:pB')}/transcript`);
  assert.equal(t.sessionId, 'sess-b');
  assert.ok(t.file.endsWith(path.join('sess-b', 'updates.jsonl')));
  assert.deepEqual(t.events.map((e) => [e.kind, e.text]), [['user', 'hello from pane B']]);
});

test('e2e: clobbered-out-of-registry pane still binds by filesystem scan', async () => {
  const t = await api(`agent/${enc('w1:pA')}/transcript`);
  assert.equal(t.sessionId, 'sess-a', 'must bind the session created near process start, not the decoy');
  const kinds = t.events.map((e) => e.kind);
  assert.deepEqual(kinds, ['user', 'assistant', 'usage']);
  assert.equal(t.events[1].text, 'A reply **bold**');
});

test('e2e: a stale session never binds a fresh pane', async () => {
  const t = await api(`agent/${enc('w1:pC')}/transcript`);
  assert.equal(t.sessionId, null, 'yesterday’s session must not masquerade as this pane');
  assert.deepEqual(t.events, []);
});

test('e2e: roster reflects the healed bindings', async () => {
  const r = await api('roster');
  const by = new Map(r.agents.map((a) => [a.paneId, a]));
  assert.equal(by.get('w1:pA')?.sessionId, 'sess-a');
  assert.equal(by.get('w1:pB')?.sessionId, 'sess-b');
  assert.equal(by.get('w1:pA')?.hasTranscript, true);
  assert.equal(by.get('w1:pC')?.hasTranscript, false);
});

test('e2e: multi-byte UTF-8 survives a request-body chunk boundary', async () => {
  // Regression: readBody used to toString() per chunk, turning a UTF-8
  // sequence split across TCP chunks into U+FFFDs that JSON.parse accepts.
  const text = `wide 🐐 chars é ünd ok `.repeat(4000); // ~100KB encoded
  const body = Buffer.from(JSON.stringify({ text }));
  let split = Math.floor(body.length / 2);
  while ((body[split] & 0xc0) !== 0x80) split += 1; // land on a continuation byte
  const status = await new Promise((resolve, reject) => {
    const req = http.request(`${BASE}/api/agent/${enc('w1:pB')}/prompt`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', reject);
    req.write(body.subarray(0, split));
    setTimeout(() => { req.write(body.subarray(split)); req.end(); }, 50);
  });
  assert.equal(status, 200);
  const got = prompts.find((p) => p.target === 'w1:pB');
  assert.ok(got, 'daemon should have received the prompt');
  assert.equal(got.text, text, 'prompt must arrive byte-identical, no U+FFFD mangling');
});

test('e2e: stream delivers a reply appended after connect', async () => {
  const t = await api(`agent/${enc('w1:pA')}/transcript`);
  const wait = sseWait(
    `agent/${enc('w1:pA')}/stream?offset=${t.offset}`,
    (f) => f.event === 'events' && f.data.some((e) => e.kind === 'assistant' && e.text.includes('late reply')),
  );
  // give the stream a beat to open before the write lands
  await new Promise((r) => setTimeout(r, 300));
  await fsp.appendFile(
    path.join(home, '.grok', 'sessions', enc(cwdA), 'sess-a', 'updates.jsonl'),
    updLine('sess-a', chunk('agent_message_chunk', 'late reply with `code`')),
  );
  const frame = await wait;
  const ev = frame.data.find((e) => e.kind === 'assistant');
  assert.equal(ev.text, 'late reply with `code`');
});

test('e2e: stream emits reset when the session file shrinks underneath it', async () => {
  // rewind/compaction rewrites updates.jsonl smaller; the tail poll must tell
  // the client to reload rather than emit garbage from a stale offset.
  const t = await api(`agent/${enc('w1:pB')}/transcript`);
  const wait = sseWait(
    `agent/${enc('w1:pB')}/stream?offset=${t.offset}`,
    (f) => f.event === 'reset',
  );
  await new Promise((r) => setTimeout(r, 300));
  await fsp.writeFile(
    path.join(home, '.grok', 'sessions', enc(cwdB), 'sess-b', 'updates.jsonl'),
    updLine('sess-b', chunk('user_message_chunk', 'short')),
  );
  const frame = await wait;
  assert.equal(frame.event, 'reset');
});
