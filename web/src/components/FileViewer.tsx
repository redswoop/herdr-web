import { useEffect, useState } from 'react';
import { md } from '../md';
import type { FileInfo } from '../types';

const fileUrl = (path: string, cwd: string | null, raw = false) =>
  `/api/file${raw ? '/raw' : ''}?path=${encodeURIComponent(path)}&cwd=${encodeURIComponent(cwd ?? '')}`;

/** Full-screen read-only view of a file on the host. Hash-routed
 *  (#/agent/<pane>/file/<path>) so back closes it; relative paths resolve
 *  against the session cwd server-side and the resolved path lands in the
 *  editable header field — a wrong cwd guess is visible and fixable in place. */
export function FileViewer({
  path,
  cwd,
  history,
  onClose,
  onNavigate,
  onLoaded,
  onRemoveHist,
}: {
  path: string;
  cwd: string | null;
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

  useEffect(() => {
    let gone = false;
    setInfo(null);
    setErr(null);
    setRaw(false);
    setEdit(path);
    fetch(fileUrl(path, cwd))
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
  }, [path, cwd]);

  const isMd = /\.(md|markdown)$/i.test(info?.path ?? path);
  const parent = (p: string) => p.replace(/\/[^/]+\/?$/, '') || '/';
  const join = (dir: string, name: string) => `${dir === '/' ? '' : dir}/${name}`;

  return (
    <div className="file-viewer">
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
        {(info?.kind === 'binary' || info?.kind === 'image') && (
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

        {info?.kind === 'binary' && (
          <div className="empty">binary file · {fmtSize(info.size)}</div>
        )}
        {info?.kind === 'special' && <div className="empty">not a regular file</div>}

        {info?.kind === 'dir' && (
          <div className="file-dir">
            {info.path !== '/' && (
              <button onClick={() => onNavigate(parent(info.path))}>
                <span className="file-ico">📁</span> ..
              </button>
            )}
            {info.entries?.map((e) => (
              <button key={e.name} onClick={() => onNavigate(join(info.path, e.name))}>
                <span className="file-ico">{e.dir ? '📁' : '📄'}</span> {e.name}
                {e.dir ? '/' : ''}
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
    </div>
  );
}

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
