import { useEffect, useRef, useState } from 'react';
import { DECK_VERBS, commandText, currentValue } from '@herdr/shared';
import type { CommandVerb, KindCommand, SessionReadout } from '@herdr/shared';

/** DOS-style function-key bar of session controls (`1new 2rewind …`), laid
 *  out from the adapter's manifest. Slots are fixed: a verb this kind lacks
 *  keeps its number, dimmed. Alt+digit fires a slot from anywhere on the
 *  page. Pickers (effort, model) and the compact focus line open a small
 *  pop above the bar; rewind/resume/perms hand off to the view's own panels. */
export function CommandDeck({
  commands,
  disabled,
  readout,
  onSend,
  onPanel,
}: {
  commands: KindCommand[];
  /** agent working/blocked — every slot is off */
  disabled: boolean;
  /** what the session is on now — marked in the pickers */
  readout: SessionReadout;
  onSend: (text: string, cmd: KindCommand) => Promise<void> | void;
  onPanel: (ui: NonNullable<KindCommand['ui']>) => void;
}) {
  const [pop, setPop] = useState<CommandVerb | null>(null);
  const [arg, setArg] = useState('');
  const [busy, setBusy] = useState<CommandVerb | null>(null);
  const byVerb = new Map(commands.map((c) => [c.verb, c]));

  const fire = async (cmd: KindCommand, value?: string) => {
    setPop(null);
    setArg('');
    const text = commandText(cmd, value);
    if (!text) return;
    setBusy(cmd.verb);
    try {
      await onSend(text, cmd);
    } catch (e) {
      alert(String((e as Error)?.message ?? e));
    } finally {
      setBusy(null);
    }
  };

  const activate = (cmd: KindCommand | undefined) => {
    // `busy` too: the buttons are disabled while a send is in flight, the
    // hotkey path has to be as well or Alt+4 twice compacts twice
    if (!cmd || disabled || busy) return;
    if (cmd.ui) return onPanel(cmd.ui);
    // a session-wide effect (/clear) from a hotkey is one mis-chord from
    // losing the context: ask
    if (cmd.effect === 'session' && !confirm(`${cmd.label}: ${cmd.desc ?? cmd.send}?`)) return;
    if (cmd.values || cmd.arg) return setPop((p) => (p === cmd.verb ? null : cmd.verb));
    void fire(cmd);
  };

  // latest handlers for the global key listener without re-binding per render
  const activateRef = useRef(activate);
  activateRef.current = activate;
  const byVerbRef = useRef(byVerb);
  byVerbRef.current = byVerb;
  useEffect(() => {
    if (!commands.length) return;
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      // e.code, not e.key: on macOS Option+1 produces "¡"
      const n = /^Digit([1-9])$/.exec(e.code)?.[1];
      if (!n) return;
      // not under a dialog or a docked file: the deck belongs to the agent
      // view, and a chord while reading a file must not reach the session
      if (document.querySelector('.modal-backdrop, .file-viewer')) return;
      const verb = DECK_VERBS[Number(n) - 1];
      if (!verb) return;
      e.preventDefault();
      activateRef.current(byVerbRef.current.get(verb));
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [commands.length]);

  // an agent that starts working closes any half-made pick — and drops its
  // half-typed focus line, or the next /compact opens pre-filled with it
  useEffect(() => {
    if (disabled) {
      setPop(null);
      setArg('');
    }
  }, [disabled]);

  if (!commands.length) return null;
  const open = pop ? byVerb.get(pop) : undefined;
  const cur = open ? currentValue(open, readout) : null;

  return (
    <div className="deck-wrap">
      {open && (
        <>
          <div className="pop-backdrop" onClick={() => setPop(null)} />
          <div className="deck-pop">
            <div className="deck-pop-head">
              <span className="deck-pop-name">{open.label}</span>
              {open.desc && <span className="deck-pop-desc">{open.desc}</span>}
            </div>
            {open.values?.map((v) => (
              <button
                key={v}
                className={`mode-row ${v === cur ? 'current' : ''}`}
                onClick={() => (v === cur ? setPop(null) : fire(open, v))}
              >
                <span className="mode-name">
                  {v === cur ? '❯ ' : ''}
                  {v}
                </span>
              </button>
            ))}
            {open.arg && (
              <form
                className="deck-arg"
                onSubmit={(e) => {
                  e.preventDefault();
                  void fire(open, arg);
                }}
              >
                <input
                  autoFocus
                  value={arg}
                  placeholder={open.arg}
                  onChange={(e) => setArg(e.target.value)}
                  onKeyDown={(e) => e.key === 'Escape' && setPop(null)}
                />
                <button type="submit" className="deck-go">
                  {open.label}
                </button>
              </form>
            )}
          </div>
        </>
      )}
      <div className="deck" role="toolbar" aria-label="session commands">
        {DECK_VERBS.map((verb, i) => {
          const cmd = byVerb.get(verb);
          return (
            <button
              key={verb}
              className={`deck-key ${pop === verb ? 'on' : ''} ${busy === verb ? 'busy' : ''}`}
              disabled={!cmd || disabled || busy != null}
              title={cmd ? `${cmd.desc ?? cmd.label}  (Alt+${i + 1})` : `${verb}: not supported by this agent`}
              onClick={() => activate(cmd)}
            >
              <b>{i + 1}</b>
              {cmd?.label ?? verb}
            </button>
          );
        })}
      </div>
    </div>
  );
}
