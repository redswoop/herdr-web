import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liteEvents, trimEvents, windowEvents, CLIP_CHARS } from '../lib/transcript-window.js';

const ev = (kind, text = kind) => ({ kind, text });
// three turns: u t r a | u t r t r a | u a
const seq = [
  ev('user', 'u0'), ev('tool_use'), ev('tool_result'), ev('assistant'),
  ev('user', 'u1'), ev('tool_use'), ev('tool_result'), ev('tool_use'), ev('tool_result'), ev('assistant'),
  ev('user', 'u2'), ev('assistant'),
];

test('no tail returns everything', () => {
  const w = windowEvents(seq);
  assert.equal(w.events.length, 12);
  assert.equal(w.start, 0);
  assert.equal(w.total, 12);
});

test('tail aligns back to the turn\'s user prompt when one is in reach', () => {
  const w = windowEvents(seq, 3); // cut lands on turn 2's assistant; u1 is 5 back → out of reach, raw cut
  assert.equal(w.start, 9);
  assert.equal(w.events.length, 3);
  const w2 = windowEvents(seq, 4); // lands on a tool_result of turn 2 → back to u1
  assert.equal(w2.events[0].text, 'u1');
  assert.equal(w2.start, 4);
  assert.equal(w2.events.length, 8);
});

test('alignment is bounded by another tail', () => {
  const long = [ev('user', 'u0'), ...Array.from({ length: 20 }, () => ev('tool_use')), ev('assistant')];
  const w = windowEvents(long, 5);
  assert.equal(w.start, 17); // 22 - 5; the prompt 17 back is out of reach
  assert.equal(w.events.length, 5);
});

test('end pages further back', () => {
  const first = windowEvents(seq, 3);
  const older = windowEvents(seq, 3, first.start);
  assert.equal(older.events[0].text, 'u1');
  assert.equal(older.events.length, 5);
  assert.equal(older.start, 4);
  const oldest = windowEvents(seq, 3, older.start);
  assert.equal(oldest.start, 0);
  assert.equal(oldest.events[0].text, 'u0');
  assert.equal(oldest.events.length, 4);
});

test('tool results are clipped to what the UI shows', () => {
  const big = 'x'.repeat(CLIP_CHARS + 500);
  const [r, a, o, e] = trimEvents([ev('tool_result', big), ev('assistant', big), ev('command_out', big), ev('command_err', big)]);
  assert.ok(r.text.startsWith('x'.repeat(CLIP_CHARS)));
  assert.ok(r.text.endsWith('[truncated]'));
  assert.equal(a.text.length, big.length);
  // `!cat big.log` is the same payload as a Read of it
  assert.ok(o.text.endsWith('[truncated]'));
  assert.ok(e.text.endsWith('[truncated]'));
});

test('lite drops tool output and thinking, keeps summary inputs clipped', () => {
  const big = 'x'.repeat(5000);
  const out = liteEvents([
    { kind: 'tool_use', name: 'Write', text: big, input: { file_path: '/a/b.ts', content: big } },
    { kind: 'tool_use', name: 'Bash', text: big, input: { command: big, timeout: 5 } },
    { kind: 'tool_result', text: big },
    { kind: 'thought', text: big },
    { kind: 'assistant', text: 'hi' },
    { kind: 'command_out', text: big },
  ]);
  assert.deepEqual(out[0].input, { file_path: '/a/b.ts' });
  assert.equal(out[0].text, '');
  assert.equal(out[1].input.command.length, 200);
  assert.equal(out[1].input.timeout, undefined);
  assert.equal(out[2].text, '');
  assert.equal(out[3].text, '');
  assert.equal(out[4].text, 'hi');
  assert.equal(out[5].text, '');
});
