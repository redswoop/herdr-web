import { useEffect, useState } from 'react';
import { post } from '../api';
import type { SessionEntry } from '../types';

const ago = (ms: number) => {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86_400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86_400)}d ago`;
};

/** Local override for /resume typed in the composer: past claude sessions for
 *  this pane's cwd, resumed into a NEW pane (a live session can't swap its own
 *  transcript out from under itself). Rows already bound to a live pane jump
 *  there instead of resuming twice. */
export function ResumeCard({
  cwd,
  selfPaneId,
  onGo,
  onClose,
}: {
  cwd: string;
  selfPaneId: string;
  onGo: (paneId: string) => void;
  onClose: () => void;
}) {
  const [sessions, setSessions] = useState<SessionEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let dead = false;
    fetch(`/api/sessions?cwd=${encodeURIComponent(cwd)}`)
      .then((r) => (r.ok ? r.json() : r.json().then((j) => Promise.reject(new Error(j.error)))))
      .then((j: { sessions: SessionEntry[] }) => {
        if (!dead) setSessions(j.sessions);
      })
      .catch((e) => {
        if (!dead) setError(String((e as Error).message ?? e));
      });
    return () => {
      dead = true;
    };
  }, [cwd]);

  const resume = async (s: SessionEntry) => {
    setBusy(s.sessionId);
    try {
      const r = await post('/api/chats', {
        kind: 'claude',
        cwd,
        resume: s.sessionId,
        // inherit the session's title so the tab reads right
        name: s.title ?? undefined,
        label: s.title ?? undefined,
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? r.statusText);
      onGo(j.paneId as string);
    } catch (e) {
      alert(String((e as Error).message ?? e));
      setBusy(null);
    }
  };

  // this pane's own session would "jump" to itself — not a resume, drop it
  const rows = sessions?.filter((s) => s.livePaneId !== selfPaneId);

  return (
    <div className="blocked-card resume-card">
      <div className="question">
        <div className="q-text">⏵ resume a session — opens a new pane</div>
        {rows === undefined && !error && <div className="sub">loading sessions…</div>}
        {error && <div className="sub">{error}</div>}
        {rows && rows.length === 0 && <div className="sub">no other sessions here</div>}
        {rows?.map((s) => (
          <button
            key={s.sessionId}
            className={`option ${busy === s.sessionId ? 'busy' : ''}`}
            disabled={busy !== null}
            onClick={() => (s.livePaneId ? onGo(s.livePaneId) : resume(s))}
          >
            <span className="opt-label">
              {s.title ?? s.firstPrompt ?? s.sessionId.slice(0, 8)}
            </span>
            <span className="opt-desc">
              {s.livePaneId ? 'live — jump to it' : ago(s.mtime)}
            </span>
          </button>
        ))}
        <button className="option deny" disabled={busy !== null} onClick={onClose}>
          <span className="opt-label">cancel</span>
        </button>
      </div>
    </div>
  );
}
