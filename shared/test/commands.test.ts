import { describe, expect, it } from 'vitest';
import { commandText, fmtTokens, sessionReadout, shortModel } from '../src/commands';
import type { Item, TEvent } from '../src/types';

let key = 0;
const ev = (e: Partial<TEvent> & { kind: TEvent['kind'] }): Item =>
  ({ type: 'event', ev: { text: '', ...e }, key: key++, at: key }) as Item;

describe('sessionReadout', () => {
  it('takes model / effort / ctx from the newest assistant record', () => {
    const items = [
      ev({ kind: 'assistant', model: 'claude-sonnet-5-5', effort: 'low', usage: { out: 1, ctx: 10 } }),
      ev({ kind: 'user', text: 'hi' }),
      ev({ kind: 'assistant', model: 'claude-opus-5-5', effort: 'high', usage: { out: 1, ctx: 98_038 } }),
      ev({ kind: 'tool_result', text: 'ok' }),
    ];
    expect(sessionReadout(items)).toEqual({ model: 'claude-opus-5-5', effort: 'high', ctx: 98_038 });
  });

  it('an /effort stdout newer than the last turn wins', () => {
    const items = [
      ev({ kind: 'assistant', model: 'claude-opus-5-5', effort: 'high', usage: { out: 1, ctx: 5 } }),
      ev({ kind: 'command', name: '/effort', text: 'max' }),
      ev({ kind: 'command_out', text: 'Set effort level to max (saved as your default for new sessions): Deepest' }),
    ];
    expect(sessionReadout(items).effort).toBe('max');
  });

  it('a compaction after the last turn blanks the stale context size', () => {
    const items = [
      ev({ kind: 'assistant', model: 'claude-opus-5-5', effort: 'high', usage: { out: 1, ctx: 150_000 } }),
      ev({ kind: 'note', name: 'compact', text: 'context compacted' }),
    ];
    expect(sessionReadout(items)).toEqual({ model: 'claude-opus-5-5', effort: 'high', ctx: null });
  });

  it('is all-null on an empty session', () => {
    expect(sessionReadout([])).toEqual({ model: null, effort: null, ctx: null });
  });
});

describe('formatting', () => {
  it('shortModel', () => {
    expect(shortModel('claude-opus-5-5')).toBe('opus 5.5');
    expect(shortModel('claude-sonnet-4-5-20250929')).toBe('sonnet 4.5');
    expect(shortModel('claude-fable-5')).toBe('fable 5');
    expect(shortModel('gpt-x')).toBe('gpt-x');
    expect(shortModel(null)).toBeNull();
  });
  it('fmtTokens', () => {
    expect(fmtTokens(98_038)).toBe('98k');
    expect(fmtTokens(1_204_000)).toBe('1.2M');
    expect(fmtTokens(512)).toBe('512');
  });
  it('commandText', () => {
    expect(commandText({ verb: 'compact', label: 'compact', send: '/compact' }, '  keep the API notes ')).toBe(
      '/compact keep the API notes',
    );
    expect(commandText({ verb: 'compact', label: 'compact', send: '/compact' }, '')).toBe('/compact');
    expect(commandText({ verb: 'rewind', label: 'rewind', ui: 'rewind' })).toBeNull();
  });
});
