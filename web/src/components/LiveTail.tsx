import { useEffect, useRef, useState } from 'react';
import { stripChrome } from '@herdr/shared';
import { agentPath } from '../api';
import type { ModeState } from '../types';

const OPEN_KEY = 'herdr.liveTail';

/**
 * Live tail of the TUI screen while the agent is working. The session file
 * only receives content when a message/tool block COMPLETES, so long turns
 * stream on the terminal minutes before the transcript can show them — this
 * is the honest window into that gap: the actual screen, polled.
 */
export function LiveTail({
  paneId,
  onMode,
}: {
  paneId: string;
  /** the /screen payload carries the footer-parsed permission mode — feed it
   *  to the mode chip so it stays live while the agent works */
  onMode?: (mode: ModeState) => void;
}) {
  const [open, setOpen] = useState(() => localStorage.getItem(OPEN_KEY) !== 'closed');
  const [text, setText] = useState<string | null>(null);
  const preRef = useRef<HTMLPreElement>(null);

  const toggle = () => {
    setOpen((o) => {
      localStorage.setItem(OPEN_KEY, o ? 'closed' : 'open');
      return !o;
    });
  };

  useEffect(() => {
    if (!open) {
      setText(null);
      return;
    }
    let alive = true;
    const tick = async () => {
      try {
        const r = await fetch(agentPath(paneId, 'screen'));
        if (!r.ok || !alive) return;
        const { text: raw, mode } = (await r.json()) as { text: string; mode?: ModeState };
        if (!alive) return;
        if (mode) onMode?.(mode);
        // grok paints a █ scrollbar column on the right edge — pure noise here
        const lines = (raw ?? '').split('\n').map((l: string) => l.replace(/\s*█\s*$/, ''));
        const end = stripChrome(lines);
        setText(lines.slice(0, end).join('\n').replace(/\n{3,}/g, '\n\n').trimEnd());
      } catch {}
    };
    tick();
    const t = setInterval(tick, 1200);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [paneId, open, onMode]);

  useEffect(() => {
    const el = preRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [text]);

  return (
    <div className="live-tail">
      <button className="live-tail-head" onClick={toggle}>
        <span className="live-dot" />
        <span className="live-tail-title">live screen</span>
        <span className="sub">
          {open ? 'streaming from the TUI — transcript catches up as steps complete' : 'tap to watch the TUI while it works'}
        </span>
        <span className="live-tail-chev">{open ? '▾' : '▸'}</span>
      </button>
      {open && text !== null && (
        <pre className="screen live-tail-screen" ref={preRef}>
          {text}
        </pre>
      )}
    </div>
  );
}
