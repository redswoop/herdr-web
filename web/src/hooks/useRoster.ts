import { useEffect, useState } from 'react';
import type { Roster } from '../types';

const EMPTY: Roster = { agents: [], updatedAt: 0 };

export function useRoster() {
  const [roster, setRoster] = useState<Roster>(EMPTY);
  const [connected, setConnected] = useState(false);
  // server rejected us with 401 — the app should show the token gate, not
  // an empty roster that looks broken
  const [authNeeded, setAuthNeeded] = useState(false);

  useEffect(() => {
    let alive = true;
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    // freshness clock: proxies can hold a dead stream open with no error
    // event ever firing. The server broadcasts the roster every ~5s refresh,
    // so a few missed beats means zombie
    let lastMsg = Date.now();
    const bump = () => {
      lastMsg = Date.now();
    };
    const stale = () => Date.now() - lastMsg > 20_000;

    const schedule = (ms: number) => {
      if (!alive || retry) return;
      retry = setTimeout(() => {
        retry = null;
        load();
      }, ms);
    };

    // probe with a plain fetch first — EventSource can't report a 401, it
    // just errors forever, which reads as "broken"
    const load = async () => {
      es?.close();
      es = null;
      try {
        const r = await fetch('/api/roster');
        if (!alive) return;
        if (r.status === 401) {
          setAuthNeeded(true);
          return;
        }
        setRoster(await r.json());
      } catch {
        if (!alive) return;
        setConnected(false);
        schedule(2500);
        return;
      }
      bump();
      es = new EventSource('/api/roster/stream');
      es.addEventListener('roster', (e) => {
        if (!alive) return;
        bump();
        const j = JSON.parse((e as MessageEvent).data) as Roster;
        setRoster(j);
        setConnected(!j.herdrDown);
      });
      es.addEventListener('ping', bump);
      es.onopen = () => {
        bump();
        if (alive) setConnected(true);
      };
      es.onerror = () => {
        // Never trust EventSource auto-reconnect: a proxy answering the retry
        // with a non-SSE response (tailscale serve 502 while the daemon
        // restarts) closes it PERMANENTLY. Own the loop — tear down, refetch,
        // reopen.
        if (!alive) return;
        setConnected(false);
        es?.close();
        es = null;
        schedule(2500);
      };
    };

    // phones kill background SSE, sometimes without firing onerror — on
    // foreground/online, revive anything dead OR silently stale
    const wake = () => {
      if (document.visibilityState !== 'visible' || !alive) return;
      if (!es || es.readyState === EventSource.CLOSED || stale()) {
        if (retry) {
          clearTimeout(retry);
          retry = null;
        }
        load();
      }
    };
    document.addEventListener('visibilitychange', wake);
    addEventListener('online', wake);
    // zombie watchdog: an OPEN stream that's gone quiet gets rebuilt
    const dog = setInterval(() => {
      if (alive && es && stale()) {
        setConnected(false);
        load();
      }
    }, 5_000);
    load();

    return () => {
      alive = false;
      es?.close();
      if (retry) clearTimeout(retry);
      clearInterval(dog);
      document.removeEventListener('visibilitychange', wake);
      removeEventListener('online', wake);
    };
  }, []);

  return { roster, connected, authNeeded };
}
