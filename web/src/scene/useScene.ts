import { useCallback, useEffect, useState } from 'react';
import { getPlatform } from '@herdr/shared';
import { apiUrl, errorOf, post } from '../api';
import type { Scene, SceneCard, SceneOp } from './types';

const scenePath = (scope: string, tail = '') => `/api/scene/${encodeURIComponent(scope)}${tail}`;

/** Live view of one scope's scene. Same SSE/watchdog shape as useRoster:
 *  snapshot on connect, `scene` frames on every rev, `data` frames for
 *  source emissions, reconnect with backoff on stall. */
export function useScene(scope: string) {
  const [scene, setScene] = useState<Scene>({ scope, rev: -1, cards: [] });
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const platform = getPlatform();
    let alive = true;
    let es: ReturnType<typeof platform.openSse> | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let lastMsg = Date.now();
    const bump = () => {
      lastMsg = Date.now();
    };

    const schedule = (ms: number) => {
      if (!alive || retry) return;
      retry = setTimeout(() => {
        retry = null;
        open();
      }, ms);
    };

    const open = () => {
      es?.close();
      es = platform.openSse(apiUrl(scenePath(scope, '/stream')));
      es.addEventListener('scene', (e) => {
        if (!alive) return;
        bump();
        setScene(JSON.parse(e.data) as Scene);
        setConnected(true);
      });
      es.addEventListener('data', (e) => {
        if (!alive) return;
        bump();
        const { id, data } = JSON.parse(e.data) as { id: string; data: unknown };
        setScene((s) => ({
          ...s,
          cards: s.cards.map((c): SceneCard => (c.id === id ? { ...c, data, updatedAt: Date.now() } : c)),
        }));
      });
      es.addEventListener('action', (e) => {
        if (!alive) return;
        bump();
        const { id, result } = JSON.parse(e.data) as { id: string; result: SceneCard['lastAction'] };
        setScene((s) => ({
          ...s,
          cards: s.cards.map((c): SceneCard => (c.id === id ? { ...c, lastAction: result } : c)),
        }));
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

    // stall watchdog: the server pings every 10s; 30s of silence = zombie
    const watchdog = setInterval(() => {
      if (!alive) return;
      if (!es || es.isClosed() || Date.now() - lastMsg > 30_000) {
        if (retry) {
          clearTimeout(retry);
          retry = null;
        }
        open();
      }
    }, 10_000);
    const offWake = platform.onWake(() => {
      if (!es || es.isClosed() || Date.now() - lastMsg > 20_000) open();
    });

    open();
    return () => {
      alive = false;
      clearInterval(watchdog);
      offWake();
      if (retry) clearTimeout(retry);
      es?.close();
    };
  }, [scope]);

  const apply = useCallback(
    async (ops: SceneOp[]) => {
      const r = await post(scenePath(scope, '/ops'), { ops });
      if (!r.ok) throw new Error(await errorOf(r));
      return (await r.json()) as Scene;
    },
    [scope],
  );

  /** Press a button on a card. The result also arrives as an `action` frame. */
  const act = useCallback(
    async (id: string, action: string) => {
      const r = await post(scenePath(scope, `/cards/${encodeURIComponent(id)}/action`), { action });
      if (!r.ok) throw new Error(await errorOf(r));
      return (await r.json()) as NonNullable<SceneCard['lastAction']>;
    },
    [scope],
  );

  return { scene, connected, apply, act };
}
