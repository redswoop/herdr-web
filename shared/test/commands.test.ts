import { describe, expect, it } from 'vitest';
import { commandText, ctxFill, ctxHeat, currentValue, fmtTokens, sessionReadout, shortModel } from '../src/commands';
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
    expect(sessionReadout(items)).toEqual({ model: 'claude-opus-5-5', effort: 'high', ctx: 98_038, window: null });
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
    expect(sessionReadout(items)).toEqual({ model: 'claude-opus-5-5', effort: 'high', ctx: null, window: null });
  });

  it('a /model switch newer than the last turn sets the model and blanks effort', () => {
    const items = [
      ev({ kind: 'assistant', model: 'claude-opus-5-5', effort: 'high', usage: { out: 1, ctx: 5 } }),
      ev({ kind: 'command', name: '/model', text: 'sonnet' }),
      ev({ kind: 'command_out', text: 'Set model to `Sonnet 5.5` and saved as your default for new sessions' }),
    ];
    expect(sessionReadout(items)).toEqual({ model: 'claude-sonnet-5-5', effort: null, ctx: 5, window: null });
    // an /effort after the switch is the real level again
    items.push(ev({ kind: 'command_out', text: 'Set effort level to low (saved as your default for new sessions)' }));
    expect(sessionReadout(items).effort).toBe('low');
  });

  it('is all-null on an empty session', () => {
    expect(sessionReadout([])).toEqual({ model: null, effort: null, ctx: null, window: null });
  });

  it('takes the window from a /context stdout, however old, and heats as it fills', () => {
    const items = [
      ev({ kind: 'command', name: '/context', text: '' }),
      ev({ kind: 'command_out', text: 'Context Usage\n⛁ ⛁ ⛶   33.5k/1m tokens (3%)\n' }),
      ev({ kind: 'assistant', model: 'claude-opus-5-5', effort: 'high', usage: { out: 1, ctx: 50_000 } }),
      ev({ kind: 'user', text: 'more' }),
      ev({ kind: 'assistant', model: 'claude-opus-5-5', effort: 'high', usage: { out: 1, ctx: 700_000 } }),
    ];
    const r = sessionReadout(items);
    expect(r.window).toBe(1_000_000);
    expect(ctxFill(r)).toBeCloseTo(0.7);
    expect(ctxHeat(r)).toBe('warm');
    expect(ctxHeat({ ...r, ctx: 900_000 })).toBe('hot');
    expect(ctxHeat({ ...r, ctx: 100_000 })).toBe('');
    // no /context yet: no window, no tint
    expect(ctxHeat({ ...r, window: null })).toBe('');
    expect(ctxFill({ ...r, window: null })).toBeNull();
  });
});

describe('currentValue', () => {
  const r = { model: 'claude-opus-5-5', effort: 'xhigh', ctx: null, window: null };
  it('marks the effort level and the model family', () => {
    expect(currentValue({ verb: 'effort', label: 'effort', values: ['high', 'xhigh'] }, r)).toBe('xhigh');
    expect(currentValue({ verb: 'model', label: 'model', values: ['fable', 'opus', 'sonnet'] }, r)).toBe('opus');
    expect(currentValue({ verb: 'model', label: 'model', values: ['fable'] }, r)).toBeNull();
    expect(currentValue({ verb: 'compact', label: 'compact' }, r)).toBeNull();
  });
  it('pi: a provider/id model matches its own entry', () => {
    const p = { model: 'llama.cpp/qwen3.8-27b', effort: 'off', ctx: null, window: null };
    expect(currentValue({ verb: 'model', label: 'model', values: ['llama.cpp/qwen3.8-27b', 'openai/gpt-5'] }, p)).toBe('llama.cpp/qwen3.8-27b');
    expect(currentValue({ verb: 'effort', label: 'thinking', values: ['off', 'low'] }, p)).toBe('off');
  });
});

describe('formatting', () => {
  it('shortModel', () => {
    expect(shortModel('claude-opus-5-5')).toBe('opus 5.5');
    expect(shortModel('claude-sonnet-4-5-20250929')).toBe('sonnet 4.5');
    expect(shortModel('claude-fable-5')).toBe('fable 5');
    expect(shortModel('llama.cpp/qwen3.8-27b-heretic')).toBe('qwen3.8-27b-heretic');
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
