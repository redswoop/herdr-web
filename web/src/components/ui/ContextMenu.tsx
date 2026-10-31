import { useMemo, type MouseEvent } from 'react';
import { Pop } from './Pop';

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

/** A row / workspace menu at a point (right-click) or under its ⋯ button:
 *  a Pop anchored by coordinates. Esc or a click outside closes it. */
export function ContextMenu({ menu, onClose }: { menu: MenuState | null; onClose: () => void }) {
  const anchor = useMemo(() => (menu ? { x: menu.x, y: menu.y } : { x: 0, y: 0 }), [menu]);
  return (
    <Pop open={!!menu} onClose={onClose} anchor={anchor} align={menu?.alignRight ? 'right' : 'left'} className="ctx-menu" role="menu">
      {menu?.title && <div className="ctx-title">{menu.title}</div>}
      {menu?.items.map((it) => (
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
    </Pop>
  );
}
