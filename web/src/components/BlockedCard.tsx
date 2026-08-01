import { useState } from 'react';
import type { AnswerBody, BlockedCtx } from '../types';
import { md } from '../md';

/**
 * Tappable options for whatever the agent is blocked on. `onAnswer` resolves
 * true when the answer went through; false means the screen moved on (409)
 * and the caller should fall back to the raw key row.
 */
export function BlockedCard({
  ctx,
  onAnswer,
  screenLive = false,
  onToggleScreen,
}: {
  ctx: BlockedCtx;
  onAnswer: (body: AnswerBody) => Promise<boolean>;
  /** the live TUI mirror is currently up */
  screenLive?: boolean;
  /** show/hide the live TUI mirror; absent = no screen affordance */
  onToggleScreen?: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [fb, setFb] = useState('');

  const answer = async (id: string, body: AnswerBody) => {
    setBusy(id);
    try {
      return await onAnswer(body);
    } finally {
      setBusy(null);
    }
  };

  const btn = (id: string, label: string, body: AnswerBody, desc?: string, cls?: string) => (
    <button
      key={id}
      className={`option ${cls ?? ''} ${busy === id ? 'busy' : ''}`}
      disabled={busy !== null}
      onClick={() => answer(id, body)}
    >
      <span className="opt-label">{label}</span>
      {desc && <span className="opt-desc">{desc}</span>}
    </button>
  );

  const opt = (
    id: string,
    label: string,
    keys: string[],
    { desc, expect, cls }: { desc?: string; expect?: string | null; cls?: string } = {},
  ) => btn(id, label, { keys, expect: expect ?? null }, desc, cls);

  if (ctx.kind === 'ask') {
    // both claude and grok menus select AND submit on the digit alone
    // (verified live on both — do NOT append Enter, it would hit whatever
    // renders next)
    return (
      <div className="blocked-card">
        {ctx.questions.map((q, qi) => (
          <div className="question" key={qi}>
            <div className="q-text">{q.question}</div>
            {q.options.map((o, i) =>
              opt(`${qi}:${i}`, o.label, [String(i + 1)], {
                desc: o.description,
                expect: o.label.slice(0, 30),
              }),
            )}
            {q.multiSelect && (
              // Taps toggle blind — the web card can't see which boxes are
              // ticked, only the TUI can. Pair `done` with a screen affordance
              // so the selection is checkable before it's committed.
              <div className="opt-split">
                {opt(`${qi}:done`, 'done ⏎ (multi-select: taps toggle)', ['Enter'], {
                  cls: 'confirm',
                })}
                {onToggleScreen && (
                  <button
                    className={`option opt-aux ${screenLive ? 'on' : ''}`}
                    title={screenLive ? 'hide the live TUI screen' : 'check what’s ticked on the TUI'}
                    aria-pressed={screenLive}
                    onClick={onToggleScreen}
                  >
                    <span className="opt-label">▤</span>
                    <span className="opt-desc">{screenLive ? 'hide' : 'screen'}</span>
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    );
  }

  if (ctx.kind === 'menu') {
    return (
      <div className="blocked-card">
        <div className="question">
          {ctx.detail && <pre className="perm-detail">{ctx.detail}</pre>}
          <div className="q-text">{ctx.question || ctx.header || 'choose an option'}</div>
          {ctx.options.map((o) =>
            opt(String(o.n), `${o.selected ? '❯ ' : ''}${o.label}`, [String(o.n)], {
              desc: o.description,
              expect: o.label.slice(0, 30),
            }),
          )}
        </div>
      </div>
    );
  }

  // Plan-mode approval: rows 1..3 select, but the last row is a free-text
  // feedback field that swallows keystrokes once focused — never send digits.
  // Options answer via cursor navigation ({option: n}); the textarea rejects
  // the plan with feedback ({feedback}), which sends claude back to planning.
  if (ctx.kind === 'plan') {
    const choices = (ctx.options ?? []).filter((o) => !o.input);
    return (
      <div className="blocked-card">
        <div className="question">
          <div className="q-text">📋 {ctx.question || 'Claude has a plan — proceed?'}</div>
          {ctx.plan && (
            <div className="plan-doc" dangerouslySetInnerHTML={{ __html: md(ctx.plan) }} />
          )}
          {choices.map((o) =>
            btn(
              String(o.n),
              o.label,
              { option: o.n },
              o.description,
              /^yes/i.test(o.label) ? 'confirm' : /^no/i.test(o.label) ? 'deny' : '',
            ),
          )}
          <textarea
            className="plan-fb"
            placeholder="tell claude what to change…"
            rows={2}
            value={fb}
            disabled={busy !== null}
            onChange={(e) => setFb(e.target.value)}
          />
          <button
            className={`option deny ${busy === 'fb' ? 'busy' : ''}`}
            disabled={busy !== null || !fb.trim()}
            onClick={async () => {
              if (await answer('fb', { feedback: fb.trim() })) setFb('');
            }}
          >
            <span className="opt-label">send feedback (keeps planning)</span>
          </button>
        </div>
      </div>
    );
  }

  if (ctx.kind === 'permission') {
    return (
      <div className="blocked-card">
        <div className="question">
          <div className="q-text">
            🔒 wants to run <span className="tool-name">{ctx.tool}</span>
          </div>
          {ctx.detail && <pre className="perm-detail">{ctx.detail.slice(0, 2000)}</pre>}
          {ctx.options?.length
            ? // real numbers + labels from the screen, label doubles as expect
              ctx.options.map((o) =>
                opt(String(o.n), o.label, [String(o.n)], {
                  desc: o.description,
                  expect: o.label.slice(0, 30),
                  cls: /^yes/i.test(o.label) ? 'confirm' : /^no/i.test(o.label) ? 'deny' : '',
                }),
              )
            : // screen didn't parse — the classic 3-option layout as a guess,
              // 409-guarded only by the tool name
              [
                opt('allow', 'Yes, allow', ['1'], { cls: 'confirm' }),
                opt('always', 'Yes, don’t ask again', ['2']),
                opt('deny', 'No / tell it what to do', ['3'], { cls: 'deny' }),
              ]}
        </div>
      </div>
    );
  }

  return null;
}
