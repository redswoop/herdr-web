import { useMemo, useState } from 'react';
import type { Agent, Roster, Workspace } from '../types';

export type GroupBy = 'workspace' | 'status' | 'project' | 'agent';

const GROUP_MODES: { key: GroupBy; label: string }[] = [
  { key: 'workspace', label: 'space' },
  { key: 'project', label: 'project' },
  { key: 'agent', label: 'agent' },
  { key: 'status', label: 'status' },
];

const STATUS_ORDER: Record<string, number> = { blocked: 0, working: 1, idle: 2, unknown: 3, done: 4 };
const STATUS_WORD: Record<string, string> = {
  blocked: 'needs you',
  working: 'working…',
  idle: 'idle',
  done: 'done',
  unknown: '?',
};

const GROUPBY_KEY = 'herdr.groupBy';

function loadGroupBy(): GroupBy {
  const v = localStorage.getItem(GROUPBY_KEY);
  return v === 'status' || v === 'project' || v === 'agent' ? v : 'workspace';
}

const basename = (p: string) => p.replace(/\/+$/, '').split('/').pop() || p;

interface Group {
  key: string;
  title: string;
  badge?: string; // small dim tag next to the title (worktree, ws number…)
  focused?: boolean;
  agents: Agent[];
}

function buildGroups(agents: Agent[], workspaces: Workspace[], mode: GroupBy): Group[] {
  const byStatus = (a: Agent, b: Agent) =>
    (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) ||
    chipName(a).localeCompare(chipName(b));

  const bucket = new Map<string, Agent[]>();
  for (const a of agents) {
    const k =
      mode === 'workspace' ? a.workspaceId
      : mode === 'status' ? a.status
      : mode === 'agent' ? (a.displayAgent ?? a.agent ?? 'unknown')
      : a.cwd ? basename(a.cwd) : 'no project';
    (bucket.get(k) ?? bucket.set(k, []).get(k)!).push(a);
  }
  for (const list of bucket.values()) list.sort(byStatus);

  if (mode === 'workspace') {
    const known = new Map(workspaces.map((w) => [w.workspaceId, w]));
    return [...bucket.entries()]
      .map(([key, list]) => {
        const w = known.get(key);
        return {
          key,
          title: w?.label || `workspace ${w?.number ?? '?'}`,
          badge: w?.worktree?.isLinked ? `⎇ ${w.worktree.repoName ?? 'worktree'}` : undefined,
          focused: w?.focused,
          agents: list,
          number: w?.number ?? 999,
        };
      })
      .sort((a, b) => a.number - b.number);
  }
  if (mode === 'status') {
    return [...bucket.entries()]
      .map(([key, list]) => ({ key, title: key, agents: list }))
      .sort((a, b) => (STATUS_ORDER[a.key] ?? 9) - (STATUS_ORDER[b.key] ?? 9));
  }
  return [...bucket.entries()]
    .map(([key, list]) => ({ key, title: key, agents: list }))
    .sort((a, b) => a.title.localeCompare(b.title));
}

const chipName = (a: Agent) => a.label || a.title || a.paneId;

export function Sidebar({
  roster,
  connected,
  selected,
  onSelect,
  pushSupported,
  pushOn,
  onTogglePush,
  onCollapse,
}: {
  roster: Roster;
  connected: boolean;
  selected: string | null;
  onSelect: (paneId: string) => void;
  pushSupported: boolean;
  pushOn: boolean;
  onTogglePush: () => void;
  onCollapse: () => void;
}) {
  const [groupBy, setGroupBy] = useState<GroupBy>(loadGroupBy);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const pick = (mode: GroupBy) => {
    setGroupBy(mode);
    localStorage.setItem(GROUPBY_KEY, mode);
  };

  const groups = useMemo(
    () => buildGroups(roster.agents, roster.workspaces ?? [], groupBy),
    [roster, groupBy],
  );

  const toggleGroup = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  const showDiagnostics = () => {
    const secure = window.isSecureContext;
    alert(
      [
        `server build: ${roster.build ?? '?'}`,
        `booted: ${roster.bootedAt ?? '?'}`,
        `secure context: ${secure} ${secure ? '' : '(push/PWA need HTTPS)'}`,
        `service worker: ${'serviceWorker' in navigator}`,
        `push API: ${'PushManager' in window}`,
      ].join('\n'),
    );
  };

  return (
    <nav className="sidebar">
      <header className="bar">
        <h1>🐑 herd</h1>
        {pushSupported && (
          <button
            className={`ghost bell ${pushOn ? 'on' : ''}`}
            onClick={onTogglePush}
            title="notify when an agent blocks"
          >
            {pushOn ? '🔔' : '🔕'}
          </button>
        )}
        <span className={`dot ${connected ? 'ok' : ''}`} title="daemon connection" />
        <button className="ghost side-collapse" aria-label="hide session list" onClick={onCollapse}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 7l-5 5 5 5M11 7l-5 5 5 5" />
          </svg>
        </button>
      </header>

      <div className="groupby" role="tablist" aria-label="group sessions by">
        {GROUP_MODES.map((m) => (
          <button
            key={m.key}
            role="tab"
            aria-selected={groupBy === m.key}
            className={groupBy === m.key ? 'on' : ''}
            onClick={() => pick(m.key)}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="scroll sessions">
        {roster.agents.length === 0 ? (
          <div className="empty">
            {roster.herdrDown ? 'herdr server unreachable' : 'no agents detected'}
          </div>
        ) : (
          groups.map((g) => {
            const closed = collapsed.has(`${groupBy}:${g.key}`);
            const blocked = g.agents.filter((a) => a.status === 'blocked').length;
            return (
              <section key={g.key} className="group">
                <button
                  className={`group-head ${closed ? 'closed' : ''}`}
                  onClick={() => toggleGroup(`${groupBy}:${g.key}`)}
                >
                  <svg className="chev" viewBox="0 0 24 24" width="12" height="12" fill="none"
                    stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 6l6 6-6 6" />
                  </svg>
                  <span className="group-title">{g.title}</span>
                  {g.badge && <span className="group-badge">{g.badge}</span>}
                  {g.focused && <span className="group-badge eye" title="focused in the TUI">⌖</span>}
                  <span className="group-count">
                    {blocked > 0 && <em className="blocked-count">{blocked}</em>}
                    {g.agents.length}
                  </span>
                </button>
                {!closed &&
                  g.agents.map((a) => (
                    <SessionChip
                      key={a.paneId}
                      agent={a}
                      active={a.paneId === selected}
                      showAgent={groupBy !== 'agent'}
                      onSelect={onSelect}
                    />
                  ))}
              </section>
            );
          })
        )}
      </div>

      <footer className="side-foot">
        <button className="build sub" onClick={showDiagnostics} title="server build · tap for details">
          {roster.build ?? ''}
        </button>
      </footer>
    </nav>
  );
}

function SessionChip({
  agent: a,
  active,
  showAgent,
  onSelect,
}: {
  agent: Agent;
  active: boolean;
  showAgent: boolean;
  onSelect: (paneId: string) => void;
}) {
  const labels = Object.entries(a.stateLabels ?? {});
  return (
    <button
      className={`session ${a.status} ${active ? 'active' : ''}`}
      onClick={() => onSelect(a.paneId)}
      title={a.cwd ?? undefined}
    >
      <span className={`status-dot ${a.status}`} />
      <span className="info">
        <span className="title">
          {chipName(a)}
          {a.focused && <span className="focus-mark" title="focused in the TUI"> ⌖</span>}
        </span>
        <span className="sub">
          {showAgent && (a.displayAgent ?? a.agent ?? '?')}
          {showAgent && a.cwd ? ' · ' : ''}
          {a.cwd ? basename(a.cwd) : ''}
        </span>
        {(labels.length > 0 || !a.hasTranscript || a.launchPending) && (
          <span className="tags">
            {a.launchPending && <span className="tag warn">starting…</span>}
            {!a.hasTranscript && !a.launchPending && <span className="tag warn">no transcript</span>}
            {labels.map(([k, v]) => (
              <span key={k} className="tag" title={k}>
                {v}
              </span>
            ))}
          </span>
        )}
      </span>
      <span className={`state-word ${a.status}`}>{STATUS_WORD[a.status] ?? a.status}</span>
    </button>
  );
}
