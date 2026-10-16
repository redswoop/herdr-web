import type { Agent, AgentStatus, Tab, Workspace } from './types';

/** Where a quick-spawned session should land (mirrors spawn.SpawnTarget). */
export interface SpawnTarget {
  workspaceId?: string;
  cwd?: string;
}

export type GroupBy = 'recent' | 'workspace' | 'status' | 'project' | 'agent';

export const GROUP_MODES: { key: GroupBy; label: string }[] = [
  { key: 'recent', label: 'recent' },
  { key: 'workspace', label: 'space' },
  { key: 'project', label: 'project' },
  { key: 'agent', label: 'agent' },
  { key: 'status', label: 'status' },
];

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

const basename = (p: string) => p.replace(/\/+$/, '').split('/').pop() || p;

export interface TabSub {
  key: string;
  title: string;
  focused?: boolean;
  agents: Agent[];
}

export interface Group {
  key: string;
  title: string;
  badge?: string;
  focused?: boolean;
  status?: AgentStatus;
  spawn?: SpawnTarget;
  agents: Agent[];
  subs?: TabSub[];
  /** render rows without a header (recent mode's main list) */
  flat?: boolean;
  /** starts collapsed until the user opens it (recent mode's stale fold) */
  defaultClosed?: boolean;
}

// Tabs herdr hasn't renamed carry their position number as the label.
const tabTitle = (t: Tab | undefined, tabId: string) =>
  !t ? tabId : /^\d+$/.test(t.label) ? `tab ${t.label}` : t.label;

export function splitByTab(agents: Agent[], tabs: Map<string, Tab>): TabSub[] | undefined {
  const byTab = new Map<string, Agent[]>();
  for (const a of agents) {
    (byTab.get(a.tabId) ?? byTab.set(a.tabId, []).get(a.tabId)!).push(a);
  }
  if (byTab.size < 2) return undefined;
  // herdr numbers unnamed tabs; "tab 1 / tab 2" headers over one chat each
  // are pure chrome — only split when someone named a tab
  const named = [...byTab.keys()].some((id) => {
    const label = tabs.get(id)?.label;
    return !!label && !/^\d+$/.test(label);
  });
  if (!named) return undefined;
  return [...byTab.entries()]
    .map(([tabId, list]) => ({
      key: tabId,
      title: tabTitle(tabs.get(tabId), tabId),
      focused: tabs.get(tabId)?.focused,
      agents: list,
      number: tabs.get(tabId)?.number ?? 999,
    }))
    .sort((a, b) => a.number - b.number)
    .map(({ number: _n, ...rest }) => rest);
}

/** Most common value among the agents; spawn targets follow the majority. */
export function dominant<T>(agents: Agent[], of: (a: Agent) => T | null): T | undefined {
  const counts = new Map<T, number>();
  for (const a of agents) {
    const v = of(a);
    if (v != null) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  let best: T | undefined;
  let n = 0;
  for (const [v, c] of counts) if (c > n) {
    best = v;
    n = c;
  }
  return best;
}

/** The name the server mints for an unnamed spawn (`claude-w33p7`) — not a human's. */
export const isAutoLabel = (a: Agent) =>
  !!a.label && a.label === `${a.agent}-${a.paneId.replace(/\W+/g, '').toLowerCase()}`;

const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A terminal title that only restates agent/folder (`π - ComfyData`,
 *  `Claude Code`, `~/src/x`) says nothing about the chat. */
export function isGenericTitle(title: string, a: Agent): boolean {
  let t = title.trim();
  if (!t || /^[~/]/.test(t)) return true;
  const noise = [a.agent, a.displayAgent, a.cwd && basename(a.cwd), 'π']
    .filter((x): x is string => !!x)
    .sort((x, y) => y.length - x.length); // "Claude Code" before "claude"
  for (const n of noise) t = t.replace(new RegExp(escRe(n), 'gi'), ' ');
  return (t.match(/\p{L}/gu) ?? []).length < 3;
}

/** What the chat is about: a human's label, else the agent's live title, else
 *  the session's own title, else its first prompt — auto-names last. */
export function chipName(a: Agent): string {
  if (a.label && !isAutoLabel(a)) return a.label;
  if (a.title && !isGenericTitle(a.title, a)) return a.title;
  const fallback = a.sessionTitle?.trim() || a.firstPrompt?.trim().split('\n')[0];
  return fallback || a.label || a.title || a.paneId;
}

/** Idle this long with no transcript movement → folded under "stale". */
export const STALE_MS = 24 * 3600_000;

/** Attention first (blocked, then working), then most recently active. */
export function byAttention(a: Agent, b: Agent): number {
  const rank = (x: Agent) => (x.status === 'blocked' ? 0 : x.status === 'working' ? 1 : 2);
  return (
    rank(a) - rank(b) ||
    (b.lastActiveAt ?? 0) - (a.lastActiveAt ?? 0) ||
    chipName(a).localeCompare(chipName(b))
  );
}

export const isStale = (a: Agent, now: number) =>
  a.status !== 'blocked' && a.status !== 'working' && !!a.lastActiveAt && now - a.lastActiveAt > STALE_MS;

// a group ranks by its most urgent, then most recent, member
const groupRank = (g: { agents: Agent[] }) => {
  const top = g.agents[0]; // lists are byAttention-sorted
  if (!top) return { rank: 3, at: 0 };
  return { rank: top.status === 'blocked' ? 0 : top.status === 'working' ? 1 : 2, at: top.lastActiveAt ?? 0 };
};
const byGroupRank = (a: { agents: Agent[] }, b: { agents: Agent[] }) => {
  const x = groupRank(a);
  const y = groupRank(b);
  return x.rank - y.rank || y.at - x.at;
};

export function buildGroups(
  agents: Agent[],
  workspaces: Workspace[],
  tabs: Tab[],
  mode: GroupBy,
  now: number = Date.now(),
): Group[] {
  if (mode === 'recent') {
    const sorted = [...agents].sort(byAttention);
    const groups: Group[] = [
      { key: 'live', title: '', flat: true, agents: sorted.filter((a) => !isStale(a, now)) },
    ];
    const stale = sorted.filter((a) => isStale(a, now));
    if (stale.length) groups.push({ key: 'stale', title: 'stale', defaultClosed: true, agents: stale });
    return groups;
  }

  const bucket = new Map<string, Agent[]>();
  for (const a of agents) {
    const k =
      mode === 'workspace'
        ? a.workspaceId
        : mode === 'status'
          ? a.status
          : mode === 'agent'
            ? (a.displayAgent ?? a.agent ?? 'unknown')
            : (a.repoRoot ?? a.cwd ?? 'no project');
    (bucket.get(k) ?? bucket.set(k, []).get(k)!).push(a);
  }
  for (const list of bucket.values()) list.sort(byAttention);

  if (mode === 'workspace') {
    // agentless spaces still come back (last) — the ＋ is how they get a session
    for (const w of workspaces) if (!bucket.has(w.workspaceId)) bucket.set(w.workspaceId, []);
    const known = new Map(workspaces.map((w) => [w.workspaceId, w]));
    const tabMap = new Map(tabs.map((t) => [t.tabId, t]));
    return [...bucket.entries()]
      .map(([key, list]) => {
        const w = known.get(key);
        return {
          key,
          title: w?.label || `workspace ${w?.number ?? '?'}`,
          badge: w?.worktree?.isLinked ? `⎇ ${w.worktree.repoName ?? 'worktree'}` : undefined,
          focused: w?.focused,
          status: w?.status,
          spawn: {
            workspaceId: key,
            cwd: w?.worktree?.checkoutPath ?? dominant(list, (a) => a.cwd),
          },
          agents: list,
          subs: splitByTab(list, tabMap),
          number: w?.number ?? 999,
        };
      })
      .sort((a, b) => byGroupRank(a, b) || a.number - b.number)
      .map(({ number, ...rest }, _i, all) =>
        // two spaces both called "~" read as a grouping bug — say which is which
        all.filter((g) => g.title === rest.title).length > 1
          ? { ...rest, badge: [rest.badge, `#${number}`].filter(Boolean).join(' ') }
          : rest,
      );
  }
  if (mode === 'status') {
    return [...bucket.entries()]
      .map(([key, list]) => ({ key, title: key, agents: list }))
      .sort((a, b) => (STATUS_ORDER[a.key] ?? 9) - (STATUS_ORDER[b.key] ?? 9));
  }
  if (mode === 'project') {
    return [...bucket.entries()]
      .map(([key, list]) => ({
        key,
        title: key === 'no project' ? key : basename(key),
        badge: list[0]?.repoRoot === key ? '⎇' : undefined,
        spawn:
          key === 'no project'
            ? undefined
            : { cwd: key, workspaceId: dominant(list, (a) => a.workspaceId) },
        agents: list,
      }))
      .sort((a, b) => byGroupRank(a, b) || a.title.localeCompare(b.title));
  }
  return [...bucket.entries()]
    .map(([key, list]) => ({ key, title: key, agents: list }))
    .sort((a, b) => byGroupRank(a, b) || a.title.localeCompare(b.title));
}

/** Sanitize a user-typed agent name for the daemon. */
export const cleanAgentName = (raw: string) =>
  raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^[^a-z]+/, '')
    .replace(/-{2,}/g, '-')
    .replace(/-+$/, '')
    .slice(0, 32);
