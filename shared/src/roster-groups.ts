import type { Agent, AgentStatus, Tab, Workspace } from './types';

/** Where a quick-spawned session should land (mirrors spawn.SpawnTarget). */
export interface SpawnTarget {
  workspaceId?: string;
  cwd?: string;
}

export type GroupBy = 'workspace' | 'status' | 'project' | 'agent';

export const GROUP_MODES: { key: GroupBy; label: string }[] = [
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

export const chipName = (a: Agent) => a.label || a.title || a.paneId;

export function buildGroups(
  agents: Agent[],
  workspaces: Workspace[],
  tabs: Tab[],
  mode: GroupBy,
): Group[] {
  const byStatus = (a: Agent, b: Agent) =>
    (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) ||
    chipName(a).localeCompare(chipName(b));

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
  for (const list of bucket.values()) list.sort(byStatus);

  if (mode === 'workspace') {
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
      .sort((a, b) => a.number - b.number)
      .map(({ number: _n, ...rest }) => rest);
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
      .sort((a, b) => a.title.localeCompare(b.title));
  }
  return [...bucket.entries()]
    .map(([key, list]) => ({ key, title: key, agents: list }))
    .sort((a, b) => a.title.localeCompare(b.title));
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
