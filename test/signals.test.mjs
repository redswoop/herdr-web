import test from 'node:test';
import assert from 'node:assert/strict';
import { SignalStore, SignalRunner, slope, fmtBytes, fmtDur } from '../lib/signals.js';
import gaffer from '../lib/probes/gaffer.js';
import sab from '../lib/probes/sab.js';

const ctx = (config = {}, extra = {}) => ({ config, roster: () => ({ agents: [] }), store: new SignalStore(), hostname: 'here', log: { warn() {} }, stateDir: '/tmp', ...extra });

test('slope: a disk freeing 1 GB/s reads as +1e9 per second', () => {
  const t0 = 1_000_000;
  const h = Array.from({ length: 12 }, (_, i) => [t0 + i * 5000, 100e9 + i * 5e9]);
  const r = slope(h, 10 * 60_000, t0 + 60_000);
  assert.ok(Math.abs(r - 1e9) < 1, `got ${r}`);
  assert.equal(slope(h.slice(0, 2)), null, 'two points is not a trend');
});

test('store: put tracks history + rate, replace diffs a source, snapshot sorts needs-you first', () => {
  const s = new SignalStore();
  const t0 = 1_000_000;
  for (let i = 0; i < 6; i += 1) {
    s.put({ key: 'disk:/x', source: 'disk', kind: 'gauge', title: '/x', state: 'ok', value: 50e9 - i * 1e9 }, t0 + i * 5000);
  }
  const d = s.get('disk:/x');
  assert.equal(s.history.get('disk:/x').length, 6);
  assert.ok(d.rate < -1.9e8 && d.rate > -2.1e8, `rate ${d.rate} should be ~-2e8 B/s`);
  assert.equal(d.first, 50e9);
  assert.equal(d.since, t0);

  const changed = s.replace('gaffer', [
    { key: 'gaffer:item:1', kind: 'job', title: 'a', state: 'needs-you' },
    { key: 'gaffer:item:2', kind: 'job', title: 'b', state: 'busy' },
  ]);
  assert.deepEqual(changed.sort(), ['gaffer:item:1', 'gaffer:item:2']);
  // same content again: nothing changed (the clock is ignored)
  assert.deepEqual(s.replace('gaffer', [
    { key: 'gaffer:item:1', kind: 'job', title: 'a', state: 'needs-you' },
    { key: 'gaffer:item:2', kind: 'job', title: 'b', state: 'busy' },
  ]), []);
  // one goes away
  assert.deepEqual(s.replace('gaffer', [{ key: 'gaffer:item:2', kind: 'job', title: 'b', state: 'busy' }]), ['gaffer:item:1']);
  assert.equal(s.get('gaffer:item:1'), null);
  s.put({ key: 'x:bogus', source: 'x', kind: 'text', title: 'x', state: 'purple' });
  assert.equal(s.get('x:bogus').state, 'ok', 'unknown states are coerced');
  const keys = s.snapshot().signals.map((x) => x.key);
  assert.equal(keys[0], 'gaffer:item:2', 'busy sorts before ok');
  assert.ok(s.snapshot().signals.find((x) => x.key === 'disk:/x').history.length === 6, 'snapshot carries history');
});

test('runner: a throwing probe marks its source and keeps its last signals; act() checks the offer', async () => {
  const store = new SignalStore();
  let n = 0;
  const probe = {
    id: 'flaky', every: 100_000,
    async run() {
      n += 1;
      if (n === 2) throw new Error('boom');
      return [{ key: 'flaky:a', kind: 'text', title: 'a', state: 'ok', actions: ['poke'] }];
    },
    async act(_ctx, sig, action) { return { poked: sig.key, action }; },
  };
  const r = new SignalRunner(store, { log: { warn() {} } });
  r.probes.set('flaky', probe);
  r.start();
  await r.tick(probe);
  assert.equal(store.sources.get('flaky').ok, true);
  await r.tick(probe);
  assert.equal(store.sources.get('flaky').ok, false);
  assert.equal(store.sources.get('flaky').error, 'boom');
  assert.ok(store.get('flaky:a'), 'last good signals survive a failed run');
  assert.deepEqual(await r.act('flaky:a', 'poke'), { poked: 'flaky:a', action: 'poke' });
  await assert.rejects(r.act('flaky:a', 'nope'), /does not offer/);
  await assert.rejects(r.act('nothing:here', 'poke'), /no signal/);
  r.stop();
});

const withFetch = async (routes, fn) => {
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    const hit = Object.entries(routes).find(([k]) => u.includes(k));
    if (!hit) throw new Error(`unexpected fetch ${u}`);
    return { ok: true, status: 200, json: async () => hit[1] };
  };
  try { return await fn(); } finally { globalThis.fetch = real; }
};

test('gaffer probe: items become jobs with the right states and verbs; hosts become gauges', async () => {
  const status = {
    now: 2_000_000,
    hosts: [{ host: 'mospeada', online: true, held: false, slots: { cpu: 4, gpu: 1 }, used: { gpu: 1 }, seen: 1_999_000, resources: { gpu: { used: 8000, total: 16000, holders: ['python 7.8G'] } } },
      { host: 'hotbox', online: false, seen: 1_000_000 }],
    items: [
      { id: 1, kind: 'upscale', title: 'bake', state: 'running', host: 'mospeada', progress: { done: 12, total: 25, unit: 'files', phase: 'ship', ts: 1 }, eta: 3600, spec: { cwd: '/mnt/data/upscales', needs: 'gpu' } },
      { id: 2, kind: 'digest', title: 'digest', state: 'needs-you', attention: 'review', host: 'mospeada', spec: {} },
      { id: 3, kind: 'shell', title: 'e2e', state: 'failed', reason: 'exit 1', host: 'stormer', spec: {} },
      { id: 4, kind: 'shell', title: 'seen', state: 'failed', acked: 1, finished: 1_990_000, host: 'stormer', spec: {} },
      { id: 5, kind: 'render', title: 'old', state: 'done', finished: 1_900_000, host: 'stormer', spec: {} },
      { id: 6, kind: 'render', title: 'yielded', state: 'yielded', yield_to: 'qwen (llm)', host: 'stormer', spec: { needs: 'gpu' } },
    ],
  };
  const out = await withFetch({ '/api/status': status }, () => gaffer.run(ctx({ url: 'http://g', token: 't' })));
  const byKey = Object.fromEntries(out.map((s) => [s.key, s]));
  assert.equal(byKey['gaffer:item:1'].state, 'busy');
  assert.equal(byKey['gaffer:item:1'].pct, 48);
  assert.deepEqual(byKey['gaffer:item:1'].actions, ['pause', 'cancel']);
  assert.deepEqual(byKey['gaffer:item:1'].attach, { cwd: '/mnt/data/upscales' });
  assert.match(byKey['gaffer:item:1'].detail, /ship · ~60m left/);
  assert.equal(byKey['gaffer:item:2'].state, 'needs-you');
  assert.deepEqual(byKey['gaffer:item:2'].actions, ['ack']);
  assert.equal(byKey['gaffer:item:3'].state, 'alarm');
  assert.deepEqual(byKey['gaffer:item:3'].actions, ['retry', 'ack']);
  assert.equal(byKey['gaffer:item:4'], undefined, 'acked failures leave the active list');
  assert.equal(byKey['gaffer:item:6'].state, 'idle');
  assert.match(byKey['gaffer:item:6'].detail, /yielded to qwen/);
  assert.equal(byKey['gaffer:board'].state, 'needs-you');
  assert.match(byKey['gaffer:board'].detail, /1 needs you · 1 failed · 1 running · 1 waiting · 2 done today/);
  assert.deepEqual(byKey['gaffer:board'].items.map((i) => i.id), ['4', '5']);
  assert.equal(byKey['gaffer:host:mospeada'].pct, 50);
  assert.equal(byKey['gaffer:host:hotbox'].state, 'down');
});

test('sab probe: a live queue is a busy job with slots; idle polls slower', async () => {
  const queue = { queue: { status: 'Downloading', paused: false, kbpersec: '10240', mb: '1000', mbleft: '250', timeleft: '0:04:10', slots: [{ nzo_id: 'n1', filename: 'thing.mkv', cat: 'movies', size: '1.0 GB', timeleft: '0:04:10', percentage: '75', status: 'Downloading' }] } };
  const history = { history: { slots: [{ nzo_id: 'h1', name: 'done.mkv', category: 'tv', size: '2 GB', status: 'Completed', completed: 1700 }, { nzo_id: 'h2', name: 'bad.mkv', category: 'tv', size: '2 GB', status: 'Failed', fail_message: 'missing articles', completed: 1600 }] } };
  const r = await withFetch({ 'mode=queue': queue, 'mode=history': history }, () => sab.run(ctx({ url: 'http://sab', apiKey: 'k' })));
  assert.equal(r.nextIn, 3000);
  const q = r.signals.find((s) => s.key === 'sab:queue');
  assert.equal(q.state, 'busy');
  assert.equal(q.pct, 75);
  assert.equal(q.eta, 250);
  assert.equal(q.value, 10240 * 1024);
  assert.deepEqual(q.actions, ['pause']);
  assert.equal(q.items[0].pct, 75);
  const h = r.signals.find((s) => s.key === 'sab:history');
  assert.equal(h.state, 'warn');
  assert.equal(h.items[1].state, 'alarm');
  const idle = await withFetch({ 'mode=queue': { queue: { status: 'Idle', slots: [], mb: '0', mbleft: '0' } }, 'mode=history': { history: { slots: [] } } }, () => sab.run(ctx({ url: 'http://sab', apiKey: 'k' })));
  assert.equal(idle.nextIn, 15_000);
  assert.equal(idle.signals[0].state, 'idle');
  assert.deepEqual(await sab.run(ctx({})), [], 'no url, no probe');
});

test('formatters', () => {
  assert.equal(fmtBytes(676.1e9), '676.1 GB');
  assert.equal(fmtBytes(20.12e12), '20.12 TB');
  assert.equal(fmtDur(45), '45s');
  assert.equal(fmtDur(3600 * 2 + 60 * 5), '2h05');
});

test('meaning: playwright, pytest, node error, bare reason', async () => {
  const { meaningOf } = await import('../lib/meaning.js');
  const pw = `  attachment #1: screenshot
    Error Context: test-results/x/error-context.md

  2 failed
    [phone] › e2e/tests/auth.spec.ts:16:3 › shell auth › loads roster shell without token when mock auth is off 
    [phone] › e2e/tests/roster.spec.ts:41:3 › roster › collapse group and persist across reload ────
  11 skipped
  137 passed (2.0m)`;
  assert.equal(meaningOf(pw, 'run exited 1: Error Context: …').text,
    '2 tests failed, 137 passed: shell auth › loads roster shell without token when mock auth is off; roster › collapse group and persist across reload');
  assert.equal(meaningOf('=========== 2 failed, 10 passed in 3.2s ===========').text, '2 failed, 10 passed');
  assert.equal(meaningOf('x\nTypeError: foo is not a function\n    at bar').text, 'TypeError: foo is not a function');
  assert.equal(meaningOf('', 'run exited 137: killed').text, 'killed');
});

test('store: tone collapses seven states to three + plain', async () => {
  const { toneOf } = await import('../lib/signals.js');
  assert.deepEqual(['needs-you','alarm','down','busy','warn','ok','idle'].map(toneOf), ['needs-you','broken','broken','working',null,null,null]);
  const s = new SignalStore();
  s.put({ key: 'a:b', source: 'a', kind: 'text', title: 't', state: 'down' });
  assert.equal(s.get('a:b').tone, 'broken');
});
