// @vitest-environment jsdom
/**
 * useAgentSession reconnect state machine — the logic every client (web AND
 * mobile) rides on. Previously untested. Pins the invariants the comments in
 * the hook promise:
 *   • SSE error / server `reset` / stale watchdog → gen bump → full reload
 *   • a reload NEVER duplicates session-file events
 *   • local-only items (salvage, ⏹ divider) and unconfirmed mine bubbles
 *     survive a same-pane reconnect; a pane switch resets everything
 *   • the transport is never allowed to auto-reconnect (offset replay)
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setPlatform, type SseClient } from '../src/platform';
import { useAgentSession } from '../src/hooks/useAgentSession';
import type { TEvent } from '../src/types';

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
  removeEventListener(type: string, l: (e: MessageEvent) => void) {
    this.listeners.get(type)?.delete(l);
  }
  emit(type: string, data?: unknown) {
    for (const l of this.listeners.get(type) ?? []) {
      l({ data: data === undefined ? '' : JSON.stringify(data) } as MessageEvent);
    }
  }
  isClosed() {
    return this.closed;
  }
  close() {
    this.closed = true;
  }
}

let sses: FakeSse[] = [];
let transcript: { events: TEvent[]; offset: number };
let fetchLog: string[] = [];

const flush = () => act(() => vi.advanceTimersByTimeAsync(0));
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
const lastSse = () => sses[sses.length - 1];

const userEv = (text: string): TEvent => ({ kind: 'user', text } as TEvent);
const asstEv = (text: string): TEvent => ({ kind: 'assistant', text } as TEvent);

const textsOf = (items: ReturnType<typeof useAgentSession>['items']) =>
  items.map((it) => (it.type === 'mine' ? `mine:${it.mine.text}` : `${it.ev.kind}:${it.ev.text}`));

beforeEach(() => {
  vi.useFakeTimers();
  sses = [];
  fetchLog = [];
  transcript = { events: [userEv('hello'), asstEv('hi there')], offset: 100 };
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
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      fetchLog.push(`${init?.method ?? 'GET'} ${url}`);
      if (url.includes('/transcript')) {
        return new Response(JSON.stringify(transcript), { status: 200 });
      }
      if (url.includes('/prompt')) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('useAgentSession', () => {
  it('loads the transcript and opens the stream at the returned offset', async () => {
    const { result } = renderHook(() => useAgentSession('w1:p1', 'idle', 'grok'));
    await flush();
    expect(result.current.loaded).toBe(true);
    expect(textsOf(result.current.items)).toEqual(['user:hello', 'assistant:hi there']);
    expect(sses).toHaveLength(1);
    expect(lastSse().url).toContain('offset=100');
  });

  it('applies streamed events on top of the loaded transcript', async () => {
    const { result } = renderHook(() => useAgentSession('w1:p1', 'working', 'grok'));
    await flush();
    await act(async () => lastSse().emit('events', [asstEv('streamed bit')]));
    expect(textsOf(result.current.items)).toContain('assistant:streamed bit');
  });

  it('SSE error → clean reload after a beat, with no duplicated events', async () => {
    const { result } = renderHook(() => useAgentSession('w1:p1', 'idle', 'grok'));
    await flush();
    const first = lastSse();
    await act(async () => first.onerror?.());
    expect(first.isClosed()).toBe(true); // never auto-reconnects the transport
    await advance(2600); // the 2.5s retry
    await flush();
    expect(sses).toHaveLength(2); // a NEW stream, fresh offset — not a resume
    expect(fetchLog.filter((f) => f.includes('/transcript'))).toHaveLength(2);
    // the reloaded file re-delivers the same two events — exactly once
    expect(textsOf(result.current.items)).toEqual(['user:hello', 'assistant:hi there']);
  });

  it('server reset event forces a full reload', async () => {
    renderHook(() => useAgentSession('w1:p1', 'idle', 'grok'));
    await flush();
    await act(async () => lastSse().emit('reset'));
    await flush();
    expect(fetchLog.filter((f) => f.includes('/transcript'))).toHaveLength(2);
    expect(sses).toHaveLength(2);
  });

  it('local-only items (salvage, ⏹) survive a same-pane reconnect', async () => {
    const { result } = renderHook(() => useAgentSession('w1:p1', 'idle', 'grok'));
    await flush();
    await act(async () => {
      result.current.inject([
        { kind: 'salvage', text: 'screen residue' } as TEvent,
        { kind: 'interrupted', text: '' } as TEvent,
      ]);
    });
    await act(async () => lastSse().emit('reset'));
    await flush();
    const texts = textsOf(result.current.items);
    expect(texts.filter((t) => t === 'salvage:screen residue')).toHaveLength(1);
    expect(texts.filter((t) => t.startsWith('interrupted'))).toHaveLength(1);
    // and the file events came back exactly once
    expect(texts.filter((t) => t === 'user:hello')).toHaveLength(1);
  });

  it('an unconfirmed mine survives reconnect and reconciles against the reload', async () => {
    const { result } = renderHook(() => useAgentSession('w1:p1', 'working', 'grok'));
    await flush();
    await act(async () => {
      await result.current.send('do the thing');
    });
    expect(textsOf(result.current.items)).toContain('mine:do the thing');
    // the prompt lands in the session file while we reconnect
    transcript = {
      events: [...transcript.events, userEv('do the thing')],
      offset: 160,
    };
    await act(async () => lastSse().emit('reset'));
    await flush();
    const texts = textsOf(result.current.items);
    // ONE bubble for the prompt — the mine reconciled with its file event,
    // not a mine + a duplicate user row
    expect(texts.filter((t) => t.endsWith(':do the thing'))).toHaveLength(1);
  });

  it('stale-stream watchdog reconnects after 30s of silence', async () => {
    renderHook(() => useAgentSession('w1:p1', 'idle', 'grok'));
    await flush();
    expect(sses).toHaveLength(1);
    await advance(45_000); // no pings arrive; 10s watchdog crosses the 30s bar
    await flush();
    expect(sses.length).toBeGreaterThanOrEqual(2);
    // pings keep it alive: fresh stream, keep bumping
    const es = lastSse();
    for (let i = 0; i < 4; i += 1) {
      await advance(9_000);
      await act(async () => es.emit('ping'));
    }
    const count = sses.length;
    await advance(9_000);
    await act(async () => es.emit('ping'));
    expect(sses.length).toBe(count); // no spurious reconnects while pinged
  });

  it('a pane switch resets everything instead of merging', async () => {
    const { result, rerender } = renderHook(
      ({ pane }: { pane: string }) => useAgentSession(pane, 'idle', 'grok'),
      { initialProps: { pane: 'w1:p1' } },
    );
    await flush();
    await act(async () => {
      result.current.inject([{ kind: 'salvage', text: 'old pane residue' } as TEvent]);
    });
    transcript = { events: [userEv('other pane history')], offset: 40 };
    rerender({ pane: 'w1:p2' });
    await flush();
    const texts = textsOf(result.current.items);
    expect(texts).toEqual(['user:other pane history']); // no bleed-through
  });
});
