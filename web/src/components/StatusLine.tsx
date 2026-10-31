import { useCallback, useEffect, useRef, useState } from 'react';
import { commandText, ctxHeat, currentValue, fmtTokens, shortModel } from '@herdr/shared';
import type { AgentStatus, KindCommand, SessionReadout } from '@herdr/shared';
import type { Agent } from '../types';
import { shortPath } from '../util';
import { Pop } from './ui/Pop';

/** The header's `model · effort · ctx · cwd` line, where each readout is
 *  also the control that changes it: model and effort open their pick
 *  lists, the context size opens breakdown / compact (right-click goes
 *  straight to compact), the cwd opens the file browser there. Which
 *  readouts are live comes from the adapter's manifest; a kind without one
 *  (grok) gets plain text. */
type Pop = 'effort' | 'model' | 'ctx' | 'compact';

export function StatusLine({
  agent,
  readout,
  commands,
  disabled,
  onSend,
  onOpenDir,
}: {
  agent: Agent;
  readout: SessionReadout;
  commands: KindCommand[];
  /** agent working/blocked — readouts stay text */
  disabled: boolean;
  onSend: (text: string) => Promise<void> | void;
  onOpenDir: (path: string) => void;
}) {
  const [pop, setPop] = useState<Pop | null>(null);
  const [arg, setArg] = useState('');
  const [busy, setBusy] = useState(false);
  const lineRef = useRef<HTMLDivElement>(null);
  const byVerb = new Map(commands.map((c) => [c.verb, c]));
  const close = useCallback(() => {
    setPop(null);
    setArg('');
  }, []);

  // an agent that starts working closes any half-made pick — and drops its
  // half-typed focus line, or the next compact opens pre-filled with it
  useEffect(() => {
    if (disabled) close();
  }, [disabled, close]);

  const fire = async (cmd: KindCommand, value?: string) => {
    close();
    const text = commandText(cmd, value);
    if (!text) return;
    setBusy(true);
    try {
      await onSend(text);
    } catch (e) {
      alert(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const off = disabled || busy;
  const toggle = (p: Pop) => setPop((cur) => (cur === p ? null : p));
  const model = byVerb.get('model');
  const effort = byVerb.get('effort');
  const context = byVerb.get('context');
  const compact = byVerb.get('compact');
  const heat = ctxHeat(readout);

  const segs: {
    key: Pop | 'cwd';
    text: string;
    on?: () => void;
    cls?: string;
    title?: string;
    menu?: () => void;
  }[] = [];
  segs.push({
    key: 'model',
    text: (readout.model ? shortModel(readout.model) : null) ?? agent.displayAgent ?? agent.agent,
    on: model && (() => toggle('model')),
    title: model?.desc,
  });
  if (readout.effort || effort) {
    segs.push({
      key: 'effort',
      text: readout.effort ?? 'effort',
      on: effort && (() => toggle('effort')),
      title: effort?.desc,
    });
  }
  if (readout.ctx != null || context || compact) {
    segs.push({
      key: 'ctx',
      text: readout.ctx != null ? `${fmtTokens(readout.ctx)} ctx` : 'ctx',
      on: (context || compact) && (() => toggle('ctx')),
      menu: compact && (() => toggle('compact')),
      cls: heat,
      title: heat === 'hot' ? 'context nearly full — compact?' : compact ? 'context · right-click: compact' : context?.desc,
    });
  }
  if (agent.cwd) {
    const cwd = agent.cwd;
    segs.push({
      key: 'cwd',
      text: shortPath(cwd),
      on: () => onOpenDir(cwd),
      title: 'browse files here',
    });
  }

  const picker = pop === 'effort' ? effort : pop === 'model' ? model : null;
  const cur = picker ? currentValue(picker, readout) : null;

  return (
    <>
      <div className="sub status-line" ref={lineRef}>
        {segs.map((s, i) => (
          <span key={s.key} className="ro-wrap">
            {i > 0 && <span className="ro-dot"> · </span>}
            {s.on ? (
              <button
                className={`ro ctl ${pop === s.key || (s.key === 'ctx' && pop === 'compact') ? 'on' : ''} ${s.cls ?? ''}`}
                disabled={off}
                title={s.title}
                onClick={s.on}
                onContextMenu={
                  s.menu &&
                  ((e) => {
                    e.preventDefault();
                    if (!off) s.menu?.();
                  })
                }
              >
                {s.text}
              </button>
            ) : (
              <span className={`ro ${s.cls ?? ''}`}>{s.text}</span>
            )}
          </span>
        ))}
      </div>
      <Pop open={pop != null} onClose={close} anchor={lineRef} className="status-pop">
        {picker && (
          <>
            <div className="status-pop-head">
              <span className="status-pop-name">{picker.label}</span>
              {picker.desc && <span className="status-pop-desc">{picker.desc}</span>}
            </div>
            {picker.values?.map((v) => (
              <button key={v} className={`mode-row ${v === cur ? 'current' : ''}`} onClick={() => (v === cur ? close() : fire(picker, v))}>
                <span className="mode-name">
                  {v === cur ? '❯ ' : ''}
                  {v}
                </span>
              </button>
            ))}
          </>
        )}
        {pop === 'ctx' && (
          <>
            <div className="status-pop-head">
              <span className="status-pop-name">context</span>
              <span className="status-pop-desc">
                {readout.ctx != null ? `${fmtTokens(readout.ctx)} tokens` : 'size unknown'}
                {readout.window ? ` of ${fmtTokens(readout.window)}` : ''}
              </span>
            </div>
            {context && (
              <button className="mode-row" onClick={() => fire(context)}>
                <span className="mode-name">breakdown</span>
                <span className="mode-desc">{context.desc}</span>
              </button>
            )}
            {compact && (
              <button className="mode-row" onClick={() => setPop('compact')}>
                <span className="mode-name">compact now…</span>
                <span className="mode-desc">{compact.desc}</span>
              </button>
            )}
          </>
        )}
        {pop === 'compact' && compact && (
          <>
            <div className="status-pop-head">
              <span className="status-pop-name">{compact.label}</span>
              {compact.desc && <span className="status-pop-desc">{compact.desc}</span>}
            </div>
            <form
              className="status-arg"
              onSubmit={(e) => {
                e.preventDefault();
                void fire(compact, arg);
              }}
            >
              <input
                autoFocus
                data-autofocus=""
                value={arg}
                placeholder={compact.arg}
                onChange={(e) => setArg(e.target.value)}
                onKeyDown={(e) => e.key === 'Escape' && close()}
              />
              <button type="submit" className="status-go">
                {compact.label}
              </button>
            </form>
          </>
        )}
      </Pop>
    </>
  );
}

/** The status chip (DONE / WORKING / BLOCKED), and the session's lifecycle
 *  verbs behind it: tap → `new · rewind · resume`. Plain text for a kind
 *  whose manifest has none of them. */
export function SessionChip({
  status,
  commands,
  disabled,
  onSend,
  onPanel,
}: {
  status: AgentStatus | undefined;
  commands: KindCommand[];
  disabled: boolean;
  onSend: (text: string) => Promise<void> | void;
  onPanel: (ui: NonNullable<KindCommand['ui']>) => void;
}) {
  const [open, setOpen] = useState(false);
  // a session-wide verb (/clear) is one mis-tap from losing the context: the
  // first tap arms the row, the second fires — no browser dialog
  const [armed, setArmed] = useState<string | null>(null);
  const chipRef = useRef<HTMLButtonElement>(null);
  const verbs = commands.filter((c) => ['new', 'rewind', 'resume'].includes(c.verb));
  const close = useCallback(() => {
    setOpen(false);
    setArmed(null);
  }, []);
  useEffect(() => {
    if (disabled) close();
  }, [disabled, close]);
  if (!verbs.length) return <span className={`chip ${status ?? ''}`}>{status ?? '—'}</span>;

  const run = async (cmd: KindCommand) => {
    if (cmd.effect === 'session' && armed !== cmd.verb) return setArmed(cmd.verb);
    close();
    if (cmd.ui) return onPanel(cmd.ui);
    const text = commandText(cmd);
    if (!text) return;
    try {
      await onSend(text);
    } catch (e) {
      alert(String((e as Error)?.message ?? e));
    }
  };

  return (
    <>
      <button
        ref={chipRef}
        className={`chip session-chip ${status ?? ''} ${open ? 'on' : ''}`}
        disabled={disabled}
        title="new · rewind · resume"
        onClick={() => (open ? close() : setOpen(true))}
      >
        {status ?? '—'}
      </button>
      <Pop open={open} onClose={close} anchor={chipRef} align="right" className="session-pop">
        {verbs.map((c) =>
          armed === c.verb ? (
            <div key={c.verb} className="mode-row armed">
              <span className="mode-name">{c.desc ?? `${c.label}?`}</span>
              <span className="arm-row">
                <button className="arm-go" onClick={() => void run(c)}>
                  {c.label}
                </button>
                <button className="arm-keep" onClick={() => setArmed(null)}>
                  keep
                </button>
              </span>
            </div>
          ) : (
            <button key={c.verb} className="mode-row" onClick={() => void run(c)}>
              <span className="mode-name">{c.label}</span>
              {c.desc && <span className="mode-desc">{c.desc}</span>}
            </button>
          ),
        )}
      </Pop>
    </>
  );
}
