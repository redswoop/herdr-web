import { useState } from 'react';
import type { RewindState } from '../types';

/** Two-step /rewind driver: checkpoint list → restore-type confirm. All
 *  state is screen-parsed server-side and every tap round-trips, so the card
 *  can never drift from what the TUI actually shows. */
export function RewindCard({
  state,
  onOp,
  onClose,
}: {
  state: Exclude<RewindState, { step: 'closed' } | { step: 'empty' }>;
  onOp: (body: { op: string; index?: number; option?: number }) => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (id: string, body: { op: string; index?: number; option?: number }) => {
    setBusy(id);
    try {
      await onOp(body);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="blocked-card rewind-card">
      <div className="question">
        {state.step === 'list' && (
          <>
            <div className="q-text">⏪ restore to the point before…</div>
            {state.checkpoints.map((c) => (
              <button
                key={c.index}
                className={`option ${busy === `s${c.index}` ? 'busy' : ''}`}
                disabled={busy !== null || c.current}
                onClick={() => run(`s${c.index}`, { op: 'select', index: c.index })}
              >
                <span className="opt-label">{c.message}</span>
                {c.detail && <span className="opt-desc">{c.detail}</span>}
              </button>
            ))}
          </>
        )}
        {state.step === 'confirm' && (
          <>
            <div className="q-text">⏪ restore to before:</div>
            <pre className="perm-detail">{state.message}</pre>
            {state.effects.map((e) => (
              <div className="sub" key={e}>
                {e}
              </div>
            ))}
            {state.warning && <div className="sub">{state.warning}</div>}
            {state.options.map((o) => (
              <button
                key={o.n}
                className={`option ${busy === `o${o.n}` ? 'busy' : ''}`}
                disabled={busy !== null}
                onClick={() => run(`o${o.n}`, { op: 'confirm', option: o.n })}
              >
                <span className="opt-label">{o.label}</span>
                {o.description && <span className="opt-desc">{o.description}</span>}
              </button>
            ))}
          </>
        )}
        <button className="option deny" disabled={busy !== null} onClick={onClose}>
          <span className="opt-label">cancel</span>
        </button>
      </div>
    </div>
  );
}
