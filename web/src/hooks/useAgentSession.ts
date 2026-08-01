import { useCallback, useEffect, useRef, useState } from 'react';
import { agentPath, errorOf, post } from '../api';
import type { AgentStatus, Item, Mine, MineState, RestoredDraft, TEvent } from '../types';

/**
 * Owns the transcript item list for one agent: events streamed from the
 * session file, merged chronologically with optimistic locally-sent bubbles.
 * A locally-sent prompt renders instantly ('sending' → 'sent'); when the same
 * text shows up in the session file it flips to 'confirmed' in place instead
 * of double-rendering.
 *
 * Also owns the "is the agent busy" signal the stop button runs on: the
 * roster's status lags prompt delivery by a poll cycle, so `working` goes
 * optimistic the moment a prompt is handed to the web server and hands off to
 * the roster once it catches up.
 */
export function useAgentSession(
  paneId: string,
  status: AgentStatus | undefined,
  agentKind: string | undefined,
) {
  const [items, setItems] = useState<Item[]>([]);
  const itemsRef = useRef<Item[]>([]);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false); // first transcript fetch landed
  const [cooldown, setCooldown] = useState(false); // brief lockout after an interrupt
  const keyRef = useRef(0);
  const [gen, setGen] = useState(0); // bumped on server 'reset' → full reload
  const prevPaneRef = useRef<string | null>(null); // pane switch vs same-pane reconnect

  // optimistic busy flag: armed on submit, cleared when the roster confirms
  // 'working' (handoff) or after a decay window if it never does
  const [submitted, setSubmitted] = useState(false);
  const inflightRef = useRef<Promise<boolean> | null>(null); // prompt POST; resolves "delivered?"
  const decayRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopPendingRef = useRef(false);

  // a stopped prompt is handed back to the composer to edit & resend
  const [restoredDraft, setRestoredDraft] = useState<RestoredDraft | null>(null);
  const restoreNonceRef = useRef(0);
  // pending "clear the TUI input line" sequence after a stop — a resend must
  // wait for it, or the new prompt types on top of the restored text
  const tuiClearRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    if (status === 'working') {
      setSubmitted(false); // roster caught up — it owns the button now
      if (decayRef.current) {
        clearTimeout(decayRef.current);
        decayRef.current = null;
      }
    }
  }, [status]);

  // items are kept sorted by `at`. Events carry their session-file timestamp;
  // local items claim "just after everything known" via nextAt(), except the
  // interrupt marker, which gets the server's Esc-time so events flushed
  // before the stop (but delivered after, the SSE tick is 700ms) sort above it
  const maxAtRef = useRef(0);
  const claimAt = useCallback((t: number) => {
    if (t > maxAtRef.current) maxAtRef.current = t;
    return t;
  }, []);
  const nextAt = useCallback(() => (maxAtRef.current += 1), []);

  const insertSorted = (list: Item[], item: Item) => {
    let i = list.length;
    while (i > 0 && list[i - 1].at > item.at) i -= 1;
    list.splice(i, 0, item);
  };

  const applyEvents = useCallback(
    (evs: TEvent[]) => {
      // a command record means the TUI ran a slash command, not a turn — drop
      // the optimistic busy flag so the working pill doesn't linger through
      // its decay window (skills that do real work re-arm via roster status)
      if (evs.some((e) => e.kind === 'command')) setSubmitted(false);
      // sort keys + item keys are claimed OUTSIDE the updater: React may run
      // an updater more than once, and nextAt()/keyRef++ inside would drift
      const stamped = evs.map((ev) => {
        const ts = ev.ts ? Date.parse(ev.ts) : NaN;
        return {
          ev,
          at: Number.isNaN(ts) ? nextAt() : claimAt(ts),
          key: keyRef.current++,
        };
      });
      setItems((prev) => {
        const next = [...prev];
        for (const { ev, at, key } of stamped) {
          if (ev.kind === 'user') {
            // reconcile into the NEWEST matching bubble — a re-send of text
            // whose stopped predecessor was never persisted must not have its
            // echo swallowed by the old ⏹ bubble
            const i = next.findLastIndex(
              (it) =>
                it.type === 'mine' &&
                it.mine.text === ev.text.trim() &&
                it.mine.state !== 'confirmed' &&
                !it.mine.reconciled,
            );
            if (i !== -1) {
              const it = next[i] as { type: 'mine'; mine: Mine; at: number };
              // consume the event; interrupted bubbles keep their ⏹ marker
              const keep = it.mine.state === 'stopping' || it.mine.state === 'stopped';
              next[i] = {
                ...it,
                mine: { ...it.mine, state: keep ? it.mine.state : 'confirmed', reconciled: true },
              };
              continue;
            }
          }
          if (ev.kind === 'command') {
            // a slash command typed in the web composer: drop the bubble,
            // the command pill takes its place
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
      });
    },
    [claimAt, nextAt],
  );

  useEffect(() => {
    let alive = true;
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    // freshness clock for the zombie watchdog (see useRoster for the why);
    // the server pings every 10s, so three missed beats means zombie
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
    const LOCAL_KINDS = new Set(['salvage', 'interrupted', 'command_err']);
    setItems((prev) => {
      if (paneSwitch) return [];
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
    setLoaded(false);
    if (paneSwitch) {
      setSubmitted(false);
      setRestoredDraft(null);
      inflightRef.current = null; // an in-flight POST belongs to the previous pane
      tuiClearRef.current = null;
      maxAtRef.current = 0;
      if (decayRef.current) {
        clearTimeout(decayRef.current);
        decayRef.current = null;
      }
    }

    const load = async () => {
      try {
        const r = await fetch(agentPath(paneId, 'transcript'));
        if (!r.ok) throw new Error(await errorOf(r));
        const { events, offset } = (await r.json()) as { events: TEvent[]; offset: number };
        if (!alive) return;
        setError(null);
        setLoaded(true);
        applyEvents(events);
        bump();
        es = new EventSource(`${agentPath(paneId, 'stream')}?offset=${offset}`);
        es.onopen = bump;
        es.addEventListener('ping', bump);
        es.addEventListener('events', (e) => {
          bump();
          if (alive) applyEvents(JSON.parse((e as MessageEvent).data));
        });
        es.addEventListener('reset', () => {
          // server re-resolved to a different session file — start over
          if (alive) setGen((g) => g + 1);
        });
        es.onerror = () => {
          // never let the browser auto-reconnect: it reuses the ORIGINAL
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
      } catch (e) {
        if (!alive) return;
        // fresh sessions take a moment to grow a transcript file — retry
        setError(String((e as Error).message ?? e));
        retry = setTimeout(load, 2500);
      }
    };

    // phones kill background SSE, sometimes without firing onerror — a stream
    // found CLOSED (or silently stale) on foreground/online gets the same
    // clean-reload treatment. (es === null means a fetch/retry is in flight;
    // its timer resumes fine.)
    const wake = () => {
      if (document.visibilityState !== 'visible' || !alive) return;
      if (es && (es.readyState === EventSource.CLOSED || stale())) setGen((g) => g + 1);
    };
    document.addEventListener('visibilitychange', wake);
    addEventListener('online', wake);
    // zombie watchdog: an OPEN stream with no events AND no pings is dead
    const dog = setInterval(() => {
      if (alive && es && stale()) setGen((g) => g + 1);
    }, 10_000);
    load();

    return () => {
      alive = false;
      es?.close();
      if (retry) clearTimeout(retry);
      clearInterval(dog);
      document.removeEventListener('visibilitychange', wake);
      removeEventListener('online', wake);
    };
  }, [paneId, gen, applyEvents]);

  const setMineState = useCallback((key: number, state: MineState) => {
    setItems((prev) =>
      prev.map((it) =>
        it.type === 'mine' && it.mine.key === key ? { ...it, mine: { ...it.mine, state } } : it,
      ),
    );
  }, []);

  /** Optimistic send. Throws (after removing the bubble) so the composer can restore the draft. */
  const send = useCallback(
    async (text: string) => {
      const key = keyRef.current++;
      setItems((prev) => [
        ...prev,
        { type: 'mine', mine: { key, text, state: 'sending' }, at: nextAt() },
      ]);
      setSubmitted(true); // arm the stop button now, not when the roster catches up
      let deliver!: (ok: boolean) => void;
      inflightRef.current = new Promise<boolean>((res) => (deliver = res));
      try {
        // a just-stopped turn leaves its clear sequence pending — the prompt
        // must land after the C-c, never between the Esc and the C-c
        if (tuiClearRef.current) await tuiClearRef.current;
        const r = await post(agentPath(paneId, 'prompt'), { text });
        if (!r.ok) throw new Error(await errorOf(r));
        // don't clobber a bubble a queued stop already marked 'stopping'
        setItems((prev) =>
          prev.map((it) =>
            it.type === 'mine' && it.mine.key === key && it.mine.state === 'sending'
              ? { ...it, mine: { ...it.mine, state: 'sent' } }
              : it,
          ),
        );
        deliver(true);
        // ultra-short turns can finish without the roster ever reporting
        // 'working' — decay back to the send arrow rather than pinning stop
        if (decayRef.current) clearTimeout(decayRef.current);
        decayRef.current = setTimeout(() => setSubmitted(false), 10_000);
      } catch (e) {
        setItems((prev) => prev.filter((it) => !(it.type === 'mine' && it.mine.key === key)));
        setSubmitted(false);
        throw e;
      } finally {
        deliver(false); // no-op if already delivered; unblocks a queued stop on failure
        inflightRef.current = null;
      }
    },
    [paneId, nextAt],
  );

  /**
   * Esc interrupts the current turn in both claude and grok TUIs. A stop
   * tapped while the prompt POST is still in flight queues behind it — the
   * Escape must not outrun the prompt and land on an idle TUI. The server
   * photographs the pane before the Esc lands (claude doesn't persist the
   * in-flight message on abort) and returns the salvaged text.
   */
  const interrupt = useCallback(async () => {
    if (stopPendingRef.current) return;
    stopPendingRef.current = true;
    setCooldown(true); // a second Esc would hit the idle TUI
    try {
      let last: Mine | null = null;
      for (let i = itemsRef.current.length - 1; i >= 0; i -= 1) {
        const it = itemsRef.current[i];
        if (
          it.type === 'mine' &&
          (it.mine.state === 'sending' || it.mine.state === 'sent' || it.mine.state === 'confirmed')
        ) {
          last = it.mine;
          break;
        }
      }
      if (last) setMineState(last.key, 'stopping');
      const inflight = inflightRef.current;
      if (inflight && !(await inflight)) {
        // the submit failed — nothing reached the agent, nothing to stop
        setCooldown(false);
        return;
      }
      const r = await post(agentPath(paneId, 'interrupt'), { prompt: last?.text ?? null });
      if (!r.ok) {
        alert(await errorOf(r));
      } else {
        const { salvage, at } = (await r.json()) as { salvage: string | null; at?: number };
        // mark the cut inline where the stream actually stopped: salvaged
        // partial output (if any), then an "interrupted" divider. Sorted by
        // the server's Esc-time (same clock as the session file), so events
        // flushed pre-stop but delivered post-stop insert above the divider.
        const base = typeof at === 'number' && at > 0 ? claimAt(at) : nextAt();
        setItems((prev) => {
          const next = [...prev];
          if (salvage) {
            insertSorted(next, {
              type: 'event', ev: { kind: 'salvage', text: salvage }, key: keyRef.current++, at: base,
            });
          }
          insertSorted(next, {
            type: 'event', ev: { kind: 'interrupted', text: '' }, key: keyRef.current++, at: base + 1,
          });
          return next;
        });
        claimAt(base + 1);
        if (last) {
          const mine = last as Mine;
          setMineState(mine.key, 'stopped');
          // hand the stopped prompt back to the composer to edit & resend
          setRestoredDraft({ text: mine.text, n: restoreNonceRef.current++ });
          if (agentKind === 'claude') {
            // claude code restores the interrupted prompt into its own input
            // line; the draft lives in our composer now, so clear it there
            // (one C-c clears a non-empty input — it only quits on a double
            // press when empty). grok doesn't restore on Esc, so no clear.
            tuiClearRef.current = (async () => {
              await new Promise((res) => setTimeout(res, 700)); // let the restore land
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
  }, [paneId, agentKind, setMineState, claimAt, nextAt]);

  const working = status === 'working' || submitted;

  // inject: synthesize events client-side (e.g. screen residue of a slash
  // command that wrote no session-file record) — same path as streamed
  // events, so mine-bubble reconciliation and sorting apply
  return { items, error, loaded, send, interrupt, cooldown, working, restoredDraft, inject: applyEvents };
}
