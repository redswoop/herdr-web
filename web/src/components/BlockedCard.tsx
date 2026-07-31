import { useState } from 'react';
import type { BlockedCtx } from '../types';

/**
 * Tappable options for whatever the agent is blocked on. `onAnswer` resolves
 * true when the answer went through; false means the screen moved on (409)
 * and the caller should fall back to the raw key row.
 */
export function BlockedCard({
  ctx,
  onAnswer,
}: {
  ctx: BlockedCtx;
  onAnswer: (keys: string[], expect: string | null) => Promise<boolean>;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  const answer = async (id: string, keys: string[], expect: string | null) => {
    setBusy(id);
    try {
      await onAnswer(keys, expect);
    } finally {
      setBusy(null);
    }
  };

  const opt = (
    id: string,
    label: string,
    keys: string[],
    { desc, expect, cls }: { desc?: string; expect?: string | null; cls?: string } = {},
  ) => (
    <button
      key={id}
      className={`option ${cls ?? ''} ${busy === id ? 'busy' : ''}`}
      disabled={busy !== null}
      onClick={() => answer(id, keys, expect ?? null)}
    >
      <span className="opt-label">{label}</span>
      {desc && <span className="opt-desc">{desc}</span>}
    </button>
  );

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
            {q.multiSelect &&
              opt(`${qi}:done`, 'done ⏎ (multi-select: taps toggle)', ['Enter'], {
                cls: 'confirm',
              })}
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
