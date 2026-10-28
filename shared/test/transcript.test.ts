import { describe, expect, it } from 'vitest';
import { buildNodes, fmtDur, fmtTok, stepFile, stepSummary, turnTexts } from '../src/transcript';
import type { Item, TEvent } from '../src/types';

describe('buildNodes', () => {
  it('groups thoughts and tools', () => {
    const items: Item[] = [
      { type: 'mine', mine: { key: 1, text: 'hi', state: 'confirmed' }, at: 1e12 },
      {
        type: 'event',
        ev: { kind: 'thought', text: 'thinking' },
        key: 2,
        at: 1e12 + 100,
      },
      {
        type: 'event',
        ev: { kind: 'tool_use', name: 'Bash', text: 'ls', id: 't1', input: { command: 'ls' } },
        key: 3,
        at: 1e12 + 200,
      },
      {
        type: 'event',
        ev: { kind: 'tool_result', text: 'file.txt', id: 't1' },
        key: 4,
        at: 1e12 + 300,
      },
      {
        type: 'event',
        ev: { kind: 'assistant', text: 'done' },
        key: 5,
        at: 1e12 + 400,
      },
    ];
    const nodes = buildNodes(items, false);
    expect(nodes[0].type).toBe('item');
    expect(nodes[1].type).toBe('group');
    if (nodes[1].type === 'group') {
      expect(nodes[1].steps).toHaveLength(2);
      const tool = nodes[1].steps.find((s) => s.type === 'tool');
      if (tool && tool.type === 'tool') expect(tool.result).toBe('file.txt');
    }
    expect(nodes.some((n) => n.type === 'item' && n.item.type === 'event')).toBe(true);
  });
});

describe('buildNodes: grok usage events', () => {
  // regression: usage is pure accounting — it must fold into the turn footer,
  // never render as a stray item, and never count as work on its own
  const items: Item[] = [
    { type: 'mine', mine: { key: 1, text: 'hi', state: 'confirmed' }, at: 1e12 },
    { type: 'event', ev: { kind: 'assistant', text: 'reply' }, key: 2, at: 1e12 + 2000 },
    { type: 'event', ev: { kind: 'usage', text: '', usage: { out: 42, ctx: 9000 } }, key: 3, at: 1e12 + 2100 },
  ];

  it('never renders a usage item', () => {
    const nodes = buildNodes(items, false);
    expect(
      nodes.some((n) => n.type === 'item' && n.item.type === 'event' && n.item.ev.kind === 'usage'),
    ).toBe(false);
  });

  it('folds usage into the turn meta footer', () => {
    const nodes = buildNodes(items, false);
    const meta = nodes.find((n) => n.type === 'meta');
    expect(meta).toBeDefined();
    if (meta?.type === 'meta') {
      expect(meta.tok).toBe(42);
      expect(meta.ctx).toBe(9000);
    }
  });

  it('usage alone is not sawWork — an interrupted no-op turn gets no footer', () => {
    const noWork: Item[] = [
      { type: 'mine', mine: { key: 1, text: 'hi', state: 'stopped' }, at: 1e12 },
      { type: 'event', ev: { kind: 'usage', text: '', usage: { out: 1, ctx: 10 } }, key: 2, at: 1e12 + 50 },
    ];
    expect(buildNodes(noWork, false).some((n) => n.type === 'meta')).toBe(false);
  });
});

describe('buildNodes: SendUserFile', () => {
  const ev = (key: number, e: TEvent): Item => ({
    type: 'event',
    ev: e,
    key,
    at: 1e12 + key,
  });
  const items: Item[] = [
    { type: 'mine', mine: { key: 1, text: 'show me', state: 'confirmed' }, at: 1e12 },
    ev(2, { kind: 'tool_use', name: 'Bash', text: 'make', id: 'b1', input: { command: 'make' } }),
    ev(3, { kind: 'tool_result', text: 'ok', id: 'b1' }),
    ev(4, {
      kind: 'tool_use',
      name: 'SendUserFile',
      text: '',
      id: 's1',
      input: { files: ['/tmp/a.png', '/tmp/b.csv'], caption: 'round 1', status: 'proactive', display: 'render' },
    }),
    ev(5, { kind: 'tool_result', text: '2 files delivered to user.', id: 's1' }),
    ev(6, { kind: 'assistant', text: 'there you go' }),
  ];

  it('breaks the send out of the activity group as a files card', () => {
    const nodes = buildNodes(items, false);
    expect(nodes.map((n) => n.type)).toEqual(['item', 'group', 'files', 'item']);
    const f = nodes[2];
    if (f.type !== 'files') throw new Error('expected files');
    expect(f.files).toEqual(['/tmp/a.png', '/tmp/b.csv']);
    expect(f.caption).toBe('round 1');
    expect(f.proactive).toBe(true);
    expect(f.attach).toBe(false);
  });

  it('swallows the delivery receipt instead of opening a stray group', () => {
    const nodes = buildNodes(items, false);
    const g = nodes[1];
    if (g.type !== 'group') throw new Error('expected group');
    expect(g.steps).toHaveLength(1);
  });

  it('a malformed call stays an ordinary tool step', () => {
    const nodes = buildNodes(
      [ev(1, { kind: 'tool_use', name: 'SendUserFile', text: '', id: 'x', input: { files: [] } })],
      false,
    );
    expect(nodes.map((n) => n.type)).toEqual(['group']);
  });
});

describe('helpers', () => {
  it('stepFile / stepSummary (claude CamelCase)', () => {
    expect(stepFile('Read', { file_path: '/a/b/c.ts' })).toBe('/a/b/c.ts');
    expect(stepSummary('Bash', { command: 'echo hi\nmore' }, '')).toBe('echo hi');
  });
  it('stepFile / stepSummary know grok snake_case tools', () => {
    // regression: these lived only in the web copy — mobile showed raw JSON
    expect(stepFile('read_file', { target_file: '/a/b/c.ts' })).toBe('/a/b/c.ts');
    expect(stepFile('search_replace', { file_path: '/x/y.js' })).toBe('/x/y.js');
    expect(stepSummary('run_terminal_command', { command: 'make -j8\nrest' }, '')).toBe('make -j8');
    expect(stepSummary('read_file', { target_file: '/a/b/c.ts' }, '')).toBe('b/c.ts');
    expect(stepSummary('list_dir', { target_directory: '/home/x/proj' }, '')).toBe('x/proj');
    expect(stepSummary('grep', { pattern: 'foo', glob: '/src/lib' }, '')).toBe('foo in src/lib');
    expect(stepSummary('web_fetch', { url: 'https://x.dev' }, '')).toBe('https://x.dev');
    expect(stepSummary('todo_write', {}, '')).toBe('update todo list');
    expect(
      stepSummary('ask_user_question', { questions: [{ question: 'which one?' }] }, ''),
    ).toBe('which one?');
    expect(stepSummary('spawn_subagent', { description: 'audit captions' }, '')).toBe('audit captions');
  });
  it('fmtDur / fmtTok', () => {
    expect(fmtDur(5000)).toBe('5s');
    expect(fmtTok(1500)).toBe('1.5k');
  });
});

describe('turnTexts', () => {
  const ev = (key: number, kind: string, text: string, at = 1e12 + key * 1000): Item => ({
    type: 'event', ev: { kind, text } as Item extends { ev: infer E } ? E : never, key, at,
  });
  it('one block per turn: prompt + replies, tools left out, keyed by every member', () => {
    const items: Item[] = [
      ev(1, 'user', 'first ask'),
      ev(2, 'assistant', 'looking'),
      { type: 'event', ev: { kind: 'tool_use', name: 'Bash', text: 'ls', id: 't', input: {} }, key: 3, at: 1e12 + 3000 },
      ev(4, 'assistant', 'found it'),
      ev(5, 'user', 'second ask'),
      ev(6, 'assistant', 'sure'),
    ];
    const nodes = buildNodes(items, false);
    const map = turnTexts(nodes);
    const first = '**You:** first ask\n\nlooking\n\nfound it';
    expect(map.get('e1')).toBe(first);
    expect(map.get('e4')).toBe(first);
    const meta = nodes.find((n) => n.type === 'meta');
    expect(meta && map.get(meta.key)).toBe(first);
    expect(map.get('e6')).toBe('**You:** second ask\n\nsure');
    expect([...map.values()].some((v) => v.includes('ls'))).toBe(false);
  });
});

describe('buildNodes: /compact', () => {
  it('joins the stdout to its pill across the compaction note', () => {
    const ev = (key: number, e: TEvent): Item => ({
      type: 'event',
      ev: e,
      key,
      at: 1e12 + key,
    });
    const nodes = buildNodes(
      [
        ev(1, { kind: 'command', name: '/compact', text: 'keep the auth notes' }),
        ev(2, { kind: 'note', name: 'compact', text: 'context compacted' }),
        ev(3, { kind: 'command_out', text: 'Compacted (ctrl+o to see full summary)' }),
      ],
      false,
    );
    const cmds = nodes.filter((n) => n.type === 'command');
    expect(cmds).toHaveLength(1);
    expect(cmds[0]).toMatchObject({ name: '/compact', args: 'keep the auth notes', out: 'Compacted (ctrl+o to see full summary)' });
    expect(nodes.some((n) => n.type === 'item' && n.item.type === 'event' && n.item.ev.kind === 'note')).toBe(true);
  });

  it('does not reach back over any other note', () => {
    const ev = (key: number, e: TEvent): Item => ({ type: 'event', ev: e, key, at: 1e12 + key });
    const nodes = buildNodes(
      [
        ev(1, { kind: 'command', name: '/model', text: 'opus' }),
        ev(2, { kind: 'note', name: 'task', text: 'background task finished' }),
        ev(3, { kind: 'command_out', text: 'stray output' }),
      ],
      false,
    );
    const cmds = nodes.filter((n) => n.type === 'command');
    expect(cmds).toHaveLength(2);
    expect(cmds[0]).toMatchObject({ name: '/model', out: '' });
    expect(cmds[1]).toMatchObject({ name: '', out: 'stray output' });
  });
});
