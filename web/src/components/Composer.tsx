import { useEffect, useRef, useState } from 'react';
import { agentPath, errorOf, post } from '../api';
import type { RestoredDraft } from '../types';

/** `path` is the server-side file; null while the upload is in flight. */
type Attachment = { id: number; path: string | null; url: string };
let nextAttId = 1;

/** POSTs the image bytes; resolves to the server-side file path. */
async function uploadImage(file: File): Promise<string> {
  const r = await fetch('/api/upload', {
    method: 'POST',
    headers: { 'content-type': file.type },
    body: file,
  });
  if (!r.ok) throw new Error(await errorOf(r));
  return (await r.json()).path;
}

// Drafts persist per pane: iOS evicts a backgrounded PWA page (e.g. while
// copying the next image in Photos), and the silent reload would eat any
// in-memory draft. Images upload the moment they're added, so all a chip
// needs to survive is its server path — previews restore off /api/file/raw.
const rawUrl = (p: string) => `/api/file/raw?path=${encodeURIComponent(p)}&cwd=`;
const attKey = (paneId: string) => `herdr.attDraft.${paneId}`;
const textKey = (paneId: string) => `herdr.textDraft.${paneId}`;

function loadAtts(paneId: string): Attachment[] {
  try {
    const j = JSON.parse(localStorage.getItem(attKey(paneId)) ?? '[]');
    if (!Array.isArray(j)) return [];
    return j
      .filter((p): p is string => typeof p === 'string')
      .map((p) => ({ id: nextAttId++, path: p, url: rawUrl(p) }));
  } catch {
    return [];
  }
}

function persistAtts(paneId: string, atts: Attachment[]) {
  try {
    const paths = atts.filter((a) => a.path).map((a) => a.path);
    if (paths.length) localStorage.setItem(attKey(paneId), JSON.stringify(paths));
    else localStorage.removeItem(attKey(paneId));
  } catch {}
}

function persistText(paneId: string, text: string) {
  try {
    if (text) localStorage.setItem(textKey(paneId), text);
    else localStorage.removeItem(textKey(paneId));
  } catch {}
}

const KEYS = [
  ['esc', 'Escape'],
  ['↑', 'Up'],
  ['↓', 'Down'],
  ['←', 'Left'],
  ['→', 'Right'],
  ['⏎', 'Enter'],
  ['y', 'y'],
  ['n', 'n'],
  ['^C', 'C-c'],
] as const;

export function Composer({
  paneId,
  working,
  cooldown,
  restoredDraft,
  showKeys,
  onSend,
  onInterrupt,
  onToggleKeys,
  onKeyTap,
}: {
  paneId: string;
  working: boolean;
  cooldown: boolean;
  restoredDraft: RestoredDraft | null;
  showKeys: boolean;
  onSend: (text: string) => Promise<void>;
  onInterrupt: () => void;
  onToggleKeys: () => void;
  /** a strip key landed on the TUI — lets the screen mirror refresh at once */
  onKeyTap?: () => void;
}) {
  const [text, setTextState] = useState(() => localStorage.getItem(textKey(paneId)) ?? '');
  const [atts, setAtts] = useState<Attachment[]>(() => loadAtts(paneId));
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const paneRef = useRef(paneId);
  paneRef.current = paneId;

  // blob previews leak if the component unmounts with chips still up
  const attsRef = useRef(atts);
  attsRef.current = atts;
  useEffect(
    () => () => {
      for (const a of attsRef.current) if (a.url.startsWith('blob:')) URL.revokeObjectURL(a.url);
    },
    [],
  );

  const setText = (t: string) => {
    setTextState(t);
    persistText(paneId, t);
  };

  // pane switched — this component instance survives, so swap drafts by hand
  const prevPane = useRef(paneId);
  useEffect(() => {
    if (prevPane.current === paneId) return;
    prevPane.current = paneId;
    setTextState(localStorage.getItem(textKey(paneId)) ?? '');
    setAtts(loadAtts(paneId));
    requestAnimationFrame(grow);
  }, [paneId]);

  const hasText = !!text.trim();
  const uploading = atts.some((a) => !a.path);
  const hasDraft = hasText || atts.length > 0;
  const stop = !hasDraft && working;

  /** functional update + persist to the pane the mutation belongs to */
  const mutateAtts = (pane: string, fn: (cur: Attachment[]) => Attachment[] | null) => {
    setAtts((cur) => {
      const next = fn(cur);
      if (next === null) return cur; // stale mutation (pane switched) — drop it
      persistAtts(pane, next);
      return next;
    });
  };

  const addFiles = (files: File[]) => {
    // mirror the server's whitelist — a rejected type should never make a chip
    const imgs = files.filter((f) =>
      ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(f.type),
    );
    if (!imgs.length) return;
    const pane = paneId;
    for (const file of imgs) {
      const id = nextAttId++;
      setAtts((cur) => [...cur, { id, path: null, url: URL.createObjectURL(file) }]);
      // upload NOW, not at send — a chip whose bytes are already on the server
      // survives the page being evicted while the user fetches the next image
      uploadImage(file).then(
        (path) => mutateAtts(pane, (cur) => (cur.some((a) => a.id === id)
          ? cur.map((a) => (a.id === id ? { ...a, path } : a))
          : null)),
        (e) => {
          mutateAtts(pane, (cur) => (cur.some((a) => a.id === id)
            ? cur.filter((a) => a.id !== id)
            : null));
          alert(`image upload failed: ${String((e as Error).message ?? e)}`);
        },
      );
    }
  };

  const removeAtt = (id: number) => {
    mutateAtts(paneId, (cur) => {
      const gone = cur.find((a) => a.id === id);
      if (gone?.url.startsWith('blob:')) URL.revokeObjectURL(gone.url);
      return cur.filter((a) => a.id !== id);
    });
  };

  const grow = () => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, innerHeight * 0.3)}px`;
  };

  // a stopped prompt comes back filled + select-all'd (URL-bar style: typing
  // replaces it, tapping in edits it) — unless a new draft is already typed
  useEffect(() => {
    if (!restoredDraft) return;
    setTextState((cur) => {
      const next = cur.trim() ? cur : restoredDraft.text;
      persistText(paneId, next);
      return next;
    });
    requestAnimationFrame(() => {
      grow();
      const ta = taRef.current;
      if (ta && ta.value === restoredDraft.text) {
        ta.focus();
        ta.select();
      }
    });
  }, [restoredDraft]);

  const send = async () => {
    const t = text.trim();
    const sending = atts;
    if ((!t && !sending.length) || uploading) return;
    const pane = paneId;
    setText('');
    mutateAtts(pane, () => []);
    requestAnimationFrame(grow);
    // a slash command means a TUI dialog is coming — on touch devices, drop
    // the phone keyboard so the key strip and screen mirror aren't buried
    // behind it (desktop keeps focus for the next keystroke)
    if (t.startsWith('/') && matchMedia('(pointer: coarse)').matches) taRef.current?.blur();
    // bytes are already on the server — the prompt just references the paths
    const full = [t, ...sending.map((a) => `[pasted image: ${a.path}]`)]
      .filter(Boolean)
      .join('\n');
    try {
      await onSend(full);
      for (const a of sending) if (a.url.startsWith('blob:')) URL.revokeObjectURL(a.url);
    } catch (e) {
      // put the draft back, images included — into the pane it was typed for,
      // which may no longer be the one on screen
      if (paneRef.current === pane) {
        setTextState(t);
        mutateAtts(pane, () => sending);
      } else {
        persistAtts(pane, sending);
      }
      persistText(pane, t);
      alert(String((e as Error).message ?? e));
    }
  };

  const sendKeys = async (key: string) => {
    const r = await post(agentPath(paneId, 'keys'), { keys: [key] });
    if (!r.ok) alert(await errorOf(r));
    else onKeyTap?.();
  };

  return (
    <footer
      className="composer"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) e.preventDefault();
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        addFiles([...e.dataTransfer.files]);
      }}
    >
      {atts.length > 0 && (
        <div className="attrow">
          {atts.map((a) => (
            <div key={a.id} className={`att ${a.path ? '' : 'uploading'}`}>
              <img src={a.url} alt="" />
              <button
                className="att-x"
                aria-label="remove image"
                onClick={() => removeAtt(a.id)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      {showKeys && (
        <div className="keysrow">
          {KEYS.map(([label, key]) => (
            <button key={key} onClick={() => sendKeys(key)}>
              {label}
            </button>
          ))}
        </div>
      )}
      <div className="inputrow">
        <button className="ghost kbd-toggle" aria-label="toggle key pad" onClick={onToggleKeys}>
          ⌨
        </button>
        <button
          className="ghost attach"
          aria-label="attach image"
          onClick={() => fileRef.current?.click()}
        >
          <svg
            viewBox="0 0 24 24"
            width="19"
            height="19"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="3" width="18" height="18" rx="3" />
            <circle cx="8.5" cy="8.5" r="1.7" />
            <path d="M21 15.5l-4.8-4.8L5.5 21" />
          </svg>
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          multiple
          hidden
          onChange={(e) => {
            addFiles([...(e.target.files ?? [])]);
            e.target.value = ''; // same file re-pickable
          }}
        />
        <div className={`ta-wrap ${hasText ? 'has-clear' : ''}`}>
          <textarea
            ref={taRef}
            rows={1}
            placeholder="prompt…"
            autoCapitalize="off"
            autoComplete="off"
            enterKeyHint="send"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              grow();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
            onPaste={(e) => {
              const files = [...e.clipboardData.items]
                .filter((i) => i.kind === 'file')
                .map((i) => i.getAsFile())
                .filter((f): f is File => !!f);
              if (!files.length) return;
              e.preventDefault(); // an image copied from a page brings html alt-text along — drop it
              addFiles(files);
            }}
          />
          {hasText && (
            <button
              className="ta-clear"
              aria-label="clear draft"
              onMouseDown={(e) => e.preventDefault() /* keep the textarea focused */}
              onClick={() => {
                setText('');
                requestAnimationFrame(grow);
                taRef.current?.focus();
              }}
            >
              <svg viewBox="0 0 24 24" width="18" height="18">
                <circle cx="12" cy="12" r="10" fill="currentColor" opacity="0.55" />
                <path
                  d="M9 9l6 6M15 9l-6 6"
                  stroke="var(--surface-2)"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          )}
        </div>
        <button
          className={`send ${stop ? 'stop' : ''}`}
          aria-label={stop ? 'stop' : 'send'}
          disabled={stop ? cooldown : !hasDraft || uploading}
          onClick={stop ? onInterrupt : send}
        >
          {stop ? (
            <svg viewBox="0 0 24 24" width="20" height="20">
              <rect x="5.5" y="5.5" width="13" height="13" rx="2.5" fill="currentColor" />
            </svg>
          ) : (
            <svg
              viewBox="0 0 24 24"
              width="20"
              height="20"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          )}
        </button>
      </div>
    </footer>
  );
}
