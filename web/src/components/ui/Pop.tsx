import { useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';

/** The one popover: a `.mode-pop` box hung off an anchor (an element's
 *  ref, or a point for context menus), rendered in the browser's top layer
 *  via the Popover API so no ancestor's z-index, overflow or backdrop-filter
 *  can clip it. Controlled by `open`; a pointer down outside it (and
 *  outside its anchor, so the trigger toggles instead of close-then-reopen)
 *  or Escape calls `onClose`. The box is kept inside the viewport and flips
 *  above the anchor when there is no room below. */
export type PopAnchor = RefObject<HTMLElement | null> | { x: number; y: number };

export function Pop({
  open,
  onClose,
  anchor,
  align = 'left',
  className = '',
  role,
  children,
}: {
  open: boolean;
  onClose: () => void;
  anchor: PopAnchor;
  /** which edge of the box lines up with the anchor */
  align?: 'left' | 'right';
  className?: string;
  role?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!open || !el) return;
    try {
      el.showPopover();
    } catch {
      /* already shown, or no Popover API: it still renders, just not in the top layer */
    }
    // a popover is display:none until shown, so React's autoFocus on a child
    // ran too early: mark the field data-autofocus and focus it now
    el.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    const { width, height } = el.getBoundingClientRect();
    let x: number;
    let y: number;
    if ('current' in anchor) {
      const r = anchor.current?.getBoundingClientRect();
      if (!r) return;
      x = align === 'right' ? r.right - width : r.left;
      y = r.bottom + 6;
    } else {
      x = align === 'right' ? anchor.x - width : anchor.x;
      y = anchor.y;
    }
    const left = Math.max(8, Math.min(x, innerWidth - width - 8));
    const top = y + height > innerHeight - 8 ? Math.max(8, y - height - 6) : y;
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }, [open, anchor, align]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target;
      if (!(t instanceof Node)) return;
      if (ref.current?.contains(t)) return;
      if ('current' in anchor && anchor.current?.contains(t)) return;
      closeRef.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, anchor]);

  if (!open) return null;
  return (
    <div ref={ref} popover="manual" className={`mode-pop ${className}`} role={role}>
      {children}
    </div>
  );
}
