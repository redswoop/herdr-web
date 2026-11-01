/* herdr's tab bar for the open chat's space, over the chat (TODO #22): the
   space name, then one pill per chat in herdr's tab order — number + a short
   name, the full story on hover — so it reads like the TUI's. The pill
   you're reading is lit; order never shifts under you. Wide only; the phone
   has the list. Lives in App so it survives the switch it causes. */
import { useCallback, useState, type MouseEvent } from 'react';
import { STATUS_WORD, chipName, workspaceTabs, type Agent, type Roster } from '@herdr/shared';
import type { SpawnTarget } from '../spawn';
import { agentMenuItems, renameAgentTo, workspaceMenuItems } from '../manage';
import { shortPath } from '../util';
import { ContextMenu, menuAt, type MenuState } from './ui/ContextMenu';

const SHORT = 18;
const short = (s: string) => (s.length > SHORT ? `${s.slice(0, SHORT - 1).trimEnd()}…` : s);

export function TabStrip({
  roster,
  agent,
  onSelect,
  onNewChat,
}: {
  roster: Roster;
  /** the chat being read — its workspace is the strip */
  agent: Agent;
  onSelect: (paneId: string) => void;
  onNewChat: (target: SpawnTarget) => void;
}) {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const sameHost = (h: string | undefined) => (h ?? '') === (agent.host ?? '');
  const space = (roster.workspaces ?? []).find((w) => w.workspaceId === agent.workspaceId && sameHost(w.host));
  const tabNo = new Map((roster.tabs ?? []).filter((t) => sameHost(t.host)).map((t) => [t.tabId, t.number]));
  const tabs = workspaceTabs(roster.agents, roster.tabs ?? [], agent.workspaceId, agent.host);
  const title = space?.label || `workspace ${space?.number ?? '?'}`;
  const spawn: SpawnTarget = {
    workspaceId: agent.workspaceId,
    cwd: space?.worktree?.checkoutPath ?? agent.cwd ?? undefined,
    host: agent.host || undefined,
  };

  // closing the chat you're reading lands you on its neighbour, not the overview
  const afterClose = (closed: Agent) => {
    if (closed.paneId !== agent.paneId) return;
    const i = tabs.findIndex((t) => t.paneId === closed.paneId);
    const next = tabs[i + 1] ?? tabs[i - 1];
    if (next) onSelect(next.paneId);
    else location.hash = '';
  };
  const tabMenu = (a: Agent) => (e: MouseEvent<HTMLElement>) =>
    setMenu(menuAt(e, chipName(a), agentMenuItems(a, { onClosed: () => afterClose(a) })));
  const spaceMenu = (e: MouseEvent<HTMLElement>) =>
    setMenu(menuAt(e, title, workspaceMenuItems(agent.workspaceId, title, tabs.length)));

  // the hover card, until there's a richer one
  const hover = (a: Agent) =>
    [
      chipName(a),
      `${a.displayAgent ?? a.agent} · ${STATUS_WORD[a.status] ?? a.status}`,
      a.cwd ? shortPath(a.cwd) : null,
      'right-click: rename / close',
    ]
      .filter(Boolean)
      .join('\n');

  return (
    <div className="tab-strip" role="tablist" aria-label={`chats in ${title}`}>
      <button
        className="strip-space"
        title={`space ${title}${space?.worktree?.isLinked ? ` · ⎇ ${space.worktree.repoName ?? 'worktree'}` : ''}\nclick: rename / close`}
        onContextMenu={spaceMenu}
        onClick={spaceMenu}
      >
        {title}
      </button>
      {tabs.map((a) => {
        const current = a.paneId === agent.paneId;
        const n = tabNo.get(a.tabId);
        return (
          <button
            key={a.paneId}
            role="tab"
            aria-selected={current}
            className={`pill ${a.status} ${current ? 'current' : ''}`}
            title={hover(a)}
            onClick={() => !current && onSelect(a.paneId)}
            onContextMenu={tabMenu(a)}
            onDoubleClick={() => {
              const t = prompt('Rename — the tab and the agent both take the new name.', chipName(a));
              if (t != null) void renameAgentTo(a, t);
            }}
          >
            {n != null && <span className="pill-n">{n}</span>}
            <span className={`status-dot ${a.status}`} />
            <span className="pill-name">{short(chipName(a))}</span>
          </button>
        );
      })}
      <button className="ghost strip-new" title={`new chat in ${title}`} aria-label={`new chat in ${title}`} onClick={() => onNewChat(spawn)}>
        ＋
      </button>
      <ContextMenu menu={menu} onClose={closeMenu} />
    </div>
  );
}
