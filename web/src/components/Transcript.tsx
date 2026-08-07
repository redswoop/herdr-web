import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  AUX_LABEL,
  EPOCH_MS,
  HERDING,
  MINE_STATUS,
  buildNodes,
  clip,
  firstLine,
  fmtDur,
  fmtTok,
  stepFile,
  stepSummary,
  type Node,
  type Step,
} from '@herdr/shared';
import { esc, md } from '../md';
import type { Item, Mine, TEvent } from '../types';

// The transcript view-model (buildNodes, step summaries, labels) lives in
// @herdr/shared — mobile renders the exact same nodes. Add tool knowledge
// there, not here.

export function Transcript({
  items,
  error,
  loaded,
  working,
  cancellableKey,
  onInterrupt,
  onOpenFile,
}: {
  items: Item[];
  error: string | null;
  loaded: boolean;
  working: boolean;
  cancellableKey: number | null; // mine bubble that gets tap-to-stop
  onInterrupt: () => void;
  onOpenFile: (path: string) => void;
}) {
  const ref = useRef<HTMLElement>(null);
  const follow = useRef(true);

  // md() emits href-less <a data-file> for path-looking text — one delegated
  // handler beats wiring callbacks through dangerouslySetInnerHTML
  const onClick = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest('a[data-file]') as HTMLElement | null;
    if (a?.dataset.file) {
      e.preventDefault();
      onOpenFile(a.dataset.file);
    }
  };

  useLayoutEffect(() => {
    const el = ref.current;
    if (el && follow.current) el.scrollTop = el.scrollHeight;
  }, [items, working]);

  const onScroll = () => {
    const el = ref.current;
    if (el) follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  // the SSE tick and the working pill's 3s cycle re-render this constantly —
  // don't re-derive the node list (and re-parse markdown) unless items moved
  const nodes = useMemo(() => buildNodes(items, working), [items, working]);

  if (items.length === 0) {
    return (
      <main className="scroll transcript" ref={ref}>
        {working ? (
          <WorkingPill />
        ) : (
          (error || loaded) && <div className="empty">{error ?? 'fresh session — say something'}</div>
        )}
      </main>
    );
  }

  // a live activity group carries its own spinner; anything else at the tail
  // (fresh prompt, assistant text mid-turn) gets the standalone working pill
  const showPill = working && nodes[nodes.length - 1]?.type !== 'group';
  return (
    <main className="scroll transcript" ref={ref} onScroll={onScroll} onClick={onClick}>
      {nodes.map((n, i) => {
        if (n.type === 'group') {
          return (
            <ActivityGroup
              key={n.key}
              node={n}
              live={working && i === nodes.length - 1}
              onOpenFile={onOpenFile}
            />
          );
        }
        if (n.type === 'meta') {
          return <TurnMeta key={n.key} dur={n.dur} tok={n.tok} ctx={n.ctx} />;
        }
        if (n.type === 'command') {
          return <CommandPill key={n.key} name={n.name} args={n.args} out={n.out} err={n.err} />;
        }
        const it = n.item;
        return it.type === 'mine' ? (
          <MineBubble
            key={n.key}
            mine={it.mine}
            cancellable={it.mine.key === cancellableKey}
            onInterrupt={onInterrupt}
          />
        ) : (
          <EventNode key={n.key} ev={it.ev} />
        );
      })}
      {showPill && <WorkingPill />}
    </main>
  );
}

/* ---------- working pill ---------- */

/** Instant feedback on submit: fills the spot where the live activity group
 *  will appear once the first session-file records land, so the handoff reads
 *  as the same pill picking up real progress. */
function WorkingPill() {
  const [i, setI] = useState(() => Math.floor(Math.random() * HERDING.length));
  useEffect(() => {
    const t = setInterval(() => setI((n) => (n + 1) % HERDING.length), 3000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="activity working-pill">
      <div className="act-head">
        <span className="live-dot" />
        <span className="act-count" key={i}>
          {HERDING[i]}
        </span>
        <span className="ell">
          <i />
          <i />
          <i />
        </span>
      </div>
    </div>
  );
}

const EventNode = memo(function EventNode({ ev }: { ev: TEvent }) {
  if (ev.kind === 'interrupted') {
    return <div className="interrupt-divider">⏹ interrupted</div>;
  }
  if (ev.kind === 'user') {
    return <div className="msg user" dangerouslySetInnerHTML={{ __html: md(ev.text) }} />;
  }
  if (ev.kind === 'assistant') {
    return <div className="msg assistant" dangerouslySetInnerHTML={{ __html: md(ev.text) }} />;
  }
  return (
    <details className="aux">
      <summary>{AUX_LABEL[ev.kind] ?? ev.kind}</summary>
      <div className="body">
        <pre dangerouslySetInnerHTML={{ __html: esc(clip(ev.text)) }} />
      </div>
    </details>
  );
});

/* ---------- activity group ---------- */

const ActivityGroup = memo(function ActivityGroup({
  node,
  live,
  onOpenFile,
}: {
  node: Node & { type: 'group' };
  live: boolean;
  onOpenFile: (path: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const tools = node.steps.filter((s) => s.type === 'tool');
  const thoughts = node.steps.length - tools.length;

  // "Bash ×3 · Read ×2 · Grep" — top three tools by use count
  const tally = new Map<string, number>();
  for (const t of tools) tally.set(t.name, (tally.get(t.name) ?? 0) + 1);
  const names = [...tally.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([n, c]) => (c > 1 ? `${n} ×${c}` : n))
    .join(' · ');

  const last = node.steps[node.steps.length - 1];
  const runningName =
    last?.type === 'tool' && last.result === null ? last.name : 'thinking';

  const dur =
    node.startAt > EPOCH_MS && node.endAt > node.startAt ? node.endAt - node.startAt : null;

  const count = tools.length
    ? `${tools.length} tool${tools.length === 1 ? '' : 's'}`
    : `thought${thoughts === 1 ? '' : ` ×${thoughts}`}`;

  return (
    <div className={`activity ${open ? 'open' : ''}`}>
      <button className="act-head" onClick={() => setOpen((o) => !o)}>
        <span className="chev">▸</span>
        {live ? (
          <>
            <span className="live-dot" />
            <span className="act-count">{runningName}…</span>
          </>
        ) : (
          <span className="act-count">{count}</span>
        )}
        {names && <span className="act-names">{names}</span>}
        {dur !== null && dur >= 1000 && <span className="act-dur">{fmtDur(dur)}</span>}
      </button>
      {open && (
        <div className="act-steps">
          {node.steps.map((s) => (
            <StepRow key={s.key} step={s} onOpenFile={onOpenFile} />
          ))}
        </div>
      )}
    </div>
  );
});

function StepRow({ step, onOpenFile }: { step: Step; onOpenFile: (path: string) => void }) {
  const [open, setOpen] = useState(false);
  if (step.type === 'thought') {
    return (
      <div className="step">
        <button className="step-head" onClick={() => setOpen((o) => !o)}>
          <span className="step-name thought">💭</span>
          <span className="step-sum">{firstLine(step.text)}</span>
        </button>
        {open && (
          <div className="step-detail">
            <pre dangerouslySetInnerHTML={{ __html: esc(clip(step.text)) }} />
          </div>
        )}
      </div>
    );
  }
  if (step.type === 'result') {
    return (
      <div className="step">
        <button className="step-head" onClick={() => setOpen((o) => !o)}>
          <span className="step-name">result</span>
          <span className="step-sum">{firstLine(step.text)}</span>
        </button>
        {open && (
          <div className="step-detail">
            <pre dangerouslySetInnerHTML={{ __html: esc(clip(step.text)) }} />
          </div>
        )}
      </div>
    );
  }
  const file = stepFile(step.name, step.input);
  return (
    <div className="step">
      <button className="step-head" onClick={() => setOpen((o) => !o)}>
        <span className="step-name">{step.name}</span>
        {file ? (
          <span
            className="step-sum step-file"
            onClick={(e) => {
              e.stopPropagation();
              onOpenFile(file);
            }}
          >
            {stepSummary(step.name, step.input, step.args)}
          </span>
        ) : (
          <span className="step-sum">{stepSummary(step.name, step.input, step.args)}</span>
        )}
        {step.result === null && <span className="step-pending">…</span>}
      </button>
      {open && (
        <div className="step-detail">
          {step.args && <pre dangerouslySetInnerHTML={{ __html: esc(clip(step.args)) }} />}
          {step.result !== null && (
            <>
              <div className="step-detail-label">result</div>
              <pre dangerouslySetInnerHTML={{ __html: esc(clip(step.result)) }} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** A slash command run in the TUI (`/model`, `/compact`, …); stdout expands
 *  on tap, errors render expanded — yellow bold, like claude itself. */
const CommandPill = memo(function CommandPill({
  name,
  args,
  out,
  err,
}: {
  name: string;
  args: string;
  out: string;
  err: string;
}) {
  const [open, setOpen] = useState(false);
  const label = [name || 'command output', args].filter(Boolean).join(' ');
  return (
    <div className={`command-pill ${open ? 'open' : ''}`}>
      <button
        className="cmd-head"
        onClick={out ? () => setOpen((o) => !o) : undefined}
        disabled={!out}
      >
        <span className="cmd-glyph">⌘</span>
        <span className="cmd-name">{label}</span>
        {out && <span className="chev">▸</span>}
      </button>
      {open && <pre className="cmd-out" dangerouslySetInnerHTML={{ __html: esc(clip(out)) }} />}
      {err && <pre className="cmd-err" dangerouslySetInnerHTML={{ __html: esc(clip(err)) }} />}
    </div>
  );
});

const TurnMeta = memo(function TurnMeta({
  dur,
  tok,
  ctx,
}: {
  dur: number | null;
  tok: number;
  ctx: number | null;
}) {
  const parts = [
    dur !== null ? fmtDur(dur) : null,
    tok > 0 ? `${fmtTok(tok)} tokens` : null,
    ctx !== null && ctx > 0 ? `ctx ${fmtTok(ctx)}` : null,
  ].filter(Boolean);
  if (!parts.length) return null;
  return <div className="turn-meta">{parts.join(' · ')}</div>;
});

/* ---------- prompt bubble ---------- */

const MineBubble = memo(function MineBubble({
  mine,
  cancellable,
  onInterrupt,
}: {
  mine: Mine;
  cancellable: boolean;
  onInterrupt: () => void;
}) {
  // interrupt lives on the status line ONLY: a click anywhere else in the
  // bubble is text selection, not intent (same fix as mobile, 71567d8)
  return (
    <div className={`msg user ${cancellable ? 'cancellable' : ''}`}>
      <span dangerouslySetInnerHTML={{ __html: md(mine.text) }} />
      <div className="sent-status" onClick={cancellable ? onInterrupt : undefined}>
        {MINE_STATUS[mine.state]}
      </div>
    </div>
  );
});
