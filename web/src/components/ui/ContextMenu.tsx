import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';

export interface MenuItem {
  label: string;
  danger?: boolean;
  /** the picked one in a choice list */
  current?: boolean;
  run: () => void;
}

export interface MenuState {
  x: number;
  y: number;
  /** ⋯ button: the menu's right edge sits at x (under the button) */
  alignRight?: boolean;
  title?: string;
  items: MenuItem[];
}

/** Where a menu opens: at the pointer for a right-click, under the button for
 *  a ⋯ click. Swallows the event so the row underneath doesn't also fire. */
export function menuAt(e: MouseEvent<HTMLElement>, title: string, items: MenuItem[]): MenuState {
  e.preventDefault();
  e.stopPropagation();
  if (e.type === 'contextmenu') return { x: e.clientX, y: e.clientY, title, items };
  const r = e.currentTarget.getBoundingClientRect();
  return { x: r.right, y: r.bottom + 4, alignRight: true, title, items };
}

/** A small popover menu (the .mode-pop look, so skins dress it for free),
 *  portalled to <body> and kept inside the viewport. Esc or a click outside
 *  closes it. */
export function ContextMenu({ menu, onClose }: { menu: MenuState | null; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!menu || !ref.current) return setPos(null);
    const { width, height } = ref.current.getBoundingClientRect();
    const left = Math.max(8, Math.min(menu.alignRight ? menu.x - width : menu.x, innerWidth - width - 8));
    const top = menu.y + height > innerHeight - 8 ? Math.max(8, menu.y - height) : menu.y;
    setPos({ left, top });
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menu, onClose]);

  if (!menu) return null;
  // one wrapper under <body>: skins may restyle body's direct children
  // (CyberDOS lifts them over its rain with position: relative), which would
  // un-fix the menu itself
  return createPortal(
    <div className="ctx-layer">
      <div
        className="pop-backdrop"
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div
        ref={ref}
        className="mode-pop ctx-menu"
        role="menu"
        style={pos ?? { left: menu.x, top: menu.y, visibility: 'hidden' }}
      >
        {menu.title && <div className="ctx-title">{menu.title}</div>}
        {menu.items.map((it) => (
          <button
            key={it.label}
            role="menuitem"
            className={`mode-row ${it.danger ? 'danger' : ''} ${it.current ? 'current' : ''}`}
            onClick={() => {
              onClose();
              it.run();
            }}
          >
            <span className="mode-name">{it.label}</span>
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}
