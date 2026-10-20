import { useCallback, useEffect, useRef, useState } from 'react';
import { agentPath, apiUrl, errorOf, get, post } from '../api';
import { getPlatform } from '../platform';
import {
  applyEvents,
  createAtClock,
  findLastCancellableMine,
  insertSorted,
  setMineState as setMineStateIn,
  stampEvents,
} from '../session-reducer';
import type { AgentStatus, Item, Mine, MineState, RestoredDraft, TEvent } from '../types';

/* Per-pane memory of the last visit: items, the stream offset to resume
   from, the paged window and the key/clock counters. Coming back to a pane
   renders this at once and opens the stream where it left off — no fetch,
   no blank screen (the thing Armen read as "an aggressive refresh",
   2026-10-20). The server replays everything since the offset and sends a
   reset if the file changed underneath, so this stays correct. */
type PaneMemory = {
  items: Item[];
  offset: number;
  win: { start: number; total: number } | null;
  nextKey: number;
  maxAt: number;
};
const paneMemory = new Map<string, PaneMemory>();
const PANE_MEMORY_MAX = 8;
export function clearPaneMemory(paneId?: string) {
  if (paneId) paneMemory.delete(paneId);
  else paneMemory.clear();
}

/**
 * Owns the transcript item list for one agent: events streamed from the
 * session file, merged chronologically with optimistic locally-sent bubbles.
 */
export function useAgentSession(
  paneId: string,
  status: AgentStatus | undefined,
  agentKind: string | undefined,
  opts: { tail?: number } = {},
) {
  // `tail`: open with only the newest N events (turn-aligned by the server)
  // and page back on demand — a phone must not pull a 14 MB history to show
  // the last reply. Unset = the whole transcript (web).
  const tail = opts.tail ?? 0;
  const [items, setItems] = useState<Item[]>([]);
  const [older, setOlder] = useState(0); // events before the loaded window
  const [loadingOlder, setLoadingOlder] = useState(false);
  const winRef = useRef<{ start: number; total: number } | null>(null);
  const itemsRef = useRef<Item[]>([]);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [cooldown, setCooldown] = useState(false);
  const keyRef = useRef(0);
  const [gen, setGen] = useState(0);
  const prevPaneRef = useRef<string | null>(null); // pane switch vs same-pane reconnect

  const [submitted, setSubmitted] = useState(false);
  const inflightRef = useRef<Promise<boolean> | null>(null);
  const decayRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopPendingRef = useRef(false);

  const [restoredDraft, setRestoredDraft] = useState<RestoredDraft | null>(null);
  const restoreNonceRef = useRef(0);
  const tuiClearRef = useRef<Promise<void> | null>(null);

  const clockRef = useRef(createAtClock());
  const nextKey = useCallback(() => keyRef.current++, []);
  const offsetRef = useRef(0); // where the live stream stands; the resume point

  // remember every state change for the next visit
  useEffect(() => {
    // effects run in order: on a pane switch this one sees the OLD pane's
    // items under the new paneId until the load effect below has reset them
    if (!loaded || prevPaneRef.current !== paneId) return;
    paneMemory.delete(paneId);
    paneMemory.set(paneId, {
      items,
      offset: offsetRef.current,
      win: winRef.current,
      nextKey: keyRef.current,
      maxAt: clockRef.current.maxAt(),
    });
    while (paneMemory.size > PANE_MEMORY_MAX) paneMemory.delete(paneMemory.keys().next().value!);
  }, [paneId, items, loaded]);

  useEffect(() => {
    if (status === 'working') {
      setSubmitted(false);
      if (decayRef.current) {
        clearTimeout(decayRef.current);
        decayRef.current = null;
      }
    }
  }, [status]);

  const apply = useCallback(
    (evs: TEvent[]) => {
      // a slash command reaching the session file means the TUI accepted it —
      // drop the optimistic busy flag so the working pill doesn't linger
      // through its decay window (skills that do real work re-arm via roster)
      if (evs.some((e) => e.kind === 'command')) setSubmitted(false);
      const stamped = stampEvents(evs, nextKey, clockRef.current);
      setItems((prev) => applyEvents(prev, stamped));
    },
    [nextKey],
  );

  useEffect(() => {
    const platform = getPlatform();
    let alive = true;
    let es: ReturnType<typeof platform.openSse> | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let lastMsg = Date.now();
    const bump = () => {
      lastMsg = Date.now();
    };
    const stale = () => Date.now() - lastMsg > 30_000;
    // A gen bump is a RECONNECT of the same pane (SSE error, zombie watchdog,
    // server reset) — routine on mobile. Local-only state must survive it:
    // optimistic bubbles + client-synthesized events (salvage, ⏹ divider,
    // command_err) exist nowhere else, and a pending TUI-clear/interrupt must
    // not be forgotten mid-flight. A pane SWITCH resets everything.
    const paneSwitch = prevPaneRef.current !== paneId;
    prevPaneRef.current = paneId;
    const memory = paneSwitch ? paneMemory.get(paneId) : undefined;
    const LOCAL_KINDS = new Set(['salvage', 'interrupted', 'command_err']);
    setItems((prev) => {
      if (paneSwitch) return memory?.items ?? [];
      const kept: Item[] = [];
      for (const it of prev) {
        if (it.type === 'event' && LOCAL_KINDS.has(it.ev.kind)) kept.push(it);
        // confirmed bubbles drop — the full reload re-delivers their session
        // event as a plain user bubble. Unconfirmed ones stay, re-armed so
        // the reload can reconcile into them again (⏹ markers survive).
        else if (it.type === 'mine' && it.mine.state !== 'confirmed') {
          kept.push({ ...it, mine: { ...it.mine, reconciled: false } });
        }
      }
      return kept;
    });
    setError(null);
    setLoaded(!!memory);
    if (paneSwitch) {
      winRef.current = memory?.win ?? null;
      offsetRef.current = memory?.offset ?? 0;
      keyRef.current = memory?.nextKey ?? keyRef.current;
      setOlder(memory?.win?.start ?? 0);
      setLoadingOlder(false);
      setSubmitted(false);
      setRestoredDraft(null);
      inflightRef.current = null; // an in-flight POST belongs to the previous pane
      tuiClearRef.current = null;
      clockRef.current = createAtClock(memory?.maxAt ?? 0);
      if (decayRef.current) {
        clearTimeout(decayRef.current);
        decayRef.current = null;
      }
    }

    const listen = (offset: number) => {
      offsetRef.current = offset;
      es = platform.openSse(apiUrl(`${agentPath(paneId, 'stream')}?offset=${offset}`));
      es.onopen = bump;
      es.addEventListener('ping', bump);
      es.addEventListener('events', (e) => {
        bump();
        if (alive) apply(JSON.parse((e as MessageEvent).data));
      });
      es.addEventListener('offset', (e) => {
        const n = Number((e as MessageEvent).data);
        if (Number.isFinite(n)) offsetRef.current = n;
      });
      es.addEventListener('reset', () => {
        if (alive) setGen((g) => g + 1);
      });
      es.onerror = () => {
        // never let the transport auto-reconnect: it reuses the ORIGINAL
        // ?offset=, replaying everything since this stream opened as
        // duplicates. Tear down and reload the transcript cleanly instead —
        // after a beat, so a proxy that hard-rejects the stream (tailscale
        // 502 during a daemon restart) can't spin this into a hot loop.
        if (alive) {
          es?.close();
          es = null;
          retry = setTimeout(() => setGen((g) => g + 1), 2500);
        }
      };
    };

    const load = async () => {
      try {
        // a reconnect keeps whatever window the user had paged back to
        const win = paneSwitch ? null : winRef.current;
        const want = tail && win ? Math.max(tail, win.total - win.start) : tail;
        const r = await get(agentPath(paneId, 'transcript') + (want ? `?tail=${want}` : ''));
        if (!r.ok) throw new Error(await errorOf(r));
        const { events, offset, start = 0, total = events.length } = (await r.json()) as {
          events: TEvent[];
          offset: number;
          start?: number;
          total?: number;
        };
        if (!alive) return;
        winRef.current = { start, total };
        setOlder(start);
        setError(null);
        setLoaded(true);
        apply(events);
        bump();
        listen(offset);
      } catch (e) {
        if (!alive) return;
        setError(String((e as Error).message ?? e));
        retry = setTimeout(load, 2500);
      }
    };

    const wake = () => {
      if (!platform.isForeground() || !alive) return;
      if (es && (es.isClosed() || stale())) setGen((g) => g + 1);
    };
    const unsubWake = platform.onWake(wake);
    const dog = setInterval(() => {
      if (alive && es && stale()) setGen((g) => g + 1);
    }, 10_000);
    if (memory) {
      bump();
      listen(memory.offset); // the remembered transcript is already showing
    } else {
      load();
    }

    return () => {
      alive = false;
      es?.close();
      if (retry) clearTimeout(retry);
      clearInterval(dog);
      unsubWake();
    };
  }, [paneId, gen, apply, tail]);

  // page one more window of history in above the oldest loaded event
  const loadOlder = useCallback(async () => {
    const win = winRef.current;
    if (!win || win.start <= 0 || !tail) return;
    setLoadingOlder(true);
    try {
      const r = await get(`${agentPath(paneId, 'transcript')}?tail=${tail}&end=${win.start}`);
      if (!r.ok) throw new Error(await errorOf(r));
      const { events, start = 0 } = (await r.json()) as { events: TEvent[]; start?: number };
      if (winRef.current !== win) return; // pane switched / reloaded meanwhile
      winRef.current = { ...win, start };
      setOlder(start);
      // older events carry their own timestamps, so insertSorted files them
      // ahead of what's loaded; a fresh clock keeps any unstamped one there too
      const stamped = stampEvents(events, nextKey, createAtClock(0));
      setItems((prev) => applyEvents(prev, stamped));
    } catch (e) {
      getPlatform().notifyError(String((e as Error).message ?? e));
    } finally {
      setLoadingOlder(false);
    }
  }, [paneId, tail, nextKey]);

  const setMineState = useCallback((key: number, state: MineState) => {
    setItems((prev) => setMineStateIn(prev, key, state));
  }, []);

  const send = useCallback(
    async (text: string) => {
      const key = keyRef.current++;
      setItems((prev) => [
        ...prev,
        { type: 'mine', mine: { key, text, state: 'sending' }, at: clockRef.current.nextAt() },
      ]);
      setSubmitted(true);
      let deliver!: (ok: boolean) => void;
      inflightRef.current = new Promise<boolean>((res) => (deliver = res));
      try {
        if (tuiClearRef.current) await tuiClearRef.current;
        const r = await post(agentPath(paneId, 'prompt'), { text });
        if (!r.ok) throw new Error(await errorOf(r));
        setItems((prev) =>
          prev.map((it) =>
            it.type === 'mine' && it.mine.key === key && it.mine.state === 'sending'
              ? { ...it, mine: { ...it.mine, state: 'sent' } }
              : it,
          ),
        );
        deliver(true);
        if (decayRef.current) clearTimeout(decayRef.current);
        decayRef.current = setTimeout(() => setSubmitted(false), 10_000);
      } catch (e) {
        setItems((prev) => prev.filter((it) => !(it.type === 'mine' && it.mine.key === key)));
        setSubmitted(false);
        throw e;
      } finally {
        deliver(false);
        inflightRef.current = null;
      }
    },
    [paneId],
  );

  const interrupt = useCallback(async () => {
    const platform = getPlatform();
    if (stopPendingRef.current) return;
    stopPendingRef.current = true;
    setCooldown(true);
    try {
      const last = findLastCancellableMine(itemsRef.current);
      if (last) setMineState(last.key, 'stopping');
      const inflight = inflightRef.current;
      if (inflight && !(await inflight)) {
        setCooldown(false);
        return;
      }
      const r = await post(agentPath(paneId, 'interrupt'), { prompt: last?.text ?? null });
      if (!r.ok) {
        platform.notifyError(await errorOf(r));
      } else {
        const { salvage, at } = (await r.json()) as { salvage: string | null; at?: number };
        const clock = clockRef.current;
        const base = typeof at === 'number' && at > 0 ? clock.claimAt(at) : clock.nextAt();
        setItems((prev) => {
          const next = [...prev];
          if (salvage) {
            insertSorted(next, {
              type: 'event',
              ev: { kind: 'salvage', text: salvage },
              key: keyRef.current++,
              at: base,
            });
          }
          insertSorted(next, {
            type: 'event',
            ev: { kind: 'interrupted', text: '' },
            key: keyRef.current++,
            at: base + 1,
          });
          return next;
        });
        clock.claimAt(base + 1);
        if (last) {
          const mine = last as Mine;
          setMineState(mine.key, 'stopped');
          setRestoredDraft({ text: mine.text, n: restoreNonceRef.current++ });
          if (agentKind === 'claude') {
            tuiClearRef.current = (async () => {
              await new Promise((res) => setTimeout(res, 700));
              await post(agentPath(paneId, 'keys'), { keys: ['C-c'] });
            })()
              .catch(() => {})
              .finally(() => {
                tuiClearRef.current = null;
              });
          }
        }
        setSubmitted(false);
      }
      setTimeout(() => setCooldown(false), 1500);
    } finally {
      stopPendingRef.current = false;
    }
  }, [paneId, agentKind, setMineState]);

  const working = status === 'working' || submitted;

  return {
    items,
    error,
    loaded,
    send,
    interrupt,
    cooldown,
    working,
    restoredDraft,
    inject: apply,
    older,
    loadingOlder,
    loadOlder,
  };
}
