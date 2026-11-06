import { useEffect, useMemo, useRef, useState } from 'react';
import { apiUrl, errorOf, getServers, post, type ServerConf } from '../api';
import { getPlatform, type Platform, type SseClient } from '../platform';
import type { Signal, SignalSnapshot } from '../types';

const EMPTY: SignalSnapshot = { signals: [], sources: [], updatedAt: 0 };

/**
 * The signal store, live, from every registered server — the same
 * fetch-then-stream-then-watchdog shape as useRoster, one connection per
 * host, merged. Keys and beat pane ids from a non-primary server carry its
 * `@<id>` suffix, so `beat:<qualified paneId>` lines up with the roster.
 */
function connectHost(server: ServerConf, platform: Platform, emit: (snap: SignalSnapshot | null, live: boolean) => void) {
  let alive = true;
  let es: SseClient | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let lastMsg = 0;
  const url = apiUrl('/api/signals/stream', server.id || null);
  const schedule = (ms: number) => {
    if (!alive || retry) return;
    retry = setTimeout(() => {
      retry = null;
      open();
    }, ms);
  };
  const open = () => {
    es?.close();
    es = platform.openSse(url);
    es.addEventListener('signals', (e) => {
      if (!alive) return;
      lastMsg = Date.now();
      emit(JSON.parse((e as MessageEvent).data) as SignalSnapshot, true);
    });
    es.addEventListener('ping', () => {
      lastMsg = Date.now();
    });
    es.onopen = () => {
      lastMsg = Date.now();
    };
    es.onerror = () => {
      if (!alive) return;
      emit(null, false);
      es?.close();
      es = null;
      schedule(3000);
    };
  };
  open();
  // the server pings every 10 s: a silent half minute means a dead pipe
  const dog = setInterval(() => {
    if (lastMsg && Date.now() - lastMsg > 30_000) {
      emit(null, false);
      es?.close();
      es = null;
      schedule(0);
    }
  }, 5000);
  const offWake = platform.onWake(() => {
    if (!es || es.isClosed()) schedule(0);
  });
  return () => {
    alive = false;
    clearInterval(dog);
    offWake();
    if (retry) clearTimeout(retry);
    es?.close();
  };
}

/** qualify one server's snapshot so keys/pane ids can't collide across hosts */
function qualify(snap: SignalSnapshot, server: ServerConf): SignalSnapshot {
  const id = server.id;
  if (!id) return snap;
  const q = (k: string) => `${k}@${id}`;
  const signals: Signal[] = snap.signals.map((s) => ({
    ...s,
    key: q(s.key),
    host: s.host || server.name || id,
    attach: s.attach?.paneId ? { ...s.attach, paneId: q(s.attach.paneId) } : s.attach,
  }));
  return { ...snap, signals, sources: snap.sources.map((x) => ({ ...x, id: q(x.id) })) };
}

export function useSignals(enabled = true): { snap: SignalSnapshot; live: boolean; act: (key: string, action: string) => Promise<unknown> } {
  const [slices, setSlices] = useState<Map<string, { snap: SignalSnapshot; live: boolean }>>(() => new Map());
  const serversRef = useRef(getServers());

  useEffect(() => {
    if (!enabled) return;
    const platform = getPlatform();
    const servers = getServers();
    serversRef.current = servers;
    const offs = servers.map((server) =>
      connectHost(server, platform, (snap, live) => {
        setSlices((prev) => {
          const next = new Map(prev);
          const cur = next.get(server.id) ?? { snap: EMPTY, live: false };
          next.set(server.id, { snap: snap ? qualify(snap, server) : cur.snap, live });
          return next;
        });
      }),
    );
    return () => {
      for (const off of offs) off();
    };
  }, [enabled]);

  const snap = useMemo<SignalSnapshot>(() => {
    const all = [...slices.values()];
    if (!all.length) return EMPTY;
    return {
      signals: all.flatMap((s) => s.snap.signals),
      sources: all.flatMap((s) => s.snap.sources),
      updatedAt: Math.max(0, ...all.map((s) => s.snap.updatedAt)),
    };
  }, [slices]);
  const live = [...slices.values()].some((s) => s.live);

  const act = useMemo(
    () => async (key: string, action: string) => {
      const i = key.lastIndexOf('@');
      const host = i === -1 ? null : key.slice(i + 1);
      const local = i === -1 ? key : key.slice(0, i);
      const r = await post('/api/signals/act', { key: local, action }, host);
      if (!r.ok) throw new Error(await errorOf(r));
      return r.json() as Promise<unknown>;
    },
    [],
  );
  return { snap, live, act };
}

/** signals of one source (any host), in store order (needs-you first) */
export function bySource(snap: SignalSnapshot, source: string): Signal[] {
  return snap.signals.filter((s) => s.source === source);
}
