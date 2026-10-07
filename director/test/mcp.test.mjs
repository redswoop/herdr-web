// Integration: spawn the real MCP server over stdio against a tiny fake
// herdr-web, and drive it with the SDK client the way claude does.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const MCP = path.join(here, '..', 'mcp.mjs');

// ---------- fake herdr-web ----------
const scenes = {};
const ops = [];
const roster = {
  agents: [
    { paneId: 'w1:p1', workspaceId: 'w1', agent: 'claude', status: 'idle', label: null, title: 'one', cwd: '/a' },
    { paneId: 'w1:p2', workspaceId: 'w1', agent: 'grok', status: 'working', label: 'two', title: 't', cwd: '/b' },
    { paneId: 'w9:p1', workspaceId: 'w9', agent: 'claude', status: 'idle', label: null, title: 'elsewhere', cwd: '/c' },
  ],
  updatedAt: 1,
};
const transcripts = {
  'w1:p1': [{ kind: 'user', text: 'hello' }, { kind: 'thought', text: 'hmm' }, { kind: 'assistant', text: 'hi' }],
  'w1:p2': [{ kind: 'user', text: 'build it' }],
};
function scene(scope) {
  return (scenes[scope] ??= { scope, rev: 0, cards: [] });
}
let api;
let port;
let client;
let transport;
let tmp;

before(async () => {
  tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcp-test-'));
  api = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const seg = url.pathname.split('/').filter(Boolean);
    const send = (status, obj) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(obj));
    };
    if (seg[1] === 'roster') return send(200, roster);
    if (seg[1] === 'scene-plugins') return send(200, { plugins: [{ name: 'summary', props: { body: { type: 'string' } } }] });
    if (seg[1] === 'scene' && seg[2]) {
      const scope = decodeURIComponent(seg[2]);
      if (req.method === 'GET') return send(200, scene(scope));
      if (seg[3] === 'ops') {
        let body = '';
        req.on('data', (d) => { body += d; });
        req.on('end', () => {
          const j = JSON.parse(body);
          ops.push(...j.ops);
          const s = scene(scope);
          for (const op of j.ops) {
            if (op.op === 'mount') s.cards.push({ id: op.id ?? 'c1', plugin: op.plugin, title: op.title ?? null, props: op.props ?? {}, data: { ok: true, value: 7, out: 'x'.repeat(500), history: [1] } });
            if (op.op === 'bad') return send(400, { error: 'unknown op "bad"' });
          }
          s.rev += 1;
          send(200, s);
        });
        return;
      }
    }
    if (seg[1] === 'agent' && seg[3] === 'transcript') {
      const id = decodeURIComponent(seg[2]);
      return send(200, { events: transcripts[id] ?? [], offset: 10, sessionId: 's' });
    }
    send(404, { error: 'nope' });
  });
  await new Promise((r) => api.listen(0, '127.0.0.1', r));
  port = api.address().port;

  transport = new StdioClientTransport({
    command: process.execPath,
    args: [MCP],
    env: {
      ...process.env,
      HERDR_WEB_API: `http://127.0.0.1:${port}`,
      WORKSPACE_ID: 'w1',
      NOTES_FILE: path.join(tmp, 'notes', 'w1.md'),
      KNOWLEDGE_FILE: path.join(tmp, 'learned.md'),
    },
    stderr: 'pipe',
  });
  client = new Client({ name: 'test', version: '0' });
  await client.connect(transport);
});

after(async () => {
  await client?.close();
  api?.close();
  if (tmp) await fsp.rm(tmp, { recursive: true, force: true });
});

const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  return { text: r.content.map((c) => c.text).join(''), isError: !!r.isError };
};

test('tool list is workspace-aware and includes memory tools', async () => {
  const { tools } = await client.listTools();
  assert.deepEqual(
    tools.map((t) => t.name).sort(),
    ['knowledge_append', 'notes_read', 'notes_write', 'panes', 'scene_apply', 'scene_catalog', 'scene_get', 'transcript_tail'],
  );
  assert.match(tools.find((t) => t.name === 'panes').description, /workspace w1/);
});

test('panes: only this workspace', async () => {
  const { text } = await call('panes');
  const ps = JSON.parse(text);
  assert.deepEqual(ps.map((p) => p.pane), ['w1:p1', 'w1:p2']);
  assert.equal(ps[1].status, 'working');
});

test('scene_get / scene_apply round-trip through the daemon, data trimmed', async () => {
  const r = await call('scene_apply', { ops: [{ op: 'mount', plugin: 'summary', id: 'state', props: { body: 'x' } }] });
  assert.equal(r.isError, false);
  assert.match(r.text, /applied \(rev 1\)/);
  assert.equal(ops[0].plugin, 'summary');
  const g = JSON.parse((await call('scene_get')).text);
  assert.equal(g.scope, 'ws:w1');
  assert.equal(g.cards[0].data.value, 7);
  assert.equal('history' in g.cards[0].data, false, 'history is not shipped to the model');
  assert.equal('out' in g.cards[0].data, false, 'raw out dropped when a value exists');
});

test('scene_apply: schema rejects a bad op before it reaches the daemon', async () => {
  const before = ops.length;
  const r = await call('scene_apply', { ops: [{ op: 'explode' }] });
  assert.equal(r.isError, true);
  assert.equal(ops.length, before, 'nothing was posted');
});

test('transcript_tail: compacts, defaults to the first pane, takes a pane', async () => {
  const a = await call('transcript_tail', { events: 10 });
  assert.equal(a.text, '[pane w1:p1]\nUSER: hello\nAGENT: hi', 'thoughts are dropped');
  const b = await call('transcript_tail', { pane: 'w1:p2', events: 10 });
  assert.equal(b.text, '[pane w1:p2]\nUSER: build it');
});

test('notes: empty, round-trip, cap enforced', async () => {
  assert.equal((await call('notes_read')).text, '(no notes yet)');
  const ok = await call('notes_write', { notes: 'STORY: x\nON STAGE: state\n' });
  assert.match(ok.text, /notes saved \(2 lines\)/);
  assert.equal((await call('notes_read')).text, 'STORY: x\nON STAGE: state\n');
  const tooLong = await call('notes_write', { notes: Array.from({ length: 41 }, (_, i) => `l${i}`).join('\n') });
  assert.equal(tooLong.isError, true);
  assert.match(tooLong.text, /cap is 40/);
  assert.equal((await call('notes_read')).text, 'STORY: x\nON STAGE: state\n', 'rejected write left the old notes');
});

test('knowledge_append: appends dated facts, dedupes, refuses to grow forever', async () => {
  const f = path.join(tmp, 'learned.md');
  await fsp.writeFile(f, '# learned\n');
  assert.equal((await call('knowledge_append', { fact: 'comfyui restart takes about 40s' })).text, 'learned');
  assert.equal((await call('knowledge_append', { fact: 'comfyui restart takes about 40s' })).text, 'already known');
  const body = await fsp.readFile(f, 'utf8');
  assert.match(body, /^- comfyui restart takes about 40s _\(\d{4}-\d{2}-\d{2}\)_$/m);
  assert.equal(body.split('\n').filter((l) => l.startsWith('- ')).length, 1);
  await fsp.writeFile(f, 'x'.repeat(17_000));
  const full = await call('knowledge_append', { fact: 'one more thing that is long enough' });
  assert.equal(full.isError, true);
  assert.match(full.text, /full/);
});
