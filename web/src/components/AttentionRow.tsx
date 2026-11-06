import { useEffect, useRef, useState } from 'react';
import { TONE_GLYPH, fmtDur, type AttentionRow as Row } from '@herdr/shared';
import { agoShort } from '../util';

// One row per thing that wants you. A sentence: what, from where, when, what
// it means, then the verbs. The body expands in place (log, full reason);
// the only thing that navigates is the labeled "open" pill.

export function AttentionRow({
  row,
  act,
  onOpenSession,
  compact,
  fresh,
}: {
  row: Row;
  act: (key: string, action: string) => Promise<unknown>;
  onOpenSession?: (paneId: string) => void;
  /** inside the chat it came from: no provenance pill, we are already there */
  compact?: boolean;
  /** new since this viewer last looked */
  fresh?: boolean;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [log, setLog] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const s = row.sig;

  const fetchLog = async () => {
    setBusy('log');
    try { setLog(String((await act(row.key, 'log') as { text?: string })?.text ?? '').trimEnd() || '(empty log)'); } catch (e) { setErr(String((e as Error).message ?? e)); } finally { setBusy(null); }
  };
  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && log == null && row.actions.includes('log')) void fetchLog();
  };
  const go = async (a: string) => {
    if (a === 'log') { if (!open) toggle(); return; }
    if (a === 'cancel' && !confirm(`cancel "${row.title}"? ${row.help.cancel ?? ''}`)) return;
    setBusy(a); setErr(null);
    try { await act(row.key, a); setPending(a === 'retry' ? 're-running' : a === 'ack' ? 'cleared' : a); } catch (e) { setErr(String((e as Error).message ?? e)); } finally { setBusy(null); }
  };

  const when = row.at ? agoShort(row.at) : null;
  const where = row.from.label
    ? (compact ? null : `from ${row.from.label}`)
    : row.from.where ? `from a finished session in ${row.from.where}` : null;
  const since = row.commitsSince ? `${row.commitsSince} commit${row.commitsSince === 1 ? '' : 's'} since` : null;
  const meaning = row.meaning ?? s.detail ?? '';
  const verbs = row.actions.filter((a) => a !== 'log');

  return (
    <div className={`arow tone-${row.tone} ${row.stale ? 'stale' : ''} ${open ? 'open' : ''} ${fresh ? 'is-fresh' : ''}`} data-key={row.key}>
      <button className="arow-body" onClick={toggle} aria-expanded={open} data-verbs={verbs.join(' ')}>
        <span className="arow-glyph">{TONE_GLYPH[row.tone]}</span>
        <span className="arow-text">
          <span className="arow-title">{row.title}</span>
          <span className="arow-ctx sub">{[where, when, since, row.stale ? 'stale' : null].filter(Boolean).join(' · ')}</span>
          {meaning && <span className="arow-meaning">{meaning}</span>}
        </span>
      </button>
      <span className="arow-verbs">
        {pending && <span className="sub arow-pending">{pending}</span>}
        {!compact && row.from.live && row.from.paneId && onOpenSession && (
          <button className="sig-session" title={`open the session: ${row.from.label}`} onClick={() => onOpenSession(row.from.paneId!)}>open · {row.from.label}</button>
        )}
        {verbs.map((a) => (
          <button key={a} className={`sig-act act-${a}`} disabled={busy != null || pending != null} title={row.help[a]} onClick={() => go(a)}>{busy === a ? '…' : a}</button>
        ))}
        {err && <span className="sig-err">{err}</span>}
      </span>
      {open && (
        <div className="arow-more">
          <div className="sub arow-facts">
            {[s.sub, s.host, s.startedAt ? `started ${agoShort(s.startedAt)}` : null, s.runMs != null ? `ran ${fmtDur(s.runMs)}` : null, s.detail && s.detail !== meaning ? s.detail : null].filter(Boolean).join(' · ')}
          </div>
          {row.actions.includes('log') && (log == null ? <div className="sub">loading log…</div> : <LogTail text={log} />)}
        </div>
      )}
    </div>
  );
}

/** the tail is the point: open scrolled to the end */
export function LogTail({ text }: { text: string }) {
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [text]);
  return <pre ref={ref} className="job-log">{text}</pre>;
}
