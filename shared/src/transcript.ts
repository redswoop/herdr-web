import type { Item } from './types';

/** timestamps below this are local monotonic counters, not epoch ms */
export const EPOCH_MS = 1e12;

export type Step =
  | { type: 'thought'; key: number; text: string }
  | { type: 'tool'; key: number; name: string; id?: string; input: unknown; args: string; result: string | null }
  | { type: 'result'; key: number; text: string };

export type Node =
  | { type: 'item'; key: string; item: Item }
  | { type: 'group'; key: string; steps: Step[]; startAt: number; endAt: number }
  | { type: 'meta'; key: string; dur: number | null; tok: number; ctx: number | null }
  | { type: 'command'; key: string; name: string; args: string; out: string; err: string };

/**
 * Collapse each run of thought/tool_use/tool_result events into one activity
 * group (results paired to their calls by id), and append a stats footer
 * (elapsed · tokens · context) after each finished turn. Turn = user prompt
 * up to the next one; stats only render when the session file carries real
 * timestamps/usage.
 */
export function buildNodes(items: Item[], working: boolean): Node[] {
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
    const isPrompt = it.type === 'mine' || (it.type === 'event' && it.ev.kind === 'user');

    if (isPrompt) {
      flushGroup();
      flushTurn();
      turn = {
        key: it.type === 'mine' ? `m${it.mine.key}` : `e${it.key}`,
        startAt: it.at,
        endAt: it.at,
        out: new Map(),
        ctx: null,
        sawWork: false,
      };
      nodes.push({ type: 'item', key: turn.key, item: it });
      continue;
    }

    if (it.type !== 'event') continue; // exhaustive: mine items were prompts
    const e = it.ev;
    const key = it.key;

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
      if (e.kind !== 'interrupted' && e.kind !== 'usage') turn.sawWork = true;
    }

    // pure accounting (grok's per-turn token totals) — nothing to render
    if (e.kind === 'usage') continue;

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
          type: 'tool',
          key,
          name: e.name ?? 'tool',
          id: e.id,
          input: e.input,
          args: e.text,
          result: null,
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

export function clip(text: string): string {
  return text.length > 20_000 ? `${text.slice(0, 20_000)}\n… [truncated]` : text;
}

export function firstLine(text: string): string {
  const l = text.trimStart();
  const nl = l.indexOf('\n');
  return nl === -1 ? l : l.slice(0, nl);
}

/** last two path segments — enough to recognize a file in a step row */
function shortPath(p: string): string {
  return p.split('/').filter(Boolean).slice(-2).join('/');
}

/** the file a tool call touched, when it's unambiguous — powers tap-to-view.
 *  Covers claude tool names (CamelCase) and grok's (snake_case). */
export function stepFile(name: string, input: unknown): string | null {
  const i = (input ?? {}) as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === 'string' ? v : '');
  switch (name) {
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'NotebookEdit':
    case 'read_file':
    case 'write':
    case 'search_replace':
      return s(i.file_path) || s(i.path) || s(i.notebook_path) || s(i.target_file) || null;
    default:
      return null;
  }
}

/** one-line gist of a tool call — the command, the file, the pattern */
export function stepSummary(name: string, input: unknown, args: string): string {
  const i = (input ?? {}) as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === 'string' ? v : '');
  switch (name) {
    case 'Bash':
    case 'run_terminal_command':
      return firstLine(s(i.command)) || s(i.description);
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'NotebookEdit':
    case 'read_file':
    case 'write':
    case 'search_replace':
      return shortPath(s(i.file_path) || s(i.path) || s(i.notebook_path) || s(i.target_file));
    case 'Grep':
    case 'Glob':
    case 'grep': {
      const where = shortPath(s(i.path) || s(i.glob));
      return [s(i.pattern), where].filter(Boolean).join(' in ');
    }
    case 'list_dir':
      return shortPath(s(i.target_directory));
    case 'Agent':
    case 'Task':
    case 'spawn_subagent':
      return s(i.description) || firstLine(s(i.prompt)).slice(0, 100);
    case 'WebFetch':
    case 'web_fetch':
      return s(i.url);
    case 'WebSearch':
      return s(i.query);
    case 'Skill':
      return [s(i.skill), s(i.args)].filter(Boolean).join(' ');
    case 'TodoWrite':
    case 'todo_write':
      return 'update todo list';
    case 'AskUserQuestion':
    case 'ask_user_question': {
      const qs = i.questions;
      const q = Array.isArray(qs) ? (qs[0] as { question?: string })?.question : '';
      return s(q) || 'ask a question';
    }
    default: {
      const first = Object.values(i).find((v) => typeof v === 'string' && v.trim());
      return first ? firstLine(first as string) : firstLine(args);
    }
  }
}

export function fmtDur(ms: number): string {
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m ${String(sec % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function fmtTok(n: number): string {
  if (n < 1000) return `${n}`;
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
  return `${Math.round(n / 1000)}k`;
}

export const HERDING = [
  'herding',
  'mustering',
  'rounding up',
  'counting sheep',
  'nudging strays',
  'whistling the dog',
  'minding the flock',
  'opening the gate',
];

export const MINE_STATUS: Record<string, string> = {
  sending: '· sending',
  sent: '✓ sent',
  confirmed: '✓',
  stopping: '⏹ interrupting…',
  stopped: '⏹ interrupted',
};

export const AUX_LABEL: Record<string, string> = {
  tool_result: '📤 result',
  note: 'ℹ️ note',
  salvage: '⏹ salvaged from screen',
};
