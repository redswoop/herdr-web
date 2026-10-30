import { useCallback, useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  DIR_SORTS,
  dirDesc,
  dirOrderLabel,
  dirOrderQuery,
  fetchPlaces,
  fmtSize,
  fmtStamp,
  formatDirOrder,
  nextDirOrder,
  parseDirOrder,
  getPlatform,
  mediaSiblings,
  togglePin,
  type DirOrder,
  type Places,
} from '@herdr/shared';
import { md } from '../md';
import type { FileInfo } from '../types';
import { ContextMenu, menuAt, type MenuItem, type MenuState } from './ui/ContextMenu';

const fileUrl = (path: string, cwd: string | null, raw = false) =>
  `/api/file${raw ? '/raw' : ''}?path=${encodeURIComponent(path)}&cwd=${encodeURIComponent(cwd ?? '')}`;

// folder sort is a per-device habit, like the text sizes
const ORDER_KEY = 'herdr.dirSort';

/** Full-screen read-only view of a file on the host. Hash-routed
 *  (#/agent/<pane>/file/<path>) so back closes it; relative paths resolve
 *  against the session cwd server-side and the resolved path lands in the
 *  editable header field — a wrong cwd guess is visible and fixable in place. */
export function FileViewer({
  path,
  cwd,
  docked,
  history,
  onClose,
  onNavigate,
  onStep,
  onLoaded,
  onRemoveHist,
}: {
  path: string;
  cwd: string | null;
  /** true → fills a split pane (desktop); false → full-screen overlay (phone) */
  docked: boolean;
  /** resolved paths previously viewed in this pane, most recent first */
  history: string[];
  onClose: () => void;
  onNavigate: (path: string) => void;
  /** a sideways step to a sibling image/video: replaces the route instead of
   *  stacking it, so back still leaves the viewer in one go */
  onStep?: (path: string) => void;
  onLoaded: (resolvedPath: string) => void;
  onRemoveHist: (path: string) => void;
}) {
  const [info, setInfo] = useState<FileInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [raw, setRaw] = useState(false);
  const [edit, setEdit] = useState(path);
  const [histOpen, setHistOpen] = useState(false);
  const [order, setOrder] = useState(() => parseDirOrder(getPlatform().kv.get(ORDER_KEY)));
  const saveOrder = (o: DirOrder) => {
    setOrder(o);
    getPlatform().kv.set(ORDER_KEY, formatDirOrder(o));
  };
  const pickOrder = (key: DirOrder['sort']) => saveOrder(nextDirOrder(order, key));
  const [menu, setMenu] = useState<MenuState | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  // the whole sort lives in one menu (a fourth column won't fit a phone);
  // size/date stay as clickable column captions where the columns are
  const sortItems = (): MenuItem[] => [
    ...DIR_SORTS.map((s) => ({
      label: order.sort === s.key ? `${s.label} ${dirDesc(order) ? '↓' : '↑'}` : s.label,
      current: order.sort === s.key,
      run: () => pickOrder(s.key),
    })),
    {
      label: order.foldersFirst ? '✓ folders first' : 'folders first',
      current: order.foldersFirst,
      run: () => saveOrder({ ...order, foldersFirst: !order.foldersFirst }),
    },
  ];

  // a step through siblings keeps the current picture up until the next one's
  // meta lands (no "loading…" flash), and isn't a recent-files entry
  const steppingRef = useRef(false);
  useEffect(() => {
    let gone = false;
    const stepping = steppingRef.current;
    steppingRef.current = false;
    if (!stepping) {
      setInfo(null);
      setErr(null);
      setRaw(false);
    }
    setEdit(path);
    fetch(fileUrl(path, cwd) + dirOrderQuery(order))
      .then(async (r) => {
        const j = await r.json();
        if (gone) return;
        if (!r.ok) setErr(j.error ?? r.statusText);
        else {
          setInfo(j);
          setEdit(j.path);
          if (!stepping) onLoaded(j.path);
        }
      })
      .catch((e) => {
        if (!gone) setErr(String(e));
      });
    return () => {
      gone = true;
    };
  }, [path, cwd, order]);

  // ⌂ the session's project root + the host's pinned folders
  const [places, setPlaces] = useState<Places | null>(null);
  useEffect(() => {
    let gone = false;
    void fetchPlaces(cwd).then((p) => !gone && setPlaces(p));
    return () => {
      gone = true;
    };
  }, [cwd]);
  const here = info?.kind === 'dir' ? info.path : null;
  const pinned = !!here && !!places?.pins.some((p) => p.path === here);
  const flipPin = async (dir: string) => {
    if (!places) return;
    const pins = await togglePin(places, dir);
    if (pins) setPlaces({ ...places, pins });
    else getPlatform().notifyError('could not save pins');
  };
  const leaf = (p: string) => p.split('/').filter(Boolean).pop() || p;

  const isMd = /\.(md|markdown)$/i.test(info?.path ?? path);
  const parent = (p: string) => p.replace(/\/[^/]+\/?$/, '') || '/';
  const join = (dir: string, name: string) => `${dir === '/' ? '' : dir}/${name}`;

  // ---- images + videos: page sideways through the folder, blow up to the window
  const media = info?.kind === 'image' || info?.kind === 'video' ? info.kind : null;
  const [sibs, setSibs] = useState<{ dir: string; kind: string; items: string[] } | null>(null);
  const sibDir = media && info ? parent(info.path) : null;
  useEffect(() => {
    if (!sibDir || !media) return;
    if (sibs?.dir === sibDir && sibs.kind === media) return;
    let gone = false;
    fetch(fileUrl(sibDir, null) + dirOrderQuery(order))
      .then(async (r) => {
        const j = (await r.json()) as FileInfo;
        if (gone || !r.ok) return;
        setSibs({ dir: sibDir, kind: media, items: mediaSiblings(sibDir, j.entries ?? [], media) });
      })
      .catch(() => {});
    return () => {
      gone = true;
    };
  }, [sibDir, media, order]);
  const idx = media && sibs && sibs.dir === sibDir && sibs.kind === media ? sibs.items.indexOf(info!.path) : -1;
  const count = idx >= 0 ? sibs!.items.length : 0;
  const prevPath = idx > 0 ? sibs!.items[idx - 1] : null;
  const nextPath = idx >= 0 && idx < count - 1 ? sibs!.items[idx + 1] : null;
  const step = (to: string | null) => {
    if (!to) return;
    steppingRef.current = true;
    (onStep ?? onNavigate)(to);
  };
  // the next picture is likely next: warm it
  useEffect(() => {
    if (media === 'image' && nextPath) new Image().src = fileUrl(nextPath, null, true);
  }, [media, nextPath]);

  const [lightbox, setLightbox] = useState(false);
  useEffect(() => {
    if (info && !media) setLightbox(false);
  }, [info, media]);
  // a video keeps its playhead (and play state) across the move in or out
  const handoff = useRef<{ t: number; playing: boolean } | null>(null);
  const vidRef = useRef<HTMLVideoElement>(null);
  const toggleLightbox = (on: boolean) => {
    const v = vidRef.current;
    handoff.current = v ? { t: v.currentTime, playing: !v.paused } : null;
    setLightbox(on);
  };

  const keyRef = useRef({ prevPath, nextPath, lightbox, step, toggleLightbox });
  keyRef.current = { prevPath, nextPath, lightbox, step, toggleLightbox };
  useEffect(() => {
    if (!media) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const k = keyRef.current;
      const to = e.key === 'ArrowLeft' ? k.prevPath : e.key === 'ArrowRight' ? k.nextPath : undefined;
      if (to !== undefined) {
        e.preventDefault(); // a focused <video> would seek instead
        k.step(to);
      } else if (e.key === 'Escape' && k.lightbox) {
        e.stopPropagation(); // capture phase on window: nothing else hears this Esc
        k.toggleLightbox(false);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [media]);

  // touch: a horizontal flick steps; a drag along a video's control strip
  // (the bottom quarter) is scrubbing, not a swipe
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const swipedAt = useRef(0); // the click that ends a swipe isn't a tap
  const tap = (fn: () => void) => () => {
    if (Date.now() - swipedAt.current > 300) fn();
  };
  const swipeHandlers = {
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      if (e.pointerType === 'mouse') return;
      const r = e.currentTarget.getBoundingClientRect();
      const onVideo = (e.target as HTMLElement).tagName === 'VIDEO';
      swipe.current = onVideo && e.clientY > r.bottom - r.height / 4 ? null : { x: e.clientX, y: e.clientY };
    },
    onPointerUp: (e: PointerEvent<HTMLElement>) => {
      const s = swipe.current;
      swipe.current = null;
      if (!s) return;
      const dx = e.clientX - s.x;
      const dy = e.clientY - s.y;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        swipedAt.current = Date.now();
        step(dx < 0 ? nextPath : prevPath);
      }
    },
  };

  const mediaEl = (where: 'inline' | 'lightbox') => {
    if (!info || !media) return null;
    const src = fileUrl(info.path, null, true);
    return media === 'image' ? (
      <img
        className={where === 'inline' ? 'file-img' : 'lb-media'}
        src={src}
        alt={info.path}
        onClick={tap(() => toggleLightbox(where === 'inline'))}
      />
    ) : (
      // playsInline: iOS otherwise hijacks into its fullscreen player on tap
      <video
        key={info.path}
        ref={vidRef}
        className={where === 'inline' ? 'file-video' : 'lb-media'}
        src={src}
        controls
        playsInline
        preload="metadata"
        onLoadedMetadata={(e) => {
          const h = handoff.current;
          handoff.current = null;
          if (!h) return;
          e.currentTarget.currentTime = h.t;
          if (h.playing) void e.currentTarget.play().catch(() => {});
        }}
      />
    );
  };
  const stepper = (): ReactNode =>
    count > 1 && (
      <>
        <button className="media-step prev" aria-label="previous" disabled={!prevPath} onClick={() => step(prevPath)}>
          ‹
        </button>
        <button className="media-step next" aria-label="next" disabled={!nextPath} onClick={() => step(nextPath)}>
          ›
        </button>
      </>
    );
  const counter = count > 1 ? `${idx + 1} / ${count}` : '';

  return (
    <div className={`file-viewer ${docked ? 'docked' : ''}`}>
      <header className="bar file-bar">
        <button className="ghost file-close" aria-label="close file" onClick={onClose}>
          <span className="only-narrow">←</span>
          <span className="only-wide">✕</span>
        </button>
        <input
          className="file-path"
          value={edit}
          spellCheck={false}
          onChange={(e) => setEdit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && edit.trim()) onNavigate(edit.trim());
          }}
        />
        {places && (
          <button
            className={`ghost file-toggle file-home ${info?.path === places.home ? 'dim' : ''}`}
            aria-label="project home"
            title={places.home}
            onClick={() => onNavigate(places.home)}
          >
            ⌂
          </button>
        )}
        {info?.kind === 'text' && isMd && (
          <button className="ghost file-toggle" onClick={() => setRaw((r) => !r)}>
            {raw ? 'pretty' : 'raw'}
          </button>
        )}
        {media && (
          <button className="ghost file-toggle" aria-label="full window" onClick={() => toggleLightbox(true)}>
            ⤢
          </button>
        )}
        {(info?.kind === 'binary' || info?.kind === 'image' || info?.kind === 'video' || info?.kind === 'audio') && (
          <a className="ghost file-toggle" href={fileUrl(info.path, null, true)} download>
            ⬇
          </a>
        )}
        {history.length > 0 && (
          <button
            className={`ghost file-toggle ${histOpen ? 'on' : ''}`}
            aria-label="recently viewed"
            onClick={() => setHistOpen((o) => !o)}
          >
            🕘
          </button>
        )}
        {histOpen && history.length > 0 && (
          <>
            <div className="pop-backdrop" onClick={() => setHistOpen(false)} />
            <div className="file-hist">
              {history.map((p) => (
                <div key={p} className={`hist-row ${p === (info?.path ?? '') ? 'cur' : ''}`}>
                  <button
                    className="hist-path"
                    title={p}
                    onClick={() => {
                      setHistOpen(false);
                      onNavigate(p);
                    }}
                  >
                    {p}
                  </button>
                  <button className="hist-x" aria-label={`forget ${p}`} onClick={() => onRemoveHist(p)}>
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </header>

      <div className="scroll file-body">
        {err && <div className="empty">{err}</div>}
        {!err && !info && <div className="empty">loading…</div>}

        {info?.kind === 'text' &&
          (isMd && !raw ? (
            <div
              className="file-md"
              dangerouslySetInnerHTML={{ __html: md(info.content ?? '') }}
              onClick={(e) => {
                const a = (e.target as HTMLElement).closest('a[data-file]') as HTMLElement | null;
                if (!a?.dataset.file) return;
                e.preventDefault();
                // relative links in a document resolve against ITS directory
                const p = a.dataset.file;
                onNavigate(/^[~/]/.test(p) ? p : join(parent(info.path), p));
              }}
            />
          ) : (
            <pre className="file-pre">{info.content}</pre>
          ))}
        {info?.truncated && (
          <div className="file-note">showing first 512 KB of {fmtSize(info.size)}</div>
        )}

        {media && (
          <div className="media-stage" {...swipeHandlers}>
            {lightbox && media === 'video' ? (
              <div className="empty">playing full window</div>
            ) : (
              mediaEl('inline')
            )}
            {!lightbox && stepper()}
          </div>
        )}
        {info?.kind === 'audio' && (
          <audio className="file-audio" src={fileUrl(info.path, null, true)} controls preload="metadata" />
        )}

        {info?.kind === 'binary' && (
          <div className="empty">binary file · {fmtSize(info.size)}</div>
        )}
        {info?.kind === 'special' && <div className="empty">not a regular file</div>}

        {info?.kind === 'dir' && (
          <div className="file-dir">
            {places && (
              <nav className="places" aria-label="pinned places">
                {places.pins.map((p) => (
                  <button
                    key={p.pin}
                    className={`place ${p.path === here ? 'here' : ''}`}
                    title={p.path}
                    onClick={() => onNavigate(p.path)}
                    onContextMenu={(e) =>
                      setMenu(menuAt(e, p.pin, [{ label: 'Unpin', danger: true, run: () => void flipPin(p.path) }]))
                    }
                  >
                    ★ {leaf(p.pin)}
                  </button>
                ))}
                <button
                  className={`place pin ${pinned ? 'on' : ''}`}
                  aria-pressed={pinned}
                  onClick={() => void flipPin(info.path)}
                >
                  {pinned ? '★ pinned' : '☆ pin this folder'}
                </button>
              </nav>
            )}
            <div className="dir-head">
              <button
                className="dir-col dir-name dir-sort"
                aria-label="sort"
                aria-haspopup="menu"
                onClick={(e) => setMenu(menuAt(e, 'sort', sortItems()))}
              >
                ⇅ {dirOrderLabel(order)}
                {!order.foldersFirst && <span className="dir-mix"> · folders mixed</span>}
              </button>
              {DIR_SORTS.filter((s) => s.key === 'size' || s.key === 'mtime').map((s) => (
                <button
                  key={s.key}
                  className={`dir-col dir-${s.key} ${order.sort === s.key ? 'on' : ''}`}
                  aria-label={`sort by ${s.label}`}
                  onClick={() => pickOrder(s.key)}
                >
                  {s.label}
                  {order.sort === s.key && <span className="dir-arrow">{dirDesc(order) ? '↓' : '↑'}</span>}
                </button>
              ))}
            </div>
            {info.path !== '/' && (
              <button className="dir-row" onClick={() => onNavigate(parent(info.path))}>
                <span className="dir-name">
                  <span className="file-ico">📁</span> ..
                </span>
              </button>
            )}
            {info.entries?.map((e) => (
              <button key={e.name} className="dir-row" onClick={() => onNavigate(join(info.path, e.name))}>
                <span className="dir-name" title={e.name}>
                  <span className="file-ico">{e.dir ? '📁' : '📄'}</span> {e.name}
                  {e.dir ? '/' : ''}
                </span>
                <span className="dir-size">{e.dir ? '' : fmtSize(e.size)}</span>
                <span className="dir-mtime" title={e.mtime ? new Date(e.mtime).toLocaleString() : ''}>
                  {fmtStamp(e.mtime)}
                </span>
              </button>
            ))}
            {info.clipped && <div className="file-note">listing clipped at 1000 entries</div>}
          </div>
        )}
      </div>

      {info && info.kind !== 'dir' && (
        <footer className="file-meta">
          {counter && <span className="media-count">{counter} · </span>}
          {fmtSize(info.size)} · {new Date(info.mtime).toLocaleString()}
        </footer>
      )}
      {lightbox &&
        media &&
        info &&
        // under one wrapper, like ContextMenu: skins restyle body's children
        createPortal(
          <div className="ctx-layer">
            <div className="lightbox" role="dialog" aria-label="full window" {...swipeHandlers}>
              <div className="lb-backdrop" onClick={tap(() => toggleLightbox(false))} />
              {mediaEl('lightbox')}
              <div className="lb-top">
                <span className="lb-name" title={info.path}>
                  {info.path.split('/').pop()}
                  {counter && <span className="lb-count"> · {counter}</span>}
                </span>
                <button className="lb-close" aria-label="close full window" onClick={() => toggleLightbox(false)}>
                  ✕
                </button>
              </div>
              {stepper()}
            </div>
          </div>,
          document.body,
        )}
      <ContextMenu menu={menu} onClose={closeMenu} />
    </div>
  );
}
