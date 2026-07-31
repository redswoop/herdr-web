import { useEffect, useState } from 'react';
import type { Roster } from '../types';

const EMPTY: Roster = { agents: [], updatedAt: 0 };

export function useRoster() {
  const [roster, setRoster] = useState<Roster>(EMPTY);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let alive = true;
    // initial fetch so deep links render before the SSE lands
    fetch('/api/roster')
      .then((r) => r.json())
      .then((j) => alive && setRoster(j))
      .catch(() => {});
    const es = new EventSource('/api/roster/stream');
    es.addEventListener('roster', (e) => {
      if (!alive) return;
      const j = JSON.parse((e as MessageEvent).data) as Roster;
      setRoster(j);
      setConnected(!j.herdrDown);
    });
    es.onopen = () => alive && setConnected(true);
    es.onerror = () => alive && setConnected(false);
    return () => {
      alive = false;
      es.close();
    };
  }, []);

  return { roster, connected };
}
