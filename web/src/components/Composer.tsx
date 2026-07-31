import { useRef, useState } from 'react';
import { agentPath, errorOf, post } from '../api';
import type { AgentStatus } from '../types';

const KEYS = [
  ['esc', 'Escape'],
  ['↑', 'Up'],
  ['↓', 'Down'],
  ['⏎', 'Enter'],
  ['y', 'y'],
  ['n', 'n'],
  ['^C', 'C-c'],
] as const;

export function Composer({
  paneId,
  status,
  cooldown,
  showKeys,
  onSend,
  onInterrupt,
  onToggleKeys,
}: {
  paneId: string;
  status: AgentStatus | undefined;
  cooldown: boolean;
  showKeys: boolean;
  onSend: (text: string) => Promise<void>;
  onInterrupt: () => void;
  onToggleKeys: () => void;
}) {
  const [text, setText] = useState('');
  const taRef = useRef<HTMLTextAreaElement>(null);

  const hasText = !!text.trim();
  const stop = !hasText && status === 'working';

  const grow = () => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, innerHeight * 0.3)}px`;
  };

  const send = async () => {
    const t = text.trim();
    if (!t) return;
    setText('');
    requestAnimationFrame(grow);
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
