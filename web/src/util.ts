// Small shared helpers — the one home for idioms that were drifting into
// per-component copies (see ARCHITECTURE.md's ui/ policy: write it once).

/** "3m ago" / "2h ago" / "5d ago" for picker rows and card badges */
export const ago = (ms: number) => {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86_400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86_400)}d ago`;
};

export const basename = (p: string) => p.replace(/\/+$/, '').split('/').pop() || p;

/** /home/<user>/… → ~/… for display */
export const shortPath = (p: string) => p.replace(/^\/home\/[^/]+/, '~');

/** attention-first ordering shared by the sidebar list and overview cards
 *  (string-keyed: callers index with group keys, not just AgentStatus) */
export const STATUS_ORDER: Record<string, number> = {
  blocked: 0,
  working: 1,
  idle: 2,
  unknown: 3,
  done: 4,
};

export const STATUS_WORD: Record<string, string> = {
  blocked: 'needs you',
  working: 'working…',
  idle: 'idle',
  done: 'done',
  unknown: '?',
};
