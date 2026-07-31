import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { esc, md } from '../md';
import type { Item, Mine, TEvent } from '../types';

const AUX_LABEL: Record<string, string> = {
  tool_result: '📤 result',
  note: 'ℹ️ note',
  salvage: '⏹ salvaged from screen',
};

/** timestamps below this are local monotonic counters, not epoch ms */
const EPOCH_MS = 1e12;

type Step =
  | { type: 'thought'; key: number; text: string }
  | { type: 'tool'; key: number; name: string; id?: string; input: unknown; args: string; result: string | null }
  | { type: 'result'; key: number; text: string };

type Node =
  | { type: 'item'; key: string; item: Item }
  | { type: 'group'; key: string; steps: Step[]; startAt: number; endAt: number }
  | { type: 'meta'; key: string; dur: number | null; tok: number; ctx: number | null }
  | { type: 'command'; key: string; name: string; args: string; out: string; err: string };

/**
 * Collapse each run of thought/tool_use/tool_result events into one activity
 * group (results paired to their calls by id), and append a stats footer
 * (elapsed · tokens · context) after each finished turn. Turn = user prompt
 * up to the next one; stats only render when the session file carries real
 * timestamps/usage (claude does, grok doesn't).
 */
function buildNodes(items: Item[], working: boolean): Node[] {
  const nodes: Node[] = [];
  let group: { key: string; steps: Step[]; startAt: number; endAt: number } | null = null;
  let turn: {
    key: string;
    startAt: number;
    endAt: number;
    out: Map<string, number>;
    ctx: number | null;
    sawWork: boolean;
  } | null = null;

  const flushGroup = () => {
    if (group) nodes.push({ type: 'group', ...group });
    group = null;
  };
  const flushTurn = () => {
    if (!turn) return;
    const dur =
      turn.startAt > EPOCH_MS && turn.endAt > turn.startAt ? turn.endAt - turn.startAt : null;
    let tok = 0;
    turn.out.forEach((n) => (tok += n));
    if (turn.sawWork && ((dur !== null && dur >= 1000) || tok > 0)) {
      nodes.push({ type: 'meta', key: `t${turn.key}`, dur, tok, ctx: turn.ctx });
    }
    turn = null;
  };

  for (const it of items) {
    const ev = it.type === 'event' ? it.ev : null;
    const isPrompt = it.type === 'mine' || ev?.kind === 'user';

    if (isPrompt) {
      flushGroup();
      flushTurn();
      turn = {
        key: it.type === 'mine' ? `m${it.mine.key}` : `e${(it as { key: number }).key}`,
        startAt: it.at,
        endAt: it.at,
        out: new Map(),
        ctx: null,
        sawWork: false,
      };
      nodes.push({ type: 'item', key: turn.key, item: it });
      continue;
    }

    // ev is non-null from here (mine was handled above)
    const e = ev as TEvent;
    const key = (it as { key: number }).key;

    // slash commands sit outside the turn: no sawWork, no stats
    if (e.kind === 'command' || e.kind === 'command_out' || e.kind === 'command_err') {
      flushGroup();
      if (e.kind === 'command') {
        nodes.push({ type: 'command', key: `c${key}`, name: e.name ?? '', args: e.text, out: '', err: '' });
      } else {
        let prev = nodes[nodes.length - 1];
        if (prev?.type !== 'command') {
          prev = { type: 'command', key: `c${key}`, name: '', args: '', out: '', err: '' };
          nodes.push(prev);
        }
        const field = e.kind === 'command_out' ? 'out' : 'err';
        prev[field] += (prev[field] ? '\n' : '') + e.text;
      }
      continue;
    }

    if (turn) {
      if (it.at > EPOCH_MS && it.at > turn.endAt) turn.endAt = it.at;
      if (e.usage) {
        const id = e.msgId ?? `k${key}`;
        turn.out.set(id, Math.max(turn.out.get(id) ?? 0, e.usage.out));
        turn.ctx = e.usage.ctx;
      }
      if (e.kind !== 'interrupted') turn.sawWork = true;
    }

    if (e.kind === 'thought' || e.kind === 'tool_use' || e.kind === 'tool_result') {
      if (e.kind === 'tool_result' && e.id && group) {
        const call = group.steps.find(
          (s): s is Step & { type: 'tool' } => s.type === 'tool' && s.id === e.id && s.result === null,
        );
        if (call) {
          call.result = e.text;
          group.endAt = Math.max(group.endAt, it.at);
          continue;
        }
      }
      if (!group) group = { key: `g${key}`, steps: [], startAt: it.at, endAt: it.at };
      group.endAt = Math.max(group.endAt, it.at);
      if (e.kind === 'thought') group.steps.push({ type: 'thought', key, text: e.text });
      else if (e.kind === 'tool_use') {
        group.steps.push({
          type: 'tool', key, name: e.name ?? 'tool', id: e.id, input: e.input, args: e.text, result: null,
        });
      } else group.steps.push({ type: 'result', key, text: e.text });
      continue;
    }

    flushGroup();
    nodes.push({ type: 'item', key: `e${key}`, item: it });
  }
  flushGroup();
  if (!working) flushTurn();
  return nodes;
}

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

  const nodes = buildNodes(items, working);
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

const HERDING = [
  'herding',
  'mustering',
  'rounding up',
  'counting sheep',
  'nudging strays',
  'whistling the dog',
  'minding the flock',
  'opening the gate',
];

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

function EventNode({ ev }: { ev: TEvent }) {
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
}

/* ---------- activity group ---------- */

function ActivityGroup({
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
}

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
function CommandPill({ name, args, out, err }: { name: string; args: string; out: string; err: string }) {
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
}

function TurnMeta({ dur, tok, ctx }: { dur: number | null; tok: number; ctx: number | null }) {
  const parts = [
    dur !== null ? fmtDur(dur) : null,
    tok > 0 ? `${fmtTok(tok)} tokens` : null,
    ctx !== null && ctx > 0 ? `ctx ${fmtTok(ctx)}` : null,
  ].filter(Boolean);
  if (!parts.length) return null;
  return <div className="turn-meta">{parts.join(' · ')}</div>;
}

/* ---------- helpers ---------- */

function clip(text: string): string {
  return text.length > 20_000 ? `${text.slice(0, 20_000)}\n… [truncated]` : text;
}

function firstLine(text: string): string {
  const l = text.trimStart();
  const nl = l.indexOf('\n');
  return nl === -1 ? l : l.slice(0, nl);
}

function shortPath(p: string): string {
  return p.split('/').filter(Boolean).slice(-2).join('/');
}

/** the file a tool call touched, when it's unambiguous — powers tap-to-view */
function stepFile(name: string, input: unknown): string | null {
  const i = (input ?? {}) as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === 'string' ? v : '');
  switch (name) {
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'NotebookEdit':
      return s(i.file_path) || s(i.path) || s(i.notebook_path) || null;
    default:
      return null;
  }
}

/** one-line gist of a tool call — the command, the file, the pattern */
function stepSummary(name: string, input: unknown, args: string): string {
  const i = (input ?? {}) as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === 'string' ? v : '');
  switch (name) {
    case 'Bash':
      return firstLine(s(i.command)) || s(i.description);
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'NotebookEdit':
      return shortPath(s(i.file_path) || s(i.path) || s(i.notebook_path));
    case 'Grep':
    case 'Glob': {
      const where = shortPath(s(i.path));
      return [s(i.pattern), where].filter(Boolean).join(' in ');
    }
    case 'Agent':
    case 'Task':
      return s(i.description) || firstLine(s(i.prompt)).slice(0, 100);
    case 'WebFetch':
      return s(i.url);
    case 'WebSearch':
      return s(i.query);
    case 'Skill':
      return [s(i.skill), s(i.args)].filter(Boolean).join(' ');
    case 'TodoWrite':
      return 'update todo list';
    default: {
      const first = Object.values(i).find((v) => typeof v === 'string' && v.trim());
      return first ? firstLine(first as string) : firstLine(args);
    }
  }
}

function fmtDur(ms: number): string {
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m ${String(sec % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function fmtTok(n: number): string {
  if (n < 1000) return `${n}`;
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
  return `${Math.round(n / 1000)}k`;
}

/* ---------- prompt bubble ---------- */

const MINE_STATUS: Record<Mine['state'], string> = {
  sending: '· sending',
  sent: '✓ sent',
  confirmed: '✓',
  stopping: '⏹ interrupting…',
  stopped: '⏹ interrupted',
};

function MineBubble({
  mine,
  cancellable,
  onInterrupt,
}: {
  mine: Mine;
  cancellable: boolean;
  onInterrupt: () => void;
}) {
  return (
    <div
      className={`msg user ${cancellable ? 'cancellable' : ''}`}
      onClick={cancellable ? onInterrupt : undefined}
    >
      <span dangerouslySetInnerHTML={{ __html: md(mine.text) }} />
      <div className="sent-status">{MINE_STATUS[mine.state]}</div>
    </div>
  );
}
