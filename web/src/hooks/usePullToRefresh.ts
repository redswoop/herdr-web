import { useEffect, useRef, useState, type RefObject } from 'react';

const TRIGGER = 64; // px of (damped) pull that arms a refresh
const MAX = 96;

/** Touch pull-down at the top of a scroller → onRefresh. iOS standalone
 *  PWAs have no native pull-to-refresh, and a full reload would be the wrong
 *  thing anyway: this re-snapshots the roster in place. Returns the current
 *  pull distance so the caller can draw the indicator. */
export function usePullToRefresh(
  ref: RefObject<HTMLElement | null>,
  onRefresh: () => Promise<unknown>,
): { pull: number; armed: boolean; busy: boolean } {
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  const cb = useRef(onRefresh);
  cb.current = onRefresh;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let startY: number | null = null;
    let dist = 0;
    const onStart = (e: TouchEvent) => {
      // only a pull that begins at the very top counts — mid-list drags scroll
      startY = el.scrollTop <= 0 && e.touches.length === 1 ? e.touches[0].clientY : null;
      dist = 0;
    };
    const onMove = (e: TouchEvent) => {
      if (startY === null) return;
      const dy = e.touches[0].clientY - startY;
      if (dy <= 0 || el.scrollTop > 0) {
        if (dist) setPull((dist = 0));
        return;
      }
      e.preventDefault(); // we own this gesture now — no rubber-band underneath
      dist = Math.min(MAX, dy * 0.5);
      setPull(dist);
    };
    const onEnd = () => {
      if (startY === null) return;
      startY = null;
      const fire = dist >= TRIGGER;
      setPull((dist = 0));
      if (!fire) return;
      setBusy(true);
      cb.current().finally(() => setBusy(false));
    };
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, [ref]);

  return { pull, armed: pull >= TRIGGER, busy };
}
