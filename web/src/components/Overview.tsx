import { useCallback, useMemo, useRef, useState, type MouseEvent } from 'react';
import { byAttention, byGroupRank, chipName } from '@herdr/shared';
import { ThemeToggle } from './ui/ThemeToggle';
import { HomeToggle } from './ui/HomeToggle';
import { Freshness } from './ui/Freshness';
import { PullIndicator } from './ui/PullIndicator';
import { usePullToRefresh } from '../hooks/usePullToRefresh';
import type { Sync } from '../sync';
import type { SpawnTarget } from '../spawn';
import type { Agent, Roster, Workspace } from '../types';
import { STATUS_WORD, basename, shortPath } from '../util';
import { ContextMenu, menuAt, type MenuState } from './ui/ContextMenu';
import { agentMenuItems } from '../manage';

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
    c.agents.sort(byAttention);
    if (c.path) {
      // spawn joins the workspace most of the card's sessions live in
      const counts = new Map<string, number>();
      for (const a of c.agents) counts.set(a.workspaceId, (counts.get(a.workspaceId) ?? 0) + 1);
      const top = [...counts.entries()].sort((x, y) => y[1] - x[1])[0]?.[0];
      c.spawn = { cwd: c.path, workspaceId: top };
    }
  }
  // what needs me, then what I touched last — the list's order, per card
  return [...cards.values()].sort((a, b) => byGroupRank(a, b) || a.title.localeCompare(b.title));
}

/** Home surface: one card per project with its live sessions. Starting
 *  somewhere new is the ＋ dialog's job. */
export function Overview({
  roster,
  selected,
  onSelect,
  onNewChat,
  onShowList,
  connected,
  sync,
}: {
  roster: Roster;
  selected: string | null;
  onSelect: (paneId: string) => void;
  onNewChat: (target?: SpawnTarget) => void;
  /** phone only: switch the home surface back to the list */
  onShowList?: () => void;
  connected: boolean;
  sync: Sync;
}) {

  const scroller = useRef<HTMLDivElement>(null);
  const pulled = usePullToRefresh(scroller, sync.onRefresh);
  const cards = useMemo(() => buildCards(roster), [roster]);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);

  const blocked = roster.agents.filter((a) => a.status === 'blocked').length;
  const working = roster.agents.filter((a) => a.status === 'working').length;


  return (
    <>
      {onShowList && (
        // phone: the list's header, slot for slot, so the toggle stays put
        <header className="bar home-bar">
          <h1>🐑 herd</h1>
          <HomeToggle view="cards" onPick={onShowList} />
          <span className="bar-spacer" />
          <button className="ghost new-chat" onClick={() => onNewChat()} title="start a new chat">
            ＋
          </button>
          <Freshness connected={connected} {...sync} />
        </header>
      )}
    <div className="overview scroll" ref={scroller}>
      <PullIndicator {...pulled} />
      <header className={`ov-head ${onShowList ? 'sub-only' : ''}`}>
        {!onShowList && <h2>🐑 the herd</h2>}
        <span className="ov-summary sub">
          {roster.herdrDown
            ? 'herdr unreachable'
            : `${roster.agents.length} session${roster.agents.length === 1 ? '' : 's'}` +
              (blocked ? ` · ${blocked} need${blocked === 1 ? 's' : ''} you` : '') +
              (working ? ` · ${working} working` : '')}
        </span>
        <ThemeToggle compact />
        {!onShowList && (
          <button className="ghost new-chat" onClick={() => onNewChat()} title="start a new chat">
            ＋
          </button>
        )}
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
                  className="ghost group-spawn"
                  title="new session here"
                  onClick={() => onNewChat(c.spawn)}
                >
                  ＋
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
            {c.agents.map((a) => {
              const openMenu = (e: MouseEvent<HTMLElement>) =>
                setMenu(
                  menuAt(e, chipName(a), agentMenuItems(a, {
                    onClosed: () => {
                      if (a.paneId === selected) location.hash = '';
                    },
                  })),
                );
              return (
                <div key={a.paneId} className={`row-wrap ${a.paneId === selected ? 'active' : ''}`}>
                  <button
                    className={`ov-row ${a.status} ${a.paneId === selected ? 'active' : ''}`}
                    onClick={() => onSelect(a.paneId)}
                    onContextMenu={openMenu}
                  >
                    <span className={`status-dot ${a.status}`} />
                    <span className="ov-row-name">{chipName(a)}</span>
                    <span className="ov-row-agent sub">{a.displayAgent ?? a.agent}</span>
                    <span className={`state-word ${a.status}`}>
                      {STATUS_WORD[a.status] ?? a.status}
                    </span>
                  </button>
                  <button className="row-more" title="rename / close" aria-label="session menu" onClick={openMenu}>
                    ⋯
                  </button>
                </div>
              );
            })}
          </section>
        ))}

      </div>
    </div>
    <ContextMenu menu={menu} onClose={closeMenu} />
    </>
  );
}
