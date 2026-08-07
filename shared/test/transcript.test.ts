import { describe, expect, it } from 'vitest';
import { buildNodes, fmtDur, fmtTok, stepFile, stepSummary } from '../src/transcript';
import type { Item } from '../src/types';

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
