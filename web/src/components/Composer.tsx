import { useEffect, useRef, useState } from 'react';
import { agentPath, errorOf, post } from '../api';
import type { RestoredDraft } from '../types';

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
  const [text, setText] = useState('');
  const taRef = useRef<HTMLTextAreaElement>(null);

  const hasText = !!text.trim();
  const stop = !hasText && working;

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
    setText((cur) => (cur.trim() ? cur : restoredDraft.text));
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
    if (!t) return;
    setText('');
    requestAnimationFrame(grow);
    // a slash command means a TUI dialog is coming — on touch devices, drop
    // the phone keyboard so the key strip and screen mirror aren't buried
    // behind it (desktop keeps focus for the next keystroke)
    if (t.startsWith('/') && matchMedia('(pointer: coarse)').matches) taRef.current?.blur();
    try {
      await onSend(t);
    } catch (e) {
      setText(t); // put the draft back
      alert(String((e as Error).message ?? e));
    }
  };

  const sendKeys = async (key: string) => {
    const r = await post(agentPath(paneId, 'keys'), { keys: [key] });
    if (!r.ok) alert(await errorOf(r));
    else onKeyTap?.();
  };

  return (
    <footer className="composer">
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
          disabled={stop ? cooldown : !hasText}
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
