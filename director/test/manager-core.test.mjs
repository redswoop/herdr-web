import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scheduler, buildLogBody, buildPrompt, resumeOffset, splitDeltas } from '../lib/manager-core.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('buildPrompt: first turn vs later, panes, deltas, notes', () => {
  const agents = [
    { paneId: 'w1:p1', agent: 'claude', displayAgent: 'Claude Code', label: null, title: 'fix it', status: 'idle', cwd: '/x' },
    { paneId: 'w1:p2', agent: 'grok', label: 'builder', title: 'g', status: 'working', cwd: null },
  ];
  const first = buildPrompt({ ws: 'w1', label: 'proj', agents, notes: '', deltas: [], scene: '{"cards":[]}', first: true });
  assert.match(first, /director for workspace w1 \("proj"\)\. Scene scope: ws:w1\./);
  assert.match(first, /- w1:p1: Claude Code "fix it" — idle, cwd \/x/);
  assert.match(first, /- w1:p2: grok "builder" — working, cwd \?/);
  assert.match(first, /none yet — this is your first turn here/);
  assert.match(first, /\(nothing new in the transcripts — a status changed\)/);
  assert.match(first, /First turn: call scene_catalog once/);
  assert.match(first, /≤ 40 lines/);

  const later = buildPrompt({
    ws: 'w1', label: 'w1', agents, notes: 'STORY: x', first: false, scene: '{}',
    deltas: [{ paneId: 'w1:p1', text: 'USER: hi' }, { paneId: 'w1:p2', text: 'AGENT: ok' }],
  });
  assert.doesNotMatch(later, /\("w1"\)/, 'a label equal to the id is not repeated');
  assert.match(later, /from your last turn\):\nSTORY: x/);
  assert.match(later, /\[pane w1:p1\]\nUSER: hi\n\n\[pane w1:p2\]\nAGENT: ok/);
  assert.match(later, /Adjust the scene with scene_apply/);
  assert.doesNotMatch(later, /First turn/);
});

test('buildLogBody: reply, notes, turn count, cost', () => {
  const b = buildLogBody({ line: 'no change', notes: 'A\nB\n', turns: 3, cost: 0.3456 });
  assert.equal(b, 'no change\n\n---\nA\nB\n\n_turn 3 · $0.35 total_');
  assert.match(buildLogBody({ line: '', notes: '', turns: 1 }), /^\(no reply\)\n\n---\n\(no notes\)\n\n_turn 1 · \$0\.00 total_$/);
});

test('resumeOffset: same session resumes at the cursor; otherwise head + glimpse', () => {
  const t = { offset: 5000, sessionId: 's1', events: Array.from({ length: 100 }, (_, i) => ({ kind: 'user', text: String(i) })) };
  const same = resumeOffset({ offset: 4200, sessionId: 's1' }, t);
  assert.deepEqual(same, { offset: 4200, seed: [], unseenBytes: 800 });
  const fresh = resumeOffset(undefined, t);
  assert.equal(fresh.offset, 5000);
  assert.equal(fresh.seed.length, 40);
  assert.equal(fresh.seed[0].text, '60');
  assert.equal(fresh.unseenBytes, 0);
  const other = resumeOffset({ offset: 100, sessionId: 'OLD' }, t, { glimpse: 3 });
  assert.equal(other.offset, 5000);
  assert.deepEqual(other.seed.map((e) => e.text), ['97', '98', '99']);
  // a cursor past the head (file rewritten) is not trusted
  const ahead = resumeOffset({ offset: 9999, sessionId: 's1' }, t);
  assert.equal(ahead.offset, 5000);
  // no transcript yet
  assert.deepEqual(resumeOffset(undefined, { offset: 0, events: [], sessionId: null }), { offset: 0, seed: [], unseenBytes: 0 });
});

test('splitDeltas: skips idle panes, splits the budget across the busy ones', () => {
  const big = Array.from({ length: 50 }, (_, i) => ({ kind: 'assistant', text: `line ${i} ${'x'.repeat(80)}` }));
  const ds = splitDeltas(
    [
      { paneId: 'a', pending: big },
      { paneId: 'b', pending: [] },
      { paneId: 'c', pending: [{ kind: 'user', text: 'hey' }] },
    ],
    1000,
  );
  assert.deepEqual(ds.map((d) => d.paneId), ['a', 'c']);
  assert.ok(ds[0].text.length <= 1000 / 2 + 60, 'budget is split per busy pane');
  assert.match(ds[0].text, /omitted/);
  assert.equal(ds[0].events.length, 50, 'events are handed back for re-queue');
  assert.equal(ds[1].text, 'USER: hey');
});

test('scheduler: debounce coalesces, single flight, re-queue mid-turn', async () => {
  const runs = [];
  let release;
  const s = new Scheduler({
    debounce: 10, minGap: 0, concurrency: 2,
    run: async (ws, why) => {
      runs.push(`${ws}:${why}`);
      await new Promise((r) => { release = r; });
    },
  });
  s.schedule('w1', 'a');
  s.schedule('w1', 'b'); // coalesced into the pending timer
  await sleep(25);
  assert.deepEqual(runs, ['w1:b'], 'one run, with the latest reason');
  s.schedule('w1', 'c'); // arrives mid-turn → queued, not a second run
  await sleep(25);
  assert.equal(runs.length, 1, 'single flight per workspace');
  release();
  await sleep(30);
  assert.deepEqual(runs, ['w1:b', 'w1:queued during turn']);
  release();
  await sleep(5);
  s.stop();
});

test('scheduler: min gap floors the next turn, concurrency caps across workspaces', async () => {
  const started = [];
  const s = new Scheduler({
    debounce: 5, minGap: 80, concurrency: 1, slotRetry: 10,
    run: async (ws) => {
      started.push([ws, Date.now()]);
      await sleep(30);
    },
  });
  const t0 = Date.now();
  s.schedule('w1', 'x');
  s.schedule('w2', 'y'); // must wait for w1's slot
  await sleep(60);
  assert.deepEqual(started.map((x) => x[0]), ['w1', 'w2']);
  assert.ok(started[1][1] - started[0][1] >= 25, 'w2 waited for w1 to finish');
  // w1 again right away: the min gap pushes it out
  s.schedule('w1', 'z');
  await sleep(40);
  assert.equal(started.filter((x) => x[0] === 'w1').length, 1, 'still inside the gap');
  await sleep(80);
  assert.equal(started.filter((x) => x[0] === 'w1').length, 2);
  assert.ok(started[2][1] - t0 >= 80, 'second w1 turn respected the floor');
  s.stop();
});

test('scheduler: a throwing turn re-queues the workspace', async () => {
  let n = 0;
  const logs = [];
  const s = new Scheduler({
    debounce: 5, minGap: 0, log: (m) => logs.push(m),
    run: async () => {
      n += 1;
      if (n === 1) throw new Error('boom');
    },
  });
  s.schedule('w1', 'go');
  await sleep(40);
  assert.equal(n, 2, 'retried once after the throw');
  assert.ok(logs.some((l) => /turn error: boom/.test(l)));
  assert.equal(s.state('w1').turns, 1, 'only the successful turn counts');
  s.stop();
});
