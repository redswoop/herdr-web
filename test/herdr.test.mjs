// lib/herdr.js socket client, tested against a scripted stub daemon.
// Regression focus: rpc() must settle when the peer closes without replying
// (a pending promise here wedges refreshRoster forever), and subscribe()'s
// onDown must fire at most once per socket (double-fire doubles the caller's
// reconnect loop on every failed subscribe).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-sock-'));
const SOCK = path.join(dir, 'h.sock');
process.env.HERDR_SOCK = SOCK;
const { rpc, subscribe, HerdrError } = await import('../lib/herdr.js');

// One scripted behavior per connection, consumed FIFO.
const behaviors = [];
let srv;

before(async () => {
  srv = net.createServer((sock) => {
    sock.on('error', () => {}); // client destroys mid-write in several cases
    const b = behaviors.shift() ?? ((s) => s.end());
    b(sock);
  });
  await new Promise((res) => srv.listen(SOCK, res));
});
after(() => srv.close());

function onRequest(sock, fn) {
  let buf = '';
  sock.on('data', (d) => {
    buf += d;
    const nl = buf.indexOf('\n');
    if (nl !== -1) fn(JSON.parse(buf.slice(0, nl)));
  });
}

test('rpc resolves on a normal reply', async () => {
  behaviors.push((sock) => onRequest(sock, (req) => {
    assert.equal(req.method, 'agent.list');
    sock.write(JSON.stringify({ id: req.id, result: { ok: 1 } }) + '\n');
  }));
  assert.deepEqual(await rpc('agent.list'), { ok: 1 });
});

test('rpc rejects with HerdrError on an error reply', async () => {
  behaviors.push((sock) => onRequest(sock, (req) => {
    sock.write(JSON.stringify({ id: req.id, error: { code: 'nope', message: 'no such pane' } }) + '\n');
  }));
  await assert.rejects(rpc('agent.read'), (e) => e instanceof HerdrError && e.code === 'nope');
});

test('rpc rejects when the peer closes without replying', async () => {
  behaviors.push((sock) => onRequest(sock, () => sock.end()));
  await assert.rejects(rpc('session.snapshot', {}, { timeoutMs: 2000 }),
    /closed connection/);
});

test('rpc rejects when the peer immediately destroys the connection', async () => {
  behaviors.push((sock) => sock.destroy());
  await assert.rejects(rpc('session.snapshot', {}, { timeoutMs: 2000 }));
});

test('rpc times out against a slow-drip peer that never sends a newline', async () => {
  behaviors.push((sock) => {
    const t = setInterval(() => { if (!sock.destroyed) sock.write('x'); }, 50);
    sock.on('close', () => clearInterval(t));
    sock.on('error', () => clearInterval(t));
  });
  const t0 = Date.now();
  await assert.rejects(rpc('agent.read', {}, { timeoutMs: 300 }), /timeout/);
  assert.ok(Date.now() - t0 < 2000, 'should reject at the deadline, not hang');
});

test('subscribe ack-error fires onDown exactly once', async () => {
  behaviors.push((sock) => onRequest(sock, (req) => {
    sock.write(JSON.stringify({ id: req.id, error: { code: 'bad_sub', message: 'unknown type' } }) + '\n');
  }));
  const downs = [];
  await new Promise((res) => {
    subscribe([{ type: 'pane.updated' }], () => {}, (err) => { downs.push(err); });
    setTimeout(res, 300); // give the destroy→close cascade time to double-fire
  });
  assert.equal(downs.length, 1);
  assert.ok(downs[0] instanceof HerdrError);
});

test('subscribe delivers events then fires onDown(null) once on clean close', async () => {
  behaviors.push((sock) => onRequest(sock, (req) => {
    sock.write(JSON.stringify({ id: req.id, result: {} }) + '\n');
    sock.write(JSON.stringify({ type: 'pane.updated', pane_id: 'p1' }) + '\n');
    setTimeout(() => sock.end(), 50);
  }));
  const events = [];
  const downs = [];
  await new Promise((res) => {
    subscribe([{ type: 'pane.updated' }], (e) => events.push(e), (err) => { downs.push(err); res(); });
  });
  await new Promise((res) => setTimeout(res, 100)); // catch any late second fire
  assert.deepEqual(events.map((e) => e.type), ['pane.updated']);
  assert.deepEqual(downs, [null]);
});
