import { describe, expect, it } from 'vitest';
import { applyEvents, createAtClock, insertSorted, stampEvents } from '../src/session-reducer';
import type { AtClock } from '../src/session-reducer';
import type { Item, TEvent } from '../src/types';

/** stamp + merge, the way the hook does it (stamping outside the updater) */
function apply(prev: Item[], evs: TEvent[], clock: AtClock, start = 0): Item[] {
  let k = start;
  return applyEvents(prev, stampEvents(evs, () => k++, clock));
}

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

describe('stampEvents', () => {
  it('claims keys and sort slots once per event', () => {
    const clock = createAtClock();
    let k = 0;
    const stamped = stampEvents(
      [
        { kind: 'assistant', text: 'a' },
        { kind: 'assistant', text: 'b' },
      ],
      () => k++,
      clock,
    );
    expect(stamped.map((s) => s.key)).toEqual([0, 1]);
    expect(stamped.map((s) => s.at)).toEqual([1, 2]);
  });

  it('re-running the merge does not drift keys or the clock', () => {
    // React may invoke a setState updater more than once; applyEvents must be
    // safe to re-run on the same stamped input.
    const clock = createAtClock();
    let k = 0;
    const stamped = stampEvents([{ kind: 'assistant', text: 'a' }], () => k++, clock);
    const once = applyEvents([], stamped);
    const twice = applyEvents([], stamped);
    expect(twice).toEqual(once);
    expect(k).toBe(1);
    expect(clock.maxAt()).toBe(1);
  });
});

describe('applyEvents', () => {
  it('confirms matching mine bubble', () => {
    const clock = createAtClock();
    const prev: Item[] = [{ type: 'mine', mine: { key: 1, text: 'hello', state: 'sent' }, at: 1 }];
    const evs: TEvent[] = [{ kind: 'user', text: 'hello', ts: '2020-01-01T00:00:00.000Z' }];
    const items = apply(prev, evs, clock);
    expect(items).toHaveLength(1);
    expect(items[0].type).toBe('mine');
    if (items[0].type === 'mine') {
      expect(items[0].mine.state).toBe('confirmed');
      expect(items[0].mine.reconciled).toBe(true);
    }
  });

  it('keeps stopped state on reconcile', () => {
    const clock = createAtClock();
    const prev: Item[] = [
      { type: 'mine', mine: { key: 1, text: 'hello', state: 'stopped' }, at: 1 },
    ];
    const items = apply(prev, [{ kind: 'user', text: 'hello' }], clock);
    if (items[0].type === 'mine') expect(items[0].mine.state).toBe('stopped');
  });

  it('reconciles into the NEWEST matching bubble, not the stopped one', () => {
    // re-send of text whose stopped predecessor was never persisted: the echo
    // must land on the resend, leaving the ⏹ bubble stopped
    const clock = createAtClock();
    const prev: Item[] = [
      { type: 'mine', mine: { key: 1, text: 'hello', state: 'stopped' }, at: 1 },
      { type: 'mine', mine: { key: 2, text: 'hello', state: 'sent' }, at: 2 },
    ];
    const items = apply(prev, [{ kind: 'user', text: 'hello' }], clock);
    const mines = items.filter((i) => i.type === 'mine');
    expect(mines).toHaveLength(2);
    if (mines[0].type === 'mine') expect(mines[0].mine.state).toBe('stopped');
    if (mines[1].type === 'mine') {
      expect(mines[1].mine.state).toBe('confirmed');
      expect(mines[1].mine.reconciled).toBe(true);
    }
  });

  it('swallows mine bubble for slash command', () => {
    const clock = createAtClock();
    const prev: Item[] = [{ type: 'mine', mine: { key: 1, text: '/model', state: 'sent' }, at: 1 }];
    const items = apply(prev, [{ kind: 'command', name: '/model', text: '' }], clock);
    expect(items.some((i) => i.type === 'mine')).toBe(false);
    expect(items.some((i) => i.type === 'event' && i.ev.kind === 'command')).toBe(true);
  });

  it('inserts late events above interrupt by at', () => {
    const clock = createAtClock(1000);
    const prev: Item[] = [
      {
        type: 'event',
        ev: { kind: 'interrupted', text: '' },
        key: 99,
        at: 2000,
      },
    ];
    const items = apply(prev, [{ kind: 'assistant', text: 'late', ts: new Date(1500).toISOString() }], clock);
    expect(items[0].type).toBe('event');
    if (items[0].type === 'event') expect(items[0].ev.kind).toBe('assistant');
    if (items[1].type === 'event') expect(items[1].ev.kind).toBe('interrupted');
  });
});
