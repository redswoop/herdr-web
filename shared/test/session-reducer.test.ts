import { describe, expect, it } from 'vitest';
import { applyEvents, createAtClock, insertSorted } from '../src/session-reducer';
import type { Item, TEvent } from '../src/types';

describe('insertSorted', () => {
  it('inserts by at ascending', () => {
    const list: Item[] = [
      { type: 'event', ev: { kind: 'user', text: 'a' }, key: 0, at: 10 },
      { type: 'event', ev: { kind: 'user', text: 'c' }, key: 2, at: 30 },
    ];
    insertSorted(list, { type: 'event', ev: { kind: 'user', text: 'b' }, key: 1, at: 20 });
    expect(list.map((i) => (i.type === 'event' ? i.ev.text : ''))).toEqual(['a', 'b', 'c']);
  });
});

describe('applyEvents', () => {
  it('confirms matching mine bubble', () => {
    const clock = createAtClock();
    let k = 0;
    const prev: Item[] = [
      { type: 'mine', mine: { key: 1, text: 'hello', state: 'sent' }, at: 1 },
    ];
    const evs: TEvent[] = [{ kind: 'user', text: 'hello', ts: '2020-01-01T00:00:00.000Z' }];
    const { items, hadCommand } = applyEvents(prev, evs, () => k++, clock);
    expect(hadCommand).toBe(false);
    expect(items).toHaveLength(1);
    expect(items[0].type).toBe('mine');
    if (items[0].type === 'mine') {
      expect(items[0].mine.state).toBe('confirmed');
      expect(items[0].mine.reconciled).toBe(true);
    }
  });

  it('keeps stopped state on reconcile', () => {
    const clock = createAtClock();
    let k = 0;
    const prev: Item[] = [
      { type: 'mine', mine: { key: 1, text: 'hello', state: 'stopped' }, at: 1 },
    ];
    const { items } = applyEvents(
      prev,
      [{ kind: 'user', text: 'hello' }],
      () => k++,
      clock,
    );
    if (items[0].type === 'mine') expect(items[0].mine.state).toBe('stopped');
  });

  it('swallows mine bubble for slash command', () => {
    const clock = createAtClock();
    let k = 0;
    const prev: Item[] = [
      { type: 'mine', mine: { key: 1, text: '/model', state: 'sent' }, at: 1 },
    ];
    const { items, hadCommand } = applyEvents(
      prev,
      [{ kind: 'command', name: '/model', text: '' }],
      () => k++,
      clock,
    );
    expect(hadCommand).toBe(true);
    expect(items.some((i) => i.type === 'mine')).toBe(false);
    expect(items.some((i) => i.type === 'event' && i.ev.kind === 'command')).toBe(true);
  });

  it('inserts late events above interrupt by at', () => {
    const clock = createAtClock(1000);
    let k = 0;
    const prev: Item[] = [
      {
        type: 'event',
        ev: { kind: 'interrupted', text: '' },
        key: 99,
        at: 2000,
      },
    ];
    const { items } = applyEvents(
      prev,
      [{ kind: 'assistant', text: 'late', ts: new Date(1500).toISOString() }],
      () => k++,
      clock,
    );
    expect(items[0].type).toBe('event');
    if (items[0].type === 'event') expect(items[0].ev.kind).toBe('assistant');
    if (items[1].type === 'event') expect(items[1].ev.kind).toBe('interrupted');
  });
});
