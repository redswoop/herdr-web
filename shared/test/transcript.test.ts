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

describe('helpers', () => {
  it('stepFile / stepSummary', () => {
    expect(stepFile('Read', { file_path: '/a/b/c.ts' })).toBe('/a/b/c.ts');
    expect(stepSummary('Bash', { command: 'echo hi\nmore' }, '')).toBe('echo hi');
  });
  it('fmtDur / fmtTok', () => {
    expect(fmtDur(5000)).toBe('5s');
    expect(fmtTok(1500)).toBe('1.5k');
  });
});
