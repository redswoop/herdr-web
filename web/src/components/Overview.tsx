import { useEffect, useMemo, useState } from 'react';
import type { SpawnTarget } from '../spawn';
import type { Agent, Project, Roster, Workspace } from '../types';
import { STATUS_ORDER, STATUS_WORD, basename, shortPath } from '../util';

interface Card {
  key: string;
  title: string;
  path: string | null;
  repo: boolean;
  /** workspaces this project's sessions live in */
  workspaces: Workspace[];
  agents: Agent[];
  spawn?: SpawnTarget;
}

function buildCards(roster: Roster): Card[] {
  const wsById = new Map((roster.workspaces ?? []).map((w) => [w.workspaceId, w]));
  const cards = new Map<string, Card>();
  for (const a of roster.agents) {
    const key = a.repoRoot ?? a.cwd ?? 'nowhere';
    const c = cards.get(key) ?? {
      key,
      title: key === 'nowhere' ? 'no project' : basename(key),
      path: key === 'nowhere' ? null : key,
      repo: a.repoRoot === key,
      workspaces: [],
      agents: [],
    };
    c.agents.push(a);
    const w = wsById.get(a.workspaceId);
    if (w && !c.workspaces.includes(w)) c.workspaces.push(w);
    cards.set(key, c);
  }
  for (const c of cards.values()) {
    c.agents.sort(
      (a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9),
    );
    if (c.path) {
      // spawn joins the workspace most of the card's sessions live in
      const counts = new Map<string, number>();
      for (const a of c.agents) counts.set(a.workspaceId, (counts.get(a.workspaceId) ?? 0) + 1);
      const top = [...counts.entries()].sort((x, y) => y[1] - x[1])[0]?.[0];
      c.spawn = { cwd: c.path, workspaceId: top };
    }
  }
  return [...cards.values()].sort(
    (a, b) =>
      (STATUS_ORDER[a.agents[0]?.status] ?? 9) - (STATUS_ORDER[b.agents[0]?.status] ?? 9) ||
      b.agents.length - a.agents.length ||
      a.title.localeCompare(b.title),
  );
}

/** Home surface: one card per project with its live sessions, plus quick
 *  spawn targets for recently-used projects. */
export function Overview({
  roster,
  selected,
  onSelect,
  onNewChat,
  onQuickChat,
  onShowList,
}: {
  roster: Roster;
  selected: string | null;
  onSelect: (paneId: string) => void;
  onNewChat: (target?: SpawnTarget) => void;
  onQuickChat: (target: SpawnTarget) => Promise<void>;
  /** phone only: switch the home surface back to the list */
  onShowList?: () => void;
}) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [spawning, setSpawning] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/projects')
      .then((r) => r.json())
      .then((j: { projects: Project[] }) => alive && setProjects(j.projects))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [roster.agents.length]); // refetch when the herd changes size

  const cards = useMemo(() => buildCards(roster), [roster]);
  const dormant = useMemo(
    () => projects.filter((p) => p.live === 0).slice(0, 12),
    [projects],
  );

  const blocked = roster.agents.filter((a) => a.status === 'blocked').length;
  const working = roster.agents.filter((a) => a.status === 'working').length;

  const quick = async (key: string, target: SpawnTarget) => {
    if (spawning) return;
    setSpawning(key);
    try {
      await onQuickChat(target);
    } catch (e) {
      alert(String((e as Error).message ?? e));
    } finally {
      setSpawning(null);
    }
  };

  return (
    <div className="overview scroll">
      <header className="ov-head">
        {onShowList && (
          <button className="ghost" aria-label="show session list" onClick={onShowList}>
            ☰
          </button>
        )}
        <h2>🐑 the herd</h2>
        <span className="ov-summary sub">
          {roster.herdrDown
            ? 'herdr unreachable'
            : `${roster.agents.length} session${roster.agents.length === 1 ? '' : 's'}` +
              (blocked ? ` · ${blocked} need${blocked === 1 ? 's' : ''} you` : '') +
              (working ? ` · ${working} working` : '')}
        </span>
        <button className="ghost new-chat" onClick={() => onNewChat()} title="start a new chat">
          ＋
        </button>
      </header>

      <div className="ov-grid">
        {cards.map((c) => (
          <section key={c.key} className="ov-card">
            <header className="ov-card-head">
              <span className="ov-card-title">
                {c.repo && <span className="ov-badge">⎇</span>}
                {c.title}
              </span>
              {c.path && <span className="ov-path sub">{shortPath(c.path)}</span>}
              {c.spawn && (
                <button
                  className={`ghost group-spawn ${spawning === c.key ? 'busy' : ''}`}
                  title="new session here (right-click to customize)"
                  disabled={spawning !== null}
                  onClick={() => quick(c.key, c.spawn!)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    onNewChat(c.spawn);
                  }}
                >
                  {spawning === c.key ? '…' : '＋'}
                </button>
              )}
            </header>
            {c.workspaces.length > 0 && (
              <div className="ov-ws sub">
                {c.workspaces
                  .map((w) => (w.label || `workspace ${w.number}`) + (w.worktree?.isLinked ? ' ⎇' : ''))
                  .join(' · ')}
              </div>
            )}
            {c.agents.map((a) => (
              <button
                key={a.paneId}
                className={`ov-row ${a.status} ${a.paneId === selected ? 'active' : ''}`}
                onClick={() => onSelect(a.paneId)}
              >
                <span className={`status-dot ${a.status}`} />
                <span className="ov-row-name">{a.label || a.title || a.paneId}</span>
                <span className="ov-row-agent sub">{a.displayAgent ?? a.agent}</span>
                <span className={`state-word ${a.status}`}>
                  {STATUS_WORD[a.status] ?? a.status}
                </span>
              </button>
            ))}
          </section>
        ))}

        {dormant.length > 0 && (
          <section className="ov-card ov-dormant">
            <header className="ov-card-head">
              <span className="ov-card-title">start somewhere</span>
            </header>
            <div className="ov-pills">
              {dormant.map((p) => (
                <button
                  key={p.key}
                  className="ov-pill"
                  title={`${shortPath(p.path)} — tap to start a session, right-click to customize`}
                  disabled={spawning !== null}
                  onClick={() => quick(p.key, { cwd: p.path })}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    onNewChat({ cwd: p.path });
                  }}
                >
                  {p.repo && '⎇ '}
                  {spawning === p.key ? '…' : p.name}
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
