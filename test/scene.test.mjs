import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SceneStore, PLUGINS, extractValue, parseKv, catalog, parseShow } from '../lib/scene.js';

function fakeRes() {
  const res = new EventEmitter();
  res.frames = [];
  res.write = (s) => res.frames.push(s);
  return res;
}

test('mount/update/unmount/move/clear round trip', () => {
  const st = new SceneStore();
  const scope = 'pane:w1:p1';
  let snap = st.apply(scope, [
    { op: 'mount', plugin: 'summary', id: 'a', title: 'A', props: { body: 'hi' } },
    { op: 'mount', plugin: 'summary', props: { body: 'auto id' } },
  ]);
  assert.equal(snap.rev, 1);
  assert.deepEqual(snap.cards.map((c) => c.id), ['a', 'c1']);

  snap = st.apply(scope, [{ op: 'update', id: 'a', props: { tone: 'warn' }, title: 'A2' }]);
  assert.equal(snap.cards[0].title, 'A2');
  assert.deepEqual(snap.cards[0].props, { body: 'hi', tone: 'warn' }); // merged, not replaced

  snap = st.apply(scope, [{ op: 'move', id: 'c1', to: 0 }]);
  assert.deepEqual(snap.cards.map((c) => c.id), ['c1', 'a']);

  snap = st.apply(scope, [{ op: 'mount', plugin: 'summary', id: 'a', props: { body: 'replaced' } }]);
  assert.equal(snap.cards.length, 2, 'mount with an existing id replaces in place');
  assert.equal(snap.cards[1].props.body, 'replaced');

  snap = st.apply(scope, [{ op: 'unmount', id: 'a' }]);
  assert.deepEqual(snap.cards.map((c) => c.id), ['c1']);
  snap = st.apply(scope, [{ op: 'clear' }]);
  assert.equal(snap.cards.length, 0);
  assert.equal(snap.rev, 6);
  // scopes() only lists non-empty scenes
  assert.deepEqual(st.scopes(), []);
});

test('validation rejects before mutating anything', () => {
  const st = new SceneStore();
  const scope = 'pane:x';
  assert.throws(
    () => st.apply(scope, [
      { op: 'mount', plugin: 'summary', props: { body: 'ok' } },
      { op: 'mount', plugin: 'nope' },
    ]),
    /unknown plugin "nope"/,
  );
  assert.equal(st.snapshot(scope).cards.length, 0, 'first op must not land when the second fails');
  assert.throws(() => st.apply(scope, [{ op: 'mount', plugin: 'summary' }]), /props.body required/);
  assert.throws(
    () => st.apply(scope, [{ op: 'mount', plugin: 'summary', props: { body: 'x', tone: 'loud' } }]),
    /tone must be one of/,
  );
  assert.throws(() => st.apply(scope, [{ op: 'unmount', id: 'ghost' }]), /no card "ghost"/);
  assert.throws(() => st.apply(scope, []), /non-empty/);
  assert.throws(() => st.apply(scope, [{ op: 'dance' }]), /unknown op/);
});

test('subscribers get scene snapshots and source data frames', async () => {
  // a fake runner so the test never shells out
  let calls = 0;
  const run = async (cmd) => {
    calls += 1;
    return { code: 0, out: `${cmd}:${calls * 10}\n`, err: '', ms: 1, timedOut: false };
  };
  const st = new SceneStore({ sourceOpts: { run } });
  const scope = 'pane:w1:p2';
  const res = fakeRes();
  st.subscribe(scope, res);

  st.apply(scope, [{
    op: 'mount', plugin: 'command-watch', id: 'cw',
    props: { cmd: 'temp', interval: 1000, render: 'sparkline', parse: { regex: 'temp:(\\d+)' } },
  }]);
  assert.match(res.frames[0], /^event: scene\n/);
  // the first tick fires immediately (async) — wait for its data frame
  await new Promise((r) => setTimeout(r, 30));
  const dataFrame = res.frames.find((f) => f.startsWith('event: data\n'));
  assert.ok(dataFrame, 'a data frame arrived');
  const { id, data } = JSON.parse(dataFrame.split('\ndata: ')[1]);
  assert.equal(id, 'cw');
  assert.equal(data.value, 10);
  assert.deepEqual(data.history.map((h) => h.v), [10]);
  // and the snapshot carries the last data for late joiners
  assert.equal(st.snapshot(scope).cards[0].data.value, 10);

  // unmount stops the poller: no more runs after
  st.apply(scope, [{ op: 'unmount', id: 'cw' }]);
  const before = calls;
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(calls, before);
  assert.equal(st.sources.size, 0);

  // a closed client is dropped from the set
  res.emit('close');
  assert.equal(st.clients.size, 0);
  st.close();
});

test('update with new props restarts the source with the new command', async () => {
  const seen = [];
  const run = async (cmd) => {
    seen.push(cmd);
    return { code: 0, out: '1', err: '', ms: 1, timedOut: false };
  };
  const st = new SceneStore({ sourceOpts: { run } });
  st.apply('pane:q', [{ op: 'mount', plugin: 'command-watch', id: 'k', props: { cmd: 'one' } }]);
  await new Promise((r) => setTimeout(r, 10));
  st.apply('pane:q', [{ op: 'update', id: 'k', props: { cmd: 'two' } }]);
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(seen, ['one', 'two']);
  st.close();
});

test('extractValue: bare number, json path, regex', () => {
  assert.equal(extractValue(' 42.5\n'), 42.5);
  assert.equal(extractValue('nope'), undefined);
  const j = JSON.stringify({ 'k10temp-pci-00c3': { Tctl: { temp1_input: 38.25 } }, arr: [{ x: 7 }] });
  assert.equal(extractValue(j, { json: 'k10temp-pci-00c3.Tctl.temp1_input' }), 38.25);
  assert.equal(extractValue(j, { json: 'arr.0.x' }), 7);
  assert.equal(extractValue(j, { json: 'arr.9.x' }), undefined);
  assert.equal(extractValue('not json', { json: 'a' }), undefined);
  assert.equal(extractValue('gpu temp 61 C', { regex: 'temp (\\d+)' }), 61);
  assert.equal(extractValue('a=1\nb=22', { regex: '^b=(\\d+)' }), 22);
  assert.equal(extractValue('x', { regex: '(' }), undefined, 'bad regex is not fatal');
});

test('parseKv handles colon, equals, tab, and bare lines', () => {
  assert.deepEqual(parseKv('cpu: 38°C\nmem = 12G\nload\t0.5\nfree 9\njustwords'), [
    ['cpu', '38°C'], ['mem', '12G'], ['load', '0.5'], ['free', '9'], ['justwords', ''],
  ]);
});

test('catalog exposes manifests without functions', () => {
  const cat = catalog();
  assert.deepEqual(cat.map((m) => m.name).sort(), Object.keys(PLUGINS).sort());
  for (const m of cat) {
    assert.equal(typeof m.description, 'string');
    assert.equal('source' in m, false);
    assert.equal(typeof m.live, 'boolean');
  }
  assert.equal(cat.find((m) => m.name === 'command-watch').live, true);
});

test('parseShow: running unit gets uptime from the monotonic clock; missing unit does not', () => {
  const out = 'LoadState=loaded\nActiveState=active\nSubState=running\nMainPID=42\nNRestarts=2\nResult=success\nExecMainStartTimestampMonotonic=5000000\nDescription=demo\n';
  const st = parseShow(out, 65.5);
  assert.equal(st.uptimeSec, 61);
  assert.equal(st.pid, 42);
  assert.equal(st.restarts, 2);
  assert.equal(st.description, 'demo');
  const gone = parseShow('LoadState=not-found\nActiveState=inactive\nSubState=dead\n', 65.5);
  assert.equal(gone.uptimeSec, null);
  assert.equal(gone.pid, null);
  assert.equal(gone.load, 'not-found');
});

test('service-control: validates unit names, polls via the runner, actions refresh and broadcast', async () => {
  const calls = [];
  const run = async (cmd, args) => {
    calls.push([cmd, ...args].join(' '));
    if (args.includes('show')) {
      return { code: 0, out: 'LoadState=loaded\nActiveState=active\nSubState=running\nMainPID=7\nNRestarts=0\nExecMainStartTimestampMonotonic=1000000\n', err: '', timedOut: false };
    }
    return { code: 0, out: '', err: '', timedOut: false };
  };
  const st = new SceneStore({ sourceOpts: { run } });
  const scope = 'pane:svc';
  const res = fakeRes();
  st.subscribe(scope, res);
  assert.throws(
    () => st.apply(scope, [{ op: 'mount', plugin: 'service-control', id: 'x', props: { unit: 'evil; rm -rf /' } }]),
    /unit must match/,
  );
  st.apply(scope, [{ op: 'mount', plugin: 'service-control', id: 'svc', props: { unit: 'demo.service', interval: 60_000 } }]);
  await new Promise((r) => setTimeout(r, 30));
  assert.ok(calls.some((c) => c === 'systemctl --user show demo.service -p ' + calls.find((x) => x.includes('-p')).split('-p ')[1]));
  assert.equal(st.snapshot(scope).cards[0].data.active, 'active');

  const result = await st.action(scope, 'svc', 'restart');
  assert.equal(result.ok, true);
  assert.match(result.text, /restart demo.service: ok/);
  assert.ok(calls.includes('systemctl --user restart demo.service'));
  const actionFrame = res.frames.find((f) => f.startsWith('event: action'));
  assert.ok(actionFrame, 'clients hear about the action');
  assert.equal(JSON.parse(actionFrame.split('\ndata: ')[1]).result.name, 'restart');
  // the action triggered an immediate re-poll
  const shows = calls.filter((c) => c.includes(' show ')).length;
  assert.ok(shows >= 2, `expected a refresh poll, saw ${shows} show calls`);

  await assert.rejects(() => st.action(scope, 'svc', 'explode'), /no action "explode"/);
  await assert.rejects(() => st.action(scope, 'ghost', 'restart'), /no card "ghost"/);
  // system scope actions go through sudo -n
  st.apply(scope, [{ op: 'update', id: 'svc', props: { scope: 'system' } }]);
  await st.action(scope, 'svc', 'stop');
  assert.ok(calls.includes('sudo -n systemctl stop demo.service'));
  st.close();
});

test('persistence: card lists survive a new store, data does not, sources restart', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'scene-persist-'));
  const file = path.join(dir, 'scenes.json');
  let runs = 0;
  const run = async () => { runs += 1; return { code: 0, out: '7', err: '', ms: 1, timedOut: false }; };
  const a = new SceneStore({ persistFile: file, sourceOpts: { run } });
  a.apply('pane:p', [
    { op: 'mount', plugin: 'summary', id: 'state', props: { body: 'hi' } },
    { op: 'mount', plugin: 'command-watch', props: { cmd: 'x', interval: 60_000 } },
  ]);
  a.apply('pane:empty', [{ op: 'mount', plugin: 'summary', id: 'e', props: { body: 'x' } }]);
  a.apply('pane:empty', [{ op: 'unmount', id: 'e' }]);
  await new Promise((r) => setTimeout(r, 400)); // debounced save
  a.close();
  const saved = JSON.parse(await fsp.readFile(file, 'utf8'));
  assert.deepEqual(Object.keys(saved.scenes), ['pane:p'], 'empty scenes are not persisted');
  assert.equal('data' in saved.scenes['pane:p'].cards[1], false);

  const runsBefore = runs;
  const b = new SceneStore({ persistFile: file, sourceOpts: { run } });
  await b.load();
  const snap = b.snapshot('pane:p');
  assert.deepEqual(snap.cards.map((c) => c.id), ['state', 'c1']);
  assert.equal(snap.rev, 1);
  await new Promise((r) => setTimeout(r, 30));
  assert.ok(runs > runsBefore, 'the restored command-watch polls again');
  assert.equal(b.snapshot('pane:p').cards[1].data?.value, 7, 'and its data lands on the restored card');
  // ids keep counting from where they left off
  const next = b.apply('pane:p', [{ op: 'mount', plugin: 'summary', props: { body: 'new' } }]);
  assert.equal(next.cards[2].id, 'c2');
  b.close();
  await fsp.rm(dir, { recursive: true, force: true });
});

test('catalog lists actions by name with docs', () => {
  const svc = catalog().find((m) => m.name === 'service-control');
  assert.deepEqual(Object.keys(svc.actions), ['restart', 'stop', 'start']);
  assert.equal(typeof svc.actions.restart, 'string');
  assert.equal(catalog().find((m) => m.name === 'summary').actions, undefined);
});

test('real shell source runs a command end to end', async () => {
  const st = new SceneStore();
  const res = fakeRes();
  st.subscribe('pane:sh', res);
  st.apply('pane:sh', [{
    op: 'mount', plugin: 'command-watch', id: 'e',
    props: { cmd: 'printf "a: 1\\nb: 2\\n"', render: 'kv', interval: 60_000 },
  }]);
  for (let i = 0; i < 50 && !res.frames.some((f) => f.startsWith('event: data')); i += 1) {
    await new Promise((r) => setTimeout(r, 20));
  }
  const f = res.frames.find((x) => x.startsWith('event: data'));
  assert.ok(f, 'shell data frame arrived');
  const { data } = JSON.parse(f.split('\ndata: ')[1]);
  assert.equal(data.ok, true);
  assert.deepEqual(data.kv, [['a', '1'], ['b', '2']]);
  st.close();
});
