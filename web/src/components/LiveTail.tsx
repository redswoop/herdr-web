import { useEffect, useRef, useState } from 'react';
import { agentPath } from '../api';

const OPEN_KEY = 'herdr.liveTail';

/** claude/grok composer + status furniture at the bottom of the screen —
 *  cut it so the tail is output, not chrome */
const TAIL_CHROME_RES = [
  /^\s*$/,
  /^\s*[╭╰]─/,
  /^\s*─{5,}\s*$/,
  /^\s*│.*│\s*$/,
  /^\s*❯/,
  /^\s*[⏸⏵]/,
  /esc to interrupt/,
  /\? for shortcuts/i,
  /shift\+tab/i,
];

/**
 * Live tail of the TUI screen while the agent is working. The session file
 * only receives content when a message/tool block COMPLETES, so long turns
 * stream on the terminal minutes before the transcript can show them — this
 * is the honest window into that gap: the actual screen, polled.
 */
export function LiveTail({ paneId }: { paneId: string }) {
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
        const { text: raw } = (await r.json()) as { text: string };
        if (!alive) return;
        const lines = (raw ?? '').split('\n');
        let end = lines.length;
        while (end > 0 && TAIL_CHROME_RES.some((re) => re.test(lines[end - 1]))) end -= 1;
        setText(lines.slice(0, end).join('\n').replace(/\n{3,}/g, '\n\n').trimEnd());
      } catch {}
    };
    tick();
    const t = setInterval(tick, 1200);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [paneId, open]);

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
