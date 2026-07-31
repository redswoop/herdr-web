// End-to-end push round trip without a browser: a local HTTP server plays the
// push service, a generated P-256 pair plays the browser subscription, and the
// test decrypts what the coordinator sends — proving encryption, VAPID, the
// debounce/coalesce/retract lifecycle, and question enrichment all work.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const stateDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'hw-test-'));
process.env.HERDR_WEB_STATE = stateDir; // must precede the import
const { PushStore, Coordinator } = await import('../lib/notify.js');
const { b64u } = await import('../lib/webpush.js');

// browser-side subscription keys
const ua = crypto.createECDH('prime256v1');
ua.generateKeys();
const authSecret = crypto.randomBytes(16);

const received = [];
let service;
let port;

before(async () => {
  service = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      received.push({ headers: req.headers, body: Buffer.concat(chunks) });
      res.writeHead(201).end();
    });
  });
  await new Promise((r) => service.listen(0, '127.0.0.1', r));
  port = service.address().port;
});
after(() => service.close());

function decrypt(body) {
  const salt = body.subarray(0, 16);
  const idlen = body[20];
  const asPublic = body.subarray(21, 21 + idlen);
  const ct = body.subarray(21 + idlen);
  const secret = ua.computeSecret(asPublic);
  const hkdf = (ikm, s, info, len) => Buffer.from(crypto.hkdfSync('sha256', ikm, s, info, len));
  const ikm = hkdf(secret, authSecret,
    Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), asPublic]), 32);
  const cek = hkdf(ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12);
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(ct.subarray(-16));
  const pt = Buffer.concat([d.update(ct.subarray(0, -16)), d.final()]);
  return JSON.parse(pt.subarray(0, -1).toString()); // strip 0x02 pad
}

const tick = (ms = 60) => new Promise((r) => setTimeout(r, ms));

test('coordinator: debounce, enrich, coalesce, retract — full round trip', async () => {
  const store = await new PushStore().init();
  await store.add({
    endpoint: `http://127.0.0.1:${port}/sub1`,
    keys: { p256dh: b64u.enc(ua.getPublicKey()), auth: b64u.enc(authSecret) },
  });

  const ctx = {
    'w1:p1': {
      kind: 'permission', tool: 'Bash', detail: 'rm -rf /',
      // options come parsed off the live screen; buttons must use their real
      // numbers + labels (prompts aren't uniform — guessing digits answers wrong)
      options: [
        { n: 1, label: 'Yes', description: '', selected: true },
        { n: 2, label: "Yes, don't ask again", description: '', selected: false },
        { n: 3, label: 'No', description: '', selected: false },
      ],
    },
    'w1:p2': { kind: 'unknown' },
  };
  const co = new Coordinator(store, async (id) => ctx[id], 25);

  // blocked→idle inside the debounce window: never reaches the phone
  co.onTransition({ paneId: 'w1:p1', agent: 'claude', cwd: '/x' }, 'blocked');
  co.onTransition({ paneId: 'w1:p1', agent: 'claude', cwd: '/x' }, 'idle');
  await tick();
  assert.equal(received.length, 0, 'debounced alert must not send');

  // a real block: fires after the window, enriched with actions
  co.onTransition({ paneId: 'w1:p1', agent: 'claude', cwd: '/x' }, 'blocked');
  await tick();
  assert.equal(received.length, 1);
  let msg = decrypt(received[0].body);
  assert.equal(msg.title, 'claude needs you');
  assert.match(msg.body, /Bash/);
  assert.equal(msg.actions.length, 2); // Android caps at 2 — Yes + Yes-always
  assert.deepEqual(msg.actions[0], { title: 'Yes', keys: ['1'], expect: 'Yes' });
  assert.deepEqual(msg.actions[1], {
    title: "Yes, don't ask again", keys: ['2'], expect: "Yes, don't ask again",
  });
  assert.match(received[0].headers.authorization, /^vapid t=.+, k=.+/);
  assert.equal(received[0].headers.topic, 'herdr-herd');

  // second agent blocks: coalesces into one summary
  co.onTransition({ paneId: 'w1:p2', agent: 'grok', cwd: '/y' }, 'blocked');
  await tick();
  msg = decrypt(received[1].body);
  assert.equal(msg.title, '2 agents need you');
  assert.equal(msg.body, 'claude, grok');

  // both resolve: retraction clears the notification
  co.onTransition({ paneId: 'w1:p1', agent: 'claude', cwd: '/x' }, 'working');
  co.onTransition({ paneId: 'w1:p2', agent: 'grok', cwd: '/y' }, 'working');
  await tick();
  const last = decrypt(received.at(-1).body);
  assert.equal(last.type, 'clear');
});

test('permission without parsed options gets no answer buttons', async () => {
  const store = await new PushStore().init();
  await store.add({
    endpoint: `http://127.0.0.1:${port}/sub2`,
    keys: { p256dh: b64u.enc(ua.getPublicKey()), auth: b64u.enc(authSecret) },
  });
  // screen parse failed → guessing digits could answer wrong; tap-to-open only
  const co = new Coordinator(store, async () => ({ kind: 'permission', tool: 'Bash', detail: '' }), 5);
  co.onTransition({ paneId: 'w1:p9', agent: 'claude', cwd: '/x' }, 'blocked');
  await tick();
  const msg = decrypt(received.at(-1).body);
  assert.match(msg.body, /Bash/);
  assert.equal(msg.actions, undefined);
});

test('store: prunes a 410 subscription', async () => {
  const store = await new PushStore().init();
  const gone = http.createServer((_, res) => res.writeHead(410).end());
  await new Promise((r) => gone.listen(0, '127.0.0.1', r));
  await store.add({
    endpoint: `http://127.0.0.1:${gone.address().port}/dead`,
    keys: { p256dh: b64u.enc(ua.getPublicKey()), auth: b64u.enc(authSecret) },
  });
  const n = store.subs.size;
  await store.broadcast({ title: 'x' });
  assert.equal(store.subs.size, n - 1);
  gone.close();
});
