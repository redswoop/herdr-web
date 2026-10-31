import { useEffect, type RefObject } from 'react';

/** Close a pop when the pointer goes down outside it (or Escape). Listens on
 *  the document, so it works from inside the header: a `position: fixed`
 *  backdrop rendered there is clipped to the bar, because the bar's
 *  `backdrop-filter` makes it the containing block for fixed descendants.
 *  Pass every element that counts as "inside" — the pop and its trigger, so
 *  a tap on the trigger toggles instead of closing-then-reopening. */
export function useDismiss(open: boolean, close: () => void, ...inside: RefObject<HTMLElement | null>[]) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target;
      if (t instanceof Node && inside.some((r) => r.current?.contains(t))) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, close, ...inside]);
}
