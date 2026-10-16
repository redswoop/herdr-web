import { useEffect, useMemo, useRef, useState } from 'react';
import {
  GROUP_MODES,
  buildGroups,
  chipName,
  dominant,
  type Group,
  type GroupBy,
} from '@herdr/shared';
import type { SpawnTarget } from '../spawn';
import type { Agent, Roster } from '../types';
import { STATUS_WORD, agoShort, basename } from '../util';
import { Chevrons } from './ui/Chevrons';
import { HomeToggle } from './ui/HomeToggle';
import { Freshness } from './ui/Freshness';
import { PullIndicator } from './ui/PullIndicator';
import { usePullToRefresh } from '../hooks/usePullToRefresh';
import type { Sync } from '../sync';

const GROUPBY_KEY = 'herdr.groupBy';
const CLOSED_KEY = 'herdr.groupsClosed';

function loadGroupBy(): GroupBy {
  try {
    const v = localStorage.getItem(GROUPBY_KEY);
    return GROUP_MODES.some((m) => m.key === v) ? (v as GroupBy) : 'recent';
  } catch {
    return 'recent';
  }
}

function loadClosed(): Set<string> {
  try {
    const j = JSON.parse(localStorage.getItem(CLOSED_KEY) ?? '[]');
    return new Set(Array.isArray(j) ? j.filter((x) => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

/** re-render on an interval so "3m" ages without a roster push */
function useNow(everyMs: number): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

const folderOf = (cwd: string | null) =>
  !cwd ? null : /^\/home\/[^/]+\/?$/.test(cwd) ? '~' : basename(cwd);

export function Sidebar({
  roster,
  connected,
  sync,
  selected,
  onSelect,
  pushSupported,
  pushOn,
  onTogglePush,
  onCollapse,
  onNewChat,
  onShowCards,
}: {
  roster: Roster;
  connected: boolean;
  /** roster freshness + manual refresh (pull, dot tap) */
  sync: Sync;
  selected: string | null;
  onSelect: (paneId: string) => void;
  pushSupported: boolean;
  pushOn: boolean;
  onTogglePush: () => void;
  onCollapse: () => void;
  /** open the full launcher, optionally pre-aimed at a place */
  onNewChat: (target?: SpawnTarget) => void;
  /** one-click spawn with defaults; resolves when the pane is live */
  /** phone only: swap the home surface to the project-card overview */
  onShowCards?: () => void;
}) {
  const [groupBy, setGroupBy] = useState<GroupBy>(loadGroupBy);
  const [collapsed, setCollapsed] = useState<Set<string>>(loadClosed);

  const [modesOpen, setModesOpen] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const pulled = usePullToRefresh(scroller, sync.onRefresh);
  const now = useNow(30_000);

  const pick = (mode: GroupBy) => {
    setGroupBy(mode);
    setModesOpen(false);
    try {
      localStorage.setItem(GROUPBY_KEY, mode);
    } catch {}
  };

  const groups = useMemo(
    () => buildGroups(roster.agents, roster.workspaces ?? [], roster.tabs ?? [], groupBy, now),
    [roster, groupBy, now],
  );
  // agentless spaces fold into one row at the bottom instead of a header each
  const [filled, empties] = useMemo(
    () => [groups.filter((g) => g.agents.length > 0), groups.filter((g) => g.agents.length === 0)],
    [groups],
  );
  // the agent most chats run — saying "claude" on every row is noise
  const usualAgent = useMemo(() => dominant(roster.agents, (a) => a.agent), [roster]);
  const isClosed = (g: Pick<Group, 'key' | 'defaultClosed'>) =>
    collapsed.has(`${groupBy}:${g.key}`) !== !!g.defaultClosed;

  const toggleGroup = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      try {
        // cap so stale group keys can't accumulate forever
        localStorage.setItem(CLOSED_KEY, JSON.stringify([...next].slice(-100)));
      } catch {}
      return next;
    });

  const head = (g: Group) => {
    const closed = isClosed(g);
    const blocked = g.agents.filter((a) => a.status === 'blocked').length;
    return (
      <div className={`group-row ${closed ? 'closed' : ''}`}>
        <button
          className={`group-head ${closed ? 'closed' : ''}`}
          onClick={() => toggleGroup(`${groupBy}:${g.key}`)}
        >
          <svg className="chev" viewBox="0 0 24 24" width="12" height="12" fill="none"
            stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 6l6 6-6 6" />
          </svg>
          {g.status && g.agents.length > 0 && <span className={`status-dot ${g.status}`} />}
          <span className="group-title">{g.title}</span>
          {g.badge && <span className="group-badge">{g.badge}</span>}
          {g.focused && <span className="group-badge eye" title="focused in the TUI">⌖</span>}
          {g.agents.length > 0 && (
            <span className="group-count">
              {blocked > 0 && <em className="blocked-count">{blocked}</em>}
              {g.agents.length}
            </span>
          )}
        </button>
        {g.spawn && (
          <button className="ghost group-spawn" title="new session here" onClick={() => onNewChat(g.spawn)}>
            ＋
          </button>
        )}
      </div>
    );
  };

  // the group header already says the folder in space/project modes
  const groupTitleOf = (a: Agent) =>
    groupBy === 'workspace'
      ? groups.find((g) => g.key === a.workspaceId)?.title
      : groupBy === 'project'
        ? groups.find((g) => g.agents.includes(a))?.title
        : undefined;

  const row = (a: Agent) => {
    const folder = folderOf(a.cwd);
    const meta = [
      folder && folder.toLowerCase() !== groupTitleOf(a)?.toLowerCase() ? folder : null,
      groupBy !== 'agent' && a.agent !== usualAgent ? (a.displayAgent ?? a.agent) : null,
    ].filter(Boolean);
    return (
      <SessionChip
        key={a.paneId}
        agent={a}
        meta={meta.join(' · ')}
        now={now}
        active={a.paneId === selected}
        onSelect={onSelect}
      />
    );
  };

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
      <header className="bar home-bar">
        <h1>🐑 herd</h1>
        {onShowCards && <HomeToggle view="list" onPick={onShowCards} />}
        <span className="bar-spacer" />
        <button
          className={`ghost group-trigger ${groupBy !== 'recent' ? 'on' : ''}`}
          onClick={() => setModesOpen((o) => !o)}
          title="sort / group"
          aria-label="sort and group sessions"
        >
          {groupBy === 'recent' ? '⇅' : GROUP_MODES.find((m) => m.key === groupBy)?.label}
        </button>
        <button className="ghost new-chat" onClick={() => onNewChat()} title="start a new chat">
          ＋
        </button>
        {pushSupported && (
          <button
            className={`ghost bell ${pushOn ? 'on' : ''}`}
            onClick={onTogglePush}
            title="notify when an agent blocks"
          >
            {pushOn ? '🔔' : '🔕'}
          </button>
        )}
        <Freshness connected={connected} {...sync} />
        <button className="ghost side-collapse" aria-label="hide session list" onClick={onCollapse}>
          <Chevrons dir="left" />
        </button>
        {modesOpen && (
          <>
            <div className="pop-backdrop" onClick={() => setModesOpen(false)} />
            <div className="mode-pop" role="menu">
              {GROUP_MODES.map((m) => (
                <button
                  key={m.key}
                  role="menuitemradio"
                  aria-checked={groupBy === m.key}
                  className={`mode-row ${groupBy === m.key ? 'current' : ''}`}
                  onClick={() => pick(m.key)}
                >
                  <span className="mode-name">
                    {groupBy === m.key ? '❯ ' : ''}
                    {m.key === 'recent' ? 'recent' : `by ${m.label}`}
                  </span>
                  <span className="mode-desc">{MODE_DESC[m.key]}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </header>

      <div className="scroll sessions" ref={scroller}>
        <PullIndicator {...pulled} />
        {roster.agents.length === 0 && (roster.workspaces ?? []).length === 0 ? (
          <div className="empty">
            {roster.herdrDown ? 'herdr server unreachable' : 'no agents detected'}
          </div>
        ) : (
          <>
            {filled.map((g) =>
              g.flat ? (
                <section key={g.key} className="group flat">
                  {g.agents.map(row)}
                </section>
              ) : (
                <section key={g.key} className="group">
                  {head(g)}
                  {!isClosed(g) &&
                    (g.subs
                      ? g.subs.map((t) => (
                          <div key={t.key} className="tab-sub">
                            <div className="tab-head">
                              <span className="tab-title">{t.title}</span>
                              {t.focused && <span className="group-badge eye" title="active tab in the TUI">⌖</span>}
                            </div>
                            {t.agents.map(row)}
                          </div>
                        ))
                      : g.agents.map(row))}
                </section>
              ),
            )}
            {empties.length > 0 && (
              <section className="group empties">
                {head({ key: '__empty', title: `${empties.length} empty space${empties.length > 1 ? 's' : ''}`, agents: [], defaultClosed: true })}
                {!isClosed({ key: '__empty', defaultClosed: true }) && empties.map((g) => <div key={g.key}>{head(g)}</div>)}
              </section>
            )}
          </>
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

const MODE_DESC: Record<GroupBy, string> = {
  recent: 'needs-you first, then most recently active',
  workspace: 'herdr spaces, busiest first',
  project: 'git repo / folder',
  agent: 'claude, grok, pi, codex…',
  status: 'needs you · working · idle',
};

function SessionChip({
  agent: a,
  meta,
  now,
  active,
  onSelect,
}: {
  agent: Agent;
  meta: string;
  now: number;
  active: boolean;
  onSelect: (paneId: string) => void;
}) {
  const labels = Object.entries(a.stateLabels ?? {});
  // launchPending can linger minutes after the agent is up — only call it
  // "starting" while herdr has no read on it yet
  const starting = a.launchPending && a.status === 'unknown';
  const fresh = !a.hasTranscript && a.status !== 'unknown';
  const loud = a.status === 'blocked' || a.status === 'working';
  return (
    <button
      className={`session ${a.status} ${active ? 'active' : ''} ${fresh ? 'fresh' : ''}`}
      onClick={() => onSelect(a.paneId)}
      title={[a.cwd, fresh ? 'no messages yet' : null].filter(Boolean).join(' — ') || undefined}
    >
      <span className={`status-dot ${a.status}`} />
      <span className="info">
        <span className="title">
          {chipName(a)}
          {a.focused && <span className="focus-mark" title="focused in the TUI"> ⌖</span>}
        </span>
        {meta && <span className="sub">{meta}</span>}
        {(starting || labels.length > 0) && (
          <span className="tags">
            {starting && <span className="tag warn">starting…</span>}
            {labels.map(([k, v]) => (
              <span key={k} className="tag" title={k}>
                {v}
              </span>
            ))}
          </span>
        )}
      </span>
      {loud ? (
        <span className={`state-word ${a.status}`}>{STATUS_WORD[a.status]}</span>
      ) : a.lastActiveAt ? (
        <span className="age" title={new Date(a.lastActiveAt).toLocaleString()}>
          {agoShort(a.lastActiveAt, now)}
        </span>
      ) : null}
    </button>
  );
}
