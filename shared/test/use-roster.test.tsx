// @vitest-environment jsdom
/**
 * useRoster over several servers (PLAN-MULTIHOST.md): one stream per
 * registered server, merged into one picture.
 *   • non-primary ids carry `@host`; the primary's stay bare
 *   • every agent/workspace/tab gets `host`; `hosts` reports each link
 *   • one box down or fenced never hides the others
 *   • refresh fans out to every server
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureServers } from '../src/api';
import { setPlatform, type SseClient } from '../src/platform';
import { hostUp, useRoster } from '../src/hooks/useRoster';
import type { Roster } from '../src/types';

class FakeSse implements SseClient {
  url: string;
  onopen: ((ev?: Event) => void) | null = null;
  onerror: ((ev?: Event) => void) | null = null;
  closed = false;
  private listeners = new Map<string, Set<(e: MessageEvent) => void>>();
  constructor(url: string) {
    this.url = url;
  }
  addEventListener(type: string, l: (e: MessageEvent) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(l);
  }
  emit(type: string, data?: unknown) {
    for (const l of this.listeners.get(type) ?? []) l({ data: JSON.stringify(data ?? {}) } as MessageEvent);
  }
  isClosed() {
    return this.closed;
  }
  close() {
    this.closed = true;
  }
}

const agent = (paneId: string, cwd: string) => ({
  paneId,
  workspaceId: paneId.split(':')[0],
  tabId: `${paneId.split(':')[0]}:t1`,
  agent: 'claude',
  displayAgent: null,
  label: null,
  title: '',
  status: 'idle' as const,
  cwd,
  repoRoot: null,
  focused: false,
  launchPending: false,
  stateLabels: {},
  revision: 1,
  hasTranscript: true,
  sessionId: null,
});

const rosterOf = (host: string, agents: ReturnType<typeof agent>[]): Roster => ({
  agents,
  workspaces: agents.map((a) => ({ workspaceId: a.workspaceId, number: 1, label: a.workspaceId, focused: false, status: 'idle' as const, worktree: null })),
  tabs: [],
  updatedAt: 1000,
  host,
});

let sses: FakeSse[] = [];
let responses: Record<string, () => Response | Promise<Response>>;
let fetchLog: string[] = [];
const flush = () => act(() => vi.advanceTimersByTimeAsync(0));
const sseFor = (host: string) => sses.find((s) => s.url.includes(host) && !s.closed)!;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  vi.useFakeTimers();
  sses = [];
  fetchLog = [];
  responses = {
    'https://stormer.ts.net/api/roster': () => json(rosterOf('stormer', [agent('w2Y:p3', '/home/armen/src/x')])),
    'https://blackstar.ts.net/api/roster': () => json(rosterOf('blackstar', [agent('w19:p1', '/Users/armen/dev/y')])),
  };
  vi.stubGlobal('fetch', (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    fetchLog.push(`${init?.method ?? 'GET'} ${url}`);
    const key = url.split('?')[0];
    const r = responses[key];
    return Promise.resolve(r ? r() : json({ error: 'nope' }, 404));
  });
  setPlatform({
    openSse: (url) => {
      const s = new FakeSse(url);
      sses.push(s);
      return s;
    },
    kv: { get: () => null, set: () => {}, remove: () => {} },
    onWake: () => () => {},
    isForeground: () => true,
    notifyError: () => {},
  });
  configureServers([
    { id: 'stormer', name: 'stormer', baseUrl: 'https://stormer.ts.net', token: 'tok-s' },
    { id: 'blackstar', name: 'blackstar', baseUrl: 'https://blackstar.ts.net', token: 'tok-b' },
  ]);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('useRoster across servers', () => {
  it('opens one stream per server, each with its own token', async () => {
    renderHook(() => useRoster());
    await flush();
    expect(sses.map((s) => s.url).sort()).toEqual([
      'https://blackstar.ts.net/api/roster/stream?token=tok-b',
      'https://stormer.ts.net/api/roster/stream?token=tok-s',
    ]);
  });

  it('merges with @host on the non-primary ids only', async () => {
    const { result } = renderHook(() => useRoster());
    await flush();
    const ids = result.current.roster.agents.map((a) => `${a.paneId}/${a.workspaceId}/${a.host}`).sort();
    expect(ids).toEqual(['w19:p1@blackstar/w19@blackstar/blackstar', 'w2Y:p3/w2Y/stormer']);
    expect(result.current.roster.workspaces?.map((w) => w.workspaceId).sort()).toEqual(['w19@blackstar', 'w2Y']);
    expect(result.current.hosts.map((h) => [h.id, h.primary])).toEqual([
      ['stormer', true],
      ['blackstar', false],
    ]);
  });

  it('keeps the primary when the other box is unreachable', async () => {
    responses['https://blackstar.ts.net/api/roster'] = () => Promise.reject(new TypeError('Network request failed'));
    const { result } = renderHook(() => useRoster());
    await flush();
    act(() => sseFor('stormer').onopen?.());
    expect(result.current.roster.agents.map((a) => a.paneId)).toEqual(['w2Y:p3']);
    expect(result.current.connected).toBe(true);
    expect(result.current.authNeeded).toBe(false);
    const bs = result.current.hosts.find((h) => h.id === 'blackstar')!;
    expect(bs.connected).toBe(false);
    expect(bs.updatedAt).toBe(0);
    expect(hostUp(result.current.hosts, 'blackstar')).toBe(false);
    expect(hostUp(result.current.hosts, null)).toBe(true);
  });

  it('a fenced box flags itself without gating the app', async () => {
    responses['https://blackstar.ts.net/api/roster'] = () => json({ error: 'bad token' }, 401);
    const { result } = renderHook(() => useRoster());
    await flush();
    expect(result.current.authNeeded).toBe(false);
    expect(result.current.hosts.find((h) => h.id === 'blackstar')?.authNeeded).toBe(true);
    expect(result.current.roster.agents.map((a) => a.paneId)).toEqual(['w2Y:p3']);
  });

  it('gates only when every server fences us', async () => {
    responses['https://stormer.ts.net/api/roster'] = () => json({ error: 'bad token' }, 401);
    responses['https://blackstar.ts.net/api/roster'] = () => json({ error: 'bad token' }, 401);
    const { result } = renderHook(() => useRoster());
    await flush();
    expect(result.current.authNeeded).toBe(true);
  });

  it('applies a pushed roster from either stream', async () => {
    const { result } = renderHook(() => useRoster());
    await flush();
    act(() => sseFor('blackstar').emit('roster', rosterOf('blackstar', [agent('w19:p1', '/x'), agent('w1D:p4', '/y')])));
    expect(result.current.roster.agents.map((a) => a.paneId).sort()).toEqual(['w19:p1@blackstar', 'w1D:p4@blackstar', 'w2Y:p3']);
  });

  it('refresh re-snapshots every server', async () => {
    responses['https://stormer.ts.net/api/roster/refresh'] = () => json(rosterOf('stormer', []));
    responses['https://blackstar.ts.net/api/roster/refresh'] = () => json(rosterOf('blackstar', []));
    const { result } = renderHook(() => useRoster());
    await flush();
    await act(() => result.current.refresh());
    expect(fetchLog.filter((l) => l.startsWith('POST')).sort()).toEqual([
      'POST https://blackstar.ts.net/api/roster/refresh?token=tok-b',
      'POST https://stormer.ts.net/api/roster/refresh?token=tok-s',
    ]);
  });

  it('with no servers there is nothing to gate on', async () => {
    configureServers([]);
    const { result } = renderHook(() => useRoster());
    await flush();
    expect(result.current.roster.updatedAt).toBe(0);
    expect(result.current.authNeeded).toBe(false);
    expect(sses).toHaveLength(0);
  });
});
