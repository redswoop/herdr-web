import { useCallback, useEffect, useState } from 'react';
import {
  DIR_SORTS,
  dirDesc,
  dirOrderLabel,
  dirOrderQuery,
  fmtSize,
  fmtStamp,
  formatDirOrder,
  nextDirOrder,
  parseDirOrder,
  getPlatform,
  type DirOrder,
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
  const [sortMenu, setSortMenu] = useState<MenuState | null>(null);
  const closeSortMenu = useCallback(() => setSortMenu(null), []);
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

  useEffect(() => {
    let gone = false;
    setInfo(null);
    setErr(null);
    setRaw(false);
    setEdit(path);
    fetch(fileUrl(path, cwd) + dirOrderQuery(order))
      .then(async (r) => {
        const j = await r.json();
        if (gone) return;
        if (!r.ok) setErr(j.error ?? r.statusText);
        else {
          setInfo(j);
          setEdit(j.path);
          onLoaded(j.path);
        }
      })
      .catch((e) => {
        if (!gone) setErr(String(e));
      });
    return () => {
      gone = true;
    };
  }, [path, cwd, order]);

  const isMd = /\.(md|markdown)$/i.test(info?.path ?? path);
  const parent = (p: string) => p.replace(/\/[^/]+\/?$/, '') || '/';
  const join = (dir: string, name: string) => `${dir === '/' ? '' : dir}/${name}`;

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
        {info?.kind === 'text' && isMd && (
          <button className="ghost file-toggle" onClick={() => setRaw((r) => !r)}>
            {raw ? 'pretty' : 'raw'}
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

        {info?.kind === 'image' && (
          <img className="file-img" src={fileUrl(info.path, null, true)} alt={info.path} />
        )}

        {info?.kind === 'video' && (
          // playsInline: iOS otherwise hijacks into its fullscreen player on tap
          <video
            className="file-video"
            src={fileUrl(info.path, null, true)}
            controls
            playsInline
            preload="metadata"
          />
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
            <div className="dir-head">
              <button
                className="dir-col dir-name dir-sort"
                aria-label="sort"
                aria-haspopup="menu"
                onClick={(e) => setSortMenu(menuAt(e, 'sort', sortItems()))}
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
          {fmtSize(info.size)} · {new Date(info.mtime).toLocaleString()}
        </footer>
      )}
      <ContextMenu menu={sortMenu} onClose={closeSortMenu} />
    </div>
  );
}
