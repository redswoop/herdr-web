import { useEffect, useState } from 'react';
import { AgentView } from './components/AgentView';
import { NewChatDialog } from './components/NewChatDialog';
import { Overview } from './components/Overview';
import { Sidebar } from './components/Sidebar';
import { TokenGate } from './components/TokenGate';
import { Chevrons } from './components/ui/Chevrons';
import { Split, SplitHandle, SplitPane } from './components/ui/Split';
import { WIDE, useMediaQuery } from './hooks/useMediaQuery';
import { usePush } from './hooks/usePush';
import { useRoster } from './hooks/useRoster';
import { lastKind, spawnChat, type SpawnTarget } from './spawn';

function routeFromHash(): { pane: string | null; file: string | null } {
  const m = location.hash.match(/^#\/agent\/([^/]+)(?:\/file\/(.+))?$/);
  if (!m) return { pane: null, file: null };
  return { pane: decodeURIComponent(m[1]), file: m[2] ? decodeURIComponent(m[2]) : null };
}

const HOME_VIEW_KEY = 'herdr.homeView';

export default function App() {
  const { roster, connected, authNeeded } = useRoster();
  const push = usePush();
  const [route, setRoute] = useState(routeFromHash);
  const pane = route.pane;
  const [sideHidden, setSideHidden] = useState(
    () => localStorage.getItem('herdr.sideHidden') === '1',
  );
  // phone home surface: session list or project cards
  const [homeView, setHomeView] = useState<'list' | 'cards'>(() =>
    localStorage.getItem(HOME_VIEW_KEY) === 'cards' ? 'cards' : 'list',
  );
  const [newChat, setNewChat] = useState<{ open: boolean; target?: SpawnTarget }>({ open: false });

  const pickHomeView = (v: 'list' | 'cards') => {
    localStorage.setItem(HOME_VIEW_KEY, v);
    setHomeView(v);
  };

  const toggleSide = () => {
    setSideHidden((h) => {
      localStorage.setItem('herdr.sideHidden', h ? '0' : '1');
      return !h;
    });
  };

  useEffect(() => {
    const onHash = () => setRoute(routeFromHash());
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  }, []);

  // tab-title badge: blocked count
  useEffect(() => {
    const blocked = roster.agents.filter((a) => a.status === 'blocked').length;
    document.title = blocked ? `(${blocked}) herdr` : 'herdr';
  }, [roster]);

  const agent = pane ? roster.agents.find((a) => a.paneId === pane) : undefined;
  const blockedCount = roster.agents.filter((a) => a.status === 'blocked').length;
  const wide = useMediaQuery(WIDE);

  if (authNeeded) return <TokenGate />;

  const select = (paneId: string) => {
    location.hash = `#/agent/${encodeURIComponent(paneId)}`;
  };

  // one-click spawn: last-used agent kind, straight to the new pane
  const quickChat = async (target: SpawnTarget) => {
    select(await spawnChat({ kind: lastKind(), ...target }));
  };

  const openNewChat = (target?: SpawnTarget) => setNewChat({ open: true, target });

  const sidebar = (
    <Sidebar
      roster={roster}
      connected={connected}
      selected={pane}
      onSelect={select}
      pushSupported={push.supported}
      pushOn={push.subscribed}
      onTogglePush={push.toggle}
      onCollapse={toggleSide}
      onNewChat={openNewChat}
      onQuickChat={quickChat}
      onShowCards={!wide ? () => pickHomeView('cards') : undefined}
    />
  );

  const overview = (onShowList?: () => void) => (
    <Overview
      roster={roster}
      selected={pane}
      onSelect={select}
      onNewChat={openNewChat}
      onQuickChat={quickChat}
      onShowList={onShowList}
    />
  );

  const detail = (
    <div className="detail">
      {pane ? (
        <AgentView
          key={pane}
          paneId={pane}
          agent={agent}
          file={route.file}
          onBack={() => {
            location.hash = '';
          }}
        />
      ) : (
        overview()
      )}
    </div>
  );

  return (
    <div className={`shell ${pane ? 'has-selection' : ''} ${sideHidden ? 'side-hidden' : ''}`}>
      {/* updatedAt gate keeps this from flashing during initial load */}
      {!connected && roster.updatedAt > 0 && (
        <div className="conn-banner">connection lost — reconnecting…</div>
      )}
      {newChat.open && (
        <NewChatDialog
          roster={roster}
          target={newChat.target}
          onClose={() => setNewChat({ open: false })}
          onCreated={(paneId) => {
            setNewChat({ open: false });
            select(paneId);
          }}
        />
      )}
      {wide && !sideHidden ? (
        // desktop, sidebar visible → resizable split
        <Split id="shell" className="shell-split">
          <SplitPane id="side" defaultSize={320} minSize={220} maxSize={480}>
            {sidebar}
          </SplitPane>
          <SplitHandle />
          <SplitPane id="detail" minSize={400}>{detail}</SplitPane>
        </Split>
      ) : (
        // phone (home ↔ detail swap) and collapsed-to-rail desktop —
        // visibility handled by the .shell CSS classes
        <>
          {!wide && homeView === 'cards' ? (
            <div className="home-surface">{overview(() => pickHomeView('list'))}</div>
          ) : (
            sidebar
          )}
          <div className="rail">
            <button className="ghost rail-toggle" aria-label="show session list" onClick={toggleSide}>
              <Chevrons dir="right" />
            </button>
            {blockedCount > 0 && (
              <span className="rail-blocked" title={`${blockedCount} blocked`}>{blockedCount}</span>
            )}
            <span className={`dot rail-dot ${connected ? 'ok' : ''}`} title="daemon connection" />
          </div>
          {detail}
        </>
      )}
    </div>
  );
}
