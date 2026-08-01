import type { Item, Mine, MineState, TEvent } from './types';

export function insertSorted(list: Item[], item: Item): void {
  let i = list.length;
  while (i > 0 && list[i - 1].at > item.at) i -= 1;
  list.splice(i, 0, item);
}

export interface AtClock {
  claimAt(t: number): number;
  nextAt(): number;
}

export function createAtClock(initial = 0): AtClock & { maxAt: () => number } {
  let maxAt = initial;
  return {
    claimAt(t: number) {
      if (t > maxAt) maxAt = t;
      return t;
    },
    nextAt() {
      maxAt += 1;
      return maxAt;
    },
    maxAt: () => maxAt,
  };
}

export interface StampedEvent {
  ev: TEvent;
  at: number;
  key: number;
}

/**
 * Claim a sort key and an item key per event. Runs OUTSIDE the setItems
 * updater on purpose: React may invoke an updater more than once, and a clock
 * tick or keyRef++ in there would drift.
 */
export function stampEvents(evs: TEvent[], nextKey: () => number, clock: AtClock): StampedEvent[] {
  return evs.map((ev) => {
    const ts = ev.ts ? Date.parse(ev.ts) : NaN;
    return { ev, at: Number.isNaN(ts) ? clock.nextAt() : clock.claimAt(ts), key: nextKey() };
  });
}

/**
 * Merge stamped session-file events into the item list, reconciling optimistic
 * mine-bubbles and dropping bubbles that become command pills. Pure — safe to
 * re-run on the same input.
 */
export function applyEvents(prev: Item[], stamped: StampedEvent[]): Item[] {
  const next = [...prev];
  for (const { ev, at, key } of stamped) {
    if (ev.kind === 'user') {
      // reconcile into the NEWEST matching bubble — a re-send of text whose
      // stopped predecessor was never persisted must not have its echo
      // swallowed by the old ⏹ bubble
      const i = next.findLastIndex(
        (it) =>
          it.type === 'mine' &&
          it.mine.text === ev.text.trim() &&
          it.mine.state !== 'confirmed' &&
          !it.mine.reconciled,
      );
      if (i !== -1) {
        const it = next[i] as { type: 'mine'; mine: Mine; at: number };
        const keep = it.mine.state === 'stopping' || it.mine.state === 'stopped';
        next[i] = {
          ...it,
          mine: { ...it.mine, state: keep ? it.mine.state : 'confirmed', reconciled: true },
        };
        continue;
      }
    }
    if (ev.kind === 'command') {
      const full = [ev.name, ev.text].filter(Boolean).join(' ');
      const i = next.findIndex(
        (it) =>
          it.type === 'mine' &&
          it.mine.text === full &&
          !it.mine.reconciled &&
          it.mine.state !== 'stopping' &&
          it.mine.state !== 'stopped',
      );
      if (i !== -1) next.splice(i, 1);
    }
    insertSorted(next, { type: 'event', ev, key, at });
  }
  return next;
}

export function setMineState(items: Item[], key: number, state: MineState): Item[] {
  return items.map((it) =>
    it.type === 'mine' && it.mine.key === key ? { ...it, mine: { ...it.mine, state } } : it,
  );
}

export function findLastCancellableMine(items: Item[]): Mine | null {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const it = items[i];
    if (
      it.type === 'mine' &&
      (it.mine.state === 'sending' || it.mine.state === 'sent' || it.mine.state === 'confirmed')
    ) {
      return it.mine;
    }
  }
  return null;
}
