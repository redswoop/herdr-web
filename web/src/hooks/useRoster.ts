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

    // probe with a plain fetch first — EventSource can't report a 401, it
    // just errors and auto-retries forever, which reads as "broken"
    const load = async () => {
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
        retry = setTimeout(load, 2500);
        return;
      }
      es = new EventSource('/api/roster/stream');
      es.addEventListener('roster', (e) => {
        if (!alive) return;
        const j = JSON.parse((e as MessageEvent).data) as Roster;
        setRoster(j);
        setConnected(!j.herdrDown);
      });
      es.onopen = () => alive && setConnected(true);
      es.onerror = () => alive && setConnected(false);
    };
    load();

    return () => {
      alive = false;
      es?.close();
      if (retry) clearTimeout(retry);
    };
  }, []);

  return { roster, connected, authNeeded };
}
