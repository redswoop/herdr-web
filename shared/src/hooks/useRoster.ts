import { useEffect, useState } from 'react';
import { apiUrl, get } from '../api';
import { getPlatform } from '../platform';
import type { Roster } from '../types';

const EMPTY: Roster = { agents: [], updatedAt: 0 };

export function useRoster() {
  const [roster, setRoster] = useState<Roster>(EMPTY);
  const [connected, setConnected] = useState(false);
  const [authNeeded, setAuthNeeded] = useState(false);

  useEffect(() => {
    const platform = getPlatform();
    let alive = true;
    let es: ReturnType<typeof platform.openSse> | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
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

    const load = async () => {
      es?.close();
      es = null;
      try {
        const r = await get('/api/roster');
        if (!alive) return;
        if (r.status === 401) {
          setAuthNeeded(true);
          return;
        }
        setRoster((await r.json()) as Roster);
      } catch {
        if (!alive) return;
        setConnected(false);
        schedule(2500);
        return;
      }
      bump();
      es = platform.openSse(apiUrl('/api/roster/stream'));
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
        if (!alive) return;
        setConnected(false);
        es?.close();
        es = null;
        schedule(2500);
      };
    };

    const wake = () => {
      if (!platform.isForeground() || !alive) return;
      if (!es || es.isClosed() || stale()) {
        if (retry) {
          clearTimeout(retry);
          retry = null;
        }
        load();
      }
    };
    const unsubWake = platform.onWake(wake);
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
      unsubWake();
    };
  }, []);

  return { roster, connected, authNeeded };
}
