import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiUrl, getServers, joinHost, type ServerConf } from '../api';
import { getPlatform, type Platform, type SseClient } from '../platform';
import type { Agent, HostState, Roster, Tab, Workspace } from '../types';

const EMPTY: Roster = { agents: [], updatedAt: 0 };

/** One server's slice of the picture. */
interface Slice {
  roster: Roster;
  connected: boolean;
  authNeeded: boolean;
  syncedAt: number;
}

const EMPTY_SLICE: Slice = { roster: EMPTY, connected: false, authNeeded: false, syncedAt: 0 };

/**
 * One server's roster stream — fetch, SSE, reconnect, watchdog. The hook
 * below runs one of these per registered server and merges what they report.
 * `emit` is called with the whole slice every time anything changes.
 */
function connectHost(server: ServerConf, platform: Platform, emit: (s: Slice) => void) {
  let alive = true;
  let es: SseClient | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let lastMsg = Date.now();
  // the OS says there's no network: stop retrying into the void and wait
  // for the link to come back (onLink flips this and reloads)
  let linkDown = false;
  let slice: Slice = EMPTY_SLICE;
  const set = (patch: Partial<Slice>) => {
    slice = { ...slice, ...patch };
    emit(slice);
  };
  const bump = () => {
    lastMsg = Date.now();
  };
  // the server pushes a roster every ~5s and pings every 10s: a growing gap
  // means the pipe is dead even if the socket says open
  const stale = () => Date.now() - lastMsg > 20_000;
  const url = (p: string) => apiUrl(p, server.id || null);

  const schedule = (ms: number) => {
    if (!alive || retry || linkDown) return;
    retry = setTimeout(() => {
      retry = null;
      load();
    }, ms);
  };
  const clearRetry = () => {
    if (retry) {
      clearTimeout(retry);
      retry = null;
    }
  };

  const load = async () => {
    es?.close();
    es = null;
    try {
      const r = await fetch(url('/api/roster'));
      if (!alive) return;
      if (r.status === 401) {
        set({ authNeeded: true, connected: false });
        return;
      }
      set({ roster: (await r.json()) as Roster, syncedAt: Date.now(), authNeeded: false });
    } catch {
      if (!alive) return;
      set({ connected: false });
      schedule(2500);
      return;
    }
    bump();
    es = platform.openSse(url('/api/roster/stream'));
    es.addEventListener('roster', (e) => {
      if (!alive) return;
      bump();
      const j = JSON.parse((e as MessageEvent).data) as Roster;
      set({ roster: j, syncedAt: Date.now(), connected: !j.herdrDown });
    });
    es.addEventListener('ping', bump);
    es.onopen = () => {
      bump();
      if (alive) set({ connected: true });
    };
    es.onerror = () => {
      if (!alive) return;
      set({ connected: false });
      es?.close();
      es = null;
      schedule(2500);
    };
  };

  const refreshNow = async (): Promise<boolean> => {
    try {
      const r = await fetch(url('/api/roster/refresh'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      if (!alive || !r.ok) return false;
      set({ roster: (await r.json()) as Roster, syncedAt: Date.now() });
      // no bump(): a good POST says nothing about the stream's health
      return true;
    } catch {
      return false; // unreachable server: the reconnect owns the retry
    }
  };

  const handle = {
    server,
    /** a dead stream reconnects (fresh GET included) */
    kick() {
      if (!alive) return;
      if (!es || es.isClosed() || stale()) {
        clearRetry();
        load();
      }
    },
    /** back from the background: re-snapshot herdr, don't trust what we had */
    wake() {
      if (!alive) return;
      void refreshNow();
      handle.kick();
    },
    link(up: boolean) {
      if (!alive || up === !linkDown) return; // no transition for us
      linkDown = !up;
      if (!up) {
        set({ connected: false });
        es?.close();
        es = null;
        clearRetry();
      } else {
        load();
      }
    },
    watchdog() {
      if (alive && es && stale() && !linkDown) {
        set({ connected: false });
        load();
      }
    },
    refreshNow,
    close() {
      alive = false;
      es?.close();
      clearRetry();
    },
  };
  load();
  return handle;
}

/** Stamp every id with the server it came from; the primary's stay bare. */
function qualify(r: Roster, server: ServerConf, primary: boolean): Roster {
  const id = server.id;
  const q = (x: string) => (primary ? x : joinHost(x, id));
  const agents: Agent[] = r.agents.map((a) => ({
    ...a,
    paneId: q(a.paneId),
    workspaceId: q(a.workspaceId),
    tabId: q(a.tabId),
    host: id,
  }));
  const workspaces: Workspace[] = (r.workspaces ?? []).map((w) => ({ ...w, workspaceId: q(w.workspaceId), host: id }));
  const tabs: Tab[] = (r.tabs ?? []).map((t) => ({ ...t, tabId: q(t.tabId), workspaceId: q(t.workspaceId), host: id }));
  return { ...r, agents, workspaces, tabs };
}

/**
 * The merged roster over every registered server (one stream each). Ids from
 * non-primary servers carry `@<host>`; `hosts` reports each link so the UI can
 * say which box is unreachable instead of silently losing its panes.
 */
export function useRoster() {
  const servers = getServers();
  // the registry only changes on a settings remount, which re-mounts this
  // hook — the key is just what the effect watches
  const key = servers.map((s) => `${s.id}|${s.baseUrl}|${s.token ?? ''}`).join('\n');
  const [slices, setSlices] = useState<Record<string, Slice>>({});
  const [refreshing, setRefreshing] = useState(false);
  const handles = useRef<ReturnType<typeof connectHost>[]>([]);

  useEffect(() => {
    const platform = getPlatform();
    const list = getServers();
    setSlices({});
    handles.current = list.map((s) =>
      connectHost(s, platform, (slice) => setSlices((prev) => (prev[s.id] === slice ? prev : { ...prev, [s.id]: slice }))),
    );
    const all = () => handles.current;
    const unsubWake = platform.onWake(() => {
      if (!platform.isForeground()) return;
      for (const h of all()) h.wake();
    });
    const unsubLink = platform.onLink?.((up) => {
      for (const h of all()) h.link(up);
    }) ?? (() => {});
    const dog = setInterval(() => {
      for (const h of all()) h.watchdog();
    }, 5_000);
    return () => {
      for (const h of all()) h.close();
      handles.current = [];
      clearInterval(dog);
      unsubWake();
      unsubLink();
    };
  }, [key]);

  const merged = useMemo(() => {
    const list = getServers();
    const primary = list[0];
    const hosts: HostState[] = [];
    const agents: Agent[] = [];
    const workspaces: Workspace[] = [];
    const tabs: Tab[] = [];
    let updatedAt = 0;
    let syncedAt = 0;
    for (const s of list) {
      const slice = slices[s.id] ?? EMPTY_SLICE;
      const r = slice.roster;
      const isPrimary = s === primary;
      hosts.push({
        id: s.id,
        name: s.name || r.host || s.id,
        primary: isPrimary,
        connected: slice.connected,
        authNeeded: slice.authNeeded,
        herdrDown: !!r.herdrDown,
        error: r.error,
        updatedAt: r.updatedAt,
        syncedAt: slice.syncedAt,
        build: r.build,
      });
      if (!r.updatedAt) continue;
      const q = qualify(r, s, isPrimary);
      agents.push(...q.agents);
      workspaces.push(...(q.workspaces ?? []));
      tabs.push(...(q.tabs ?? []));
      updatedAt = Math.max(updatedAt, r.updatedAt);
      syncedAt = Math.max(syncedAt, slice.syncedAt);
    }
    const p = primary ? (slices[primary.id] ?? EMPTY_SLICE) : EMPTY_SLICE;
    const roster: Roster = {
      agents,
      workspaces,
      tabs,
      updatedAt,
      herdrDown: list.length > 0 && hosts.every((h) => h.herdrDown || !h.connected) ? !!p.roster.herdrDown : false,
      error: p.roster.error,
      build: p.roster.build,
      bootedAt: p.roster.bootedAt,
      host: p.roster.host,
      hosts,
    };
    return {
      roster,
      // the picture is live if ANY box is talking to us; per-host pills say which aren't
      connected: hosts.some((h) => h.connected),
      // nothing enrolled, or every server fenced us out → the gate
      authNeeded: list.length > 0 && hosts.every((h) => h.authNeeded),
      syncedAt,
      hosts,
    };
  }, [slices]);

  /** Pull-to-refresh: every herdr re-snapshotted now, dead streams reopened. */
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all(handles.current.map((h) => h.refreshNow()));
    } finally {
      for (const h of handles.current) h.kick();
      setRefreshing(false);
    }
  }, []);

  return { ...merged, refresh, refreshing };
}

/** Is the server a given roster id lives on currently talking to us? */
export function hostUp(hosts: HostState[] | undefined, host: string | null | undefined): boolean {
  if (!hosts?.length) return false;
  const h = hosts.find((x) => x.id === (host ?? '')) ?? hosts.find((x) => x.primary) ?? hosts[0];
  return !!h?.connected;
}
