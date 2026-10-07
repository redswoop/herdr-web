import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FrameSplitter, parseFrame } from '../lib/sse.mjs';
import { compactEvents, toolInputSummary, budget } from '../lib/compact.mjs';

test('sse: frames split across chunks, multi-line data, comments ignored', () => {
  const s = new FrameSplitter();
  assert.deepEqual(s.push('event: scene\ndata: {"a":1}\n'), []);
  const f = s.push('\nevent: data\ndata: line1\ndata: line2\n\n: comment\n\nretry: 2000\n\n');
  assert.deepEqual(f, [
    { event: 'scene', data: '{"a":1}' },
    { event: 'data', data: 'line1\nline2' },
  ]);
  assert.deepEqual(parseFrame('data: x'), { event: 'message', data: 'x' });
  assert.equal(parseFrame(': only a comment'), null);
});

test('compact: events become terse lines, noise dropped', () => {
  const text = compactEvents([
    { kind: 'user', text: 'restart comfy for me' },
    { kind: 'thought', text: 'hmm' },
    { kind: 'usage', text: '' },
    { kind: 'tool_use', name: 'Bash', input: { command: 'systemctl --user restart comfyui', description: 'x' } },
    { kind: 'tool_result', text: '   ' },
    { kind: 'tool_result', text: 'ok\n\n' },
    { kind: 'assistant', text: 'Done, it is back up.' },
    { kind: 'command', name: '/clear', text: '' },
    { kind: 'interrupted', text: '' },
  ]);
  assert.equal(
    text,
    [
      'USER: restart comfy for me',
      '  tool Bash: systemctl --user restart comfyui',
      '  → ok',
      'AGENT: Done, it is back up.',
      'USER ran /clear',
      'USER interrupted the agent',
    ].join('\n'),
  );
  assert.equal(toolInputSummary('Read', { file_path: '/a/b' }), '/a/b');
  assert.match(toolInputSummary('X', { weird: 'y' }), /weird/);
  assert.equal(toolInputSummary('X', 'x'.repeat(300)).length < 300, true);
});

test('budget keeps the tail and says what it cut', () => {
  const b = budget('a\nb\nc\nd\ne', 4);
  assert.match(b, /omitted/);
  assert.ok(b.endsWith('e'));
  assert.equal(budget('short', 100), 'short');
});
