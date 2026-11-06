import { useEffect, useMemo, useRef } from 'react';

// "New since you last looked": a per-viewer map of id -> the version last
// seen, in localStorage. An id is new when its version differs from what was
// seen; it is marked seen a moment after it has been on screen.
const KEY = 'herdr.seen';
const load = (): Record<string, string> => { try { return JSON.parse(localStorage.getItem(KEY) ?? '{}'); } catch { return {}; } };

export function useSeen(items: { id: string; version: string }[], dwellMs = 4000): Set<string> {
  const seenRef = useRef<Record<string, string>>(load());
  const fresh = useMemo(() => {
    const s = new Set<string>();
    for (const it of items) if (seenRef.current[it.id] !== it.version) s.add(it.id);
    return s;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.map((i) => `${i.id}=${i.version}`).join('|')]);
  useEffect(() => {
    if (!fresh.size) return;
    const t = setTimeout(() => {
      const next = { ...seenRef.current };
      for (const it of items) next[it.id] = it.version;
      // keep it bounded
      const keys = Object.keys(next);
      if (keys.length > 400) for (const k of keys.slice(0, keys.length - 400)) delete next[k];
      seenRef.current = next;
      try { localStorage.setItem(KEY, JSON.stringify(next)); } catch {}
    }, dwellMs);
    return () => clearTimeout(t);
  }, [fresh, items, dwellMs]);
  return fresh;
}
