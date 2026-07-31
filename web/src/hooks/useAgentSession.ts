import { useCallback, useEffect, useRef, useState } from 'react';
import { agentPath, errorOf, post } from '../api';
import type { Item, Mine, MineState, TEvent } from '../types';

/**
 * Owns the transcript item list for one agent: events streamed from the
 * session file, merged chronologically with optimistic locally-sent bubbles.
 * A locally-sent prompt renders instantly ('sending' → 'sent'); when the same
 * text shows up in the session file it flips to 'confirmed' in place instead
 * of double-rendering.
 */
export function useAgentSession(paneId: string) {
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(false); // brief lockout after an interrupt
  const keyRef = useRef(0);
  const [gen, setGen] = useState(0); // bumped on server 'reset' → full reload

  const applyEvents = useCallback((evs: TEvent[]) => {
    setItems((prev) => {
      const next = [...prev];
      for (const ev of evs) {
        if (ev.kind === 'user') {
          const i = next.findIndex(
            (it) =>
              it.type === 'mine' &&
              it.mine.text === ev.text.trim() &&
              (it.mine.state === 'sending' || it.mine.state === 'sent'),
          );
          if (i !== -1) {
            const it = next[i] as { type: 'mine'; mine: Mine };
            next[i] = { type: 'mine', mine: { ...it.mine, state: 'confirmed' } };
            continue;
          }
        }
        next.push({ type: 'event', ev, key: keyRef.current++ });
      }
      return next;
    });
  }, []);

  useEffect(() => {
    let alive = true;
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    setItems([]);
    setError(null);

    const load = async () => {
      try {
        const r = await fetch(agentPath(paneId, 'transcript'));
        if (!r.ok) throw new Error(await errorOf(r));
        const { events, offset } = (await r.json()) as { events: TEvent[]; offset: number };
        if (!alive) return;
        setError(null);
        applyEvents(events);
        es = new EventSource(`${agentPath(paneId, 'stream')}?offset=${offset}`);
        es.addEventListener('events', (e) => {
          if (alive) applyEvents(JSON.parse((e as MessageEvent).data));
        });
        es.addEventListener('reset', () => {
          // server re-resolved to a different session file — start over
          if (alive) setGen((g) => g + 1);
        });
      } catch (e) {
        if (!alive) return;
        // fresh sessions take a moment to grow a transcript file — retry
        setError(String((e as Error).message ?? e));
        retry = setTimeout(load, 2500);
      }
    };
    load();

    return () => {
      alive = false;
      es?.close();
      if (retry) clearTimeout(retry);
    };
  }, [paneId, gen, applyEvents]);

  const setMineState = useCallback((key: number, state: MineState) => {
    setItems((prev) =>
      prev.map((it) =>
        it.type === 'mine' && it.mine.key === key
          ? { type: 'mine', mine: { ...it.mine, state } }
          : it,
      ),
    );
  }, []);

  /** Optimistic send. Throws (after removing the bubble) so the composer can restore the draft. */
  const send = useCallback(
    async (text: string) => {
      const key = keyRef.current++;
      setItems((prev) => [...prev, { type: 'mine', mine: { key, text, state: 'sending' } }]);
      const r = await post(agentPath(paneId, 'prompt'), { text });
      if (!r.ok) {
        setItems((prev) => prev.filter((it) => !(it.type === 'mine' && it.mine.key === key)));
        throw new Error(await errorOf(r));
      }
      setMineState(key, 'sent');
    },
    [paneId, setMineState],
  );

  /** Esc interrupts the current turn in both claude and grok TUIs. */
  const interrupt = useCallback(async () => {
    setCooldown(true); // a second Esc would hit the idle TUI
    setTimeout(() => setCooldown(false), 1500);
    let last: Mine | null = null;
    setItems((prev) => {
      for (let i = prev.length - 1; i >= 0; i -= 1) {
        const it = prev[i];
        if (it.type === 'mine' && (it.mine.state === 'sent' || it.mine.state === 'confirmed')) {
          last = it.mine;
          return prev.map((x, j) =>
            j === i ? { type: 'mine', mine: { ...it.mine, state: 'stopping' } } : x,
          );
        }
      }
      return prev;
    });
    const r = await post(agentPath(paneId, 'keys'), { keys: ['Escape'] });
    if (!r.ok) alert(await errorOf(r));
    else if (last) setMineState((last as Mine).key, 'stopped');
  }, [paneId, setMineState]);

  return { items, error, send, interrupt, cooldown };
}
