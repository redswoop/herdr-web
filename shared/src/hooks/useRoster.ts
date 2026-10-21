import { useCallback, useEffect, useRef, useState } from 'react';
import { apiUrl, get, post } from '../api';
import { getPlatform } from '../platform';
import type { Roster } from '../types';

const EMPTY: Roster = { agents: [], updatedAt: 0 };

export function useRoster() {
  const [roster, setRoster] = useState<Roster>(EMPTY);
  const [connected, setConnected] = useState(false);
  const [authNeeded, setAuthNeeded] = useState(false);
  // client clock of the last roster we applied — the server pushes one every
  // ~5s, so a growing gap means the pipe is dead even if the socket says open
  const [syncedAt, setSyncedAt] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const kick = useRef<() => void>(() => {});

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
    // the OS says there's no network: stop retrying into the void and wait
    // for the link to come back (onLink flips this and reloads)
    let linkDown = false;

    const schedule = (ms: number) => {
      if (!alive || retry || linkDown) return;
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
        setSyncedAt(Date.now());
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
        setSyncedAt(Date.now());
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

    // a dead stream reconnects (fresh GET included)
    kick.current = () => {
      if (!alive) return;
      if (!es || es.isClosed() || stale()) {
        if (retry) {
          clearTimeout(retry);
          retry = null;
        }
        load();
      }
    };

    const wake = () => {
      if (!platform.isForeground() || !alive) return;
      // back from the background: re-snapshot herdr, don't trust what we had
      void refreshNow();
      if (!es || es.isClosed() || stale()) {
        if (retry) {
          clearTimeout(retry);
          retry = null;
        }
        load();
      }
    };
    const refreshNow = async () => {
      try {
        const r = await post('/api/roster/refresh', {});
        if (!alive || !r.ok) return;
        setRoster((await r.json()) as Roster);
        setSyncedAt(Date.now());
        // no bump(): a good POST says nothing about the stream's health
      } catch {}
    };

    const unsubWake = platform.onWake(wake);
    const unsubLink =
      platform.onLink?.((up) => {
        if (!alive || up === !linkDown) return; // no transition for us
        linkDown = !up;
        if (!up) {
          setConnected(false);
          es?.close();
          es = null;
          if (retry) {
            clearTimeout(retry);
            retry = null;
          }
        } else {
          load();
        }
      }) ?? (() => {});
    const dog = setInterval(() => {
      if (alive && es && stale() && !linkDown) {
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
      unsubLink();
    };
  }, []);

  /** Pull-to-refresh: herdr re-snapshotted now, and a dead stream reopened. */
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const r = await post('/api/roster/refresh', {});
      if (r.ok) {
        setRoster((await r.json()) as Roster);
        setSyncedAt(Date.now());
      }
    } catch {
      // unreachable server: the reconnect below owns the retry
    } finally {
      kick.current();
      setRefreshing(false);
    }
  }, []);

  return { roster, connected, authNeeded, syncedAt, refresh, refreshing };
}
