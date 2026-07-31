import { useEffect, useRef, useState } from 'react';
import { agentPath } from '../api';

/** claude's idle/working status line — if it's back at the bottom of the
 *  screen, the dialog is gone and the mirror should go too */
const CHROME_RE = /\? for shortcuts|esc to interrupt|shift\+tab/i;

function chromeVisible(raw: string): boolean {
  const tail = raw
    .split('\n')
    .filter((l) => l.trim())
    .slice(-3)
    .join('\n');
  return CHROME_RE.test(tail);
}

/**
 * Live mirror of the pane while a local TUI dialog is up (slash commands
 * like /model, /resume — invisible to the session file until they finish).
 * No parsing: show the actual screen, drive it with the key strip. `poke`
 * bumps trigger an immediate refresh (a strip key just landed). Dismisses
 * itself when the normal composer chrome returns — the fallback for commands
 * whose session-file record arrives late or never.
 */
export function ScreenMirror({
  paneId,
  poke,
  onClose,
  onGone,
}: {
  paneId: string;
  poke: number;
  onClose: () => void;
  /** chrome came back — dialog is gone; gets the final screen so the caller
   *  can salvage output the session file will never carry */
  onGone: (finalScreen: string) => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const chromeRuns = useRef(0);
  const closedRef = useRef(false);

  const tick = useRef(async () => {});
  tick.current = async () => {
    if (closedRef.current) return;
    try {
      const r = await fetch(agentPath(paneId, 'screen'));
      if (!r.ok) return;
      const { text: raw } = await r.json();
      if (closedRef.current) return;
      if (chromeVisible(raw ?? '')) {
        // two consecutive sightings — a single one can race the dialog paint
        if (++chromeRuns.current >= 2) {
          closedRef.current = true;
          onGone(raw ?? '');
          return;
        }
      } else {
        chromeRuns.current = 0;
      }
      setText((raw ?? '').replace(/\n{3,}/g, '\n\n').trimEnd());
    } catch {}
  };

  useEffect(() => {
    closedRef.current = false;
    tick.current();
    const t = setInterval(() => tick.current(), 700);
    return () => {
      closedRef.current = true;
      clearInterval(t);
    };
  }, [paneId]);

  // a key just landed on the TUI — give it a beat to repaint, then refresh
  useEffect(() => {
    if (!poke) return;
    const t = setTimeout(() => tick.current(), 180);
    return () => clearTimeout(t);
  }, [poke]);

  useEffect(() => {
    const el = preRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [text]);

  if (text === null) return null;
  return (
    <div className="dialog-mirror">
      <div className="dialog-banner">
        <span className="banner-text">local dialog — drive it with the keys below</span>
        <button className="ghost" onClick={onClose}>
          hide
        </button>
      </div>
      <pre className="screen" ref={preRef}>
        {text}
      </pre>
    </div>
  );
}
