import { useEffect, useState } from 'react';
import { AgentView } from './components/AgentView';
import { NewChatDialog } from './components/NewChatDialog';
import { Sidebar } from './components/Sidebar';
import { TokenGate } from './components/TokenGate';
import { Chevrons } from './components/ui/Chevrons';
import { Split, SplitHandle, SplitPane } from './components/ui/Split';
import { WIDE, useMediaQuery } from './hooks/useMediaQuery';
import { usePush } from './hooks/usePush';
import { useRoster } from './hooks/useRoster';

function routeFromHash(): { pane: string | null; file: string | null } {
  const m = location.hash.match(/^#\/agent\/([^/]+)(?:\/file\/(.+))?$/);
  if (!m) return { pane: null, file: null };
  return { pane: decodeURIComponent(m[1]), file: m[2] ? decodeURIComponent(m[2]) : null };
}

export default function App() {
  const { roster, connected, authNeeded } = useRoster();
  const push = usePush();
  const [route, setRoute] = useState(routeFromHash);
  const pane = route.pane;
  const [sideHidden, setSideHidden] = useState(
    () => localStorage.getItem('herdr.sideHidden') === '1',
  );
  const [newChatOpen, setNewChatOpen] = useState(false);

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

  const sidebar = (
    <Sidebar
      roster={roster}
      connected={connected}
      selected={pane}
      onSelect={(id) => {
        location.hash = `#/agent/${encodeURIComponent(id)}`;
      }}
      pushSupported={push.supported}
      pushOn={push.subscribed}
      onTogglePush={push.toggle}
      onCollapse={toggleSide}
      onNewChat={() => setNewChatOpen(true)}
    />
  );

  const detail = (
    <div className="detail">
      {pane ? (
        <AgentView
          key={pane}
          agent={agent}
          file={route.file}
          onBack={() => {
            location.hash = '';
          }}
        />
      ) : (
        <div className="placeholder">
          <div className="placeholder-inner">
            <div className="placeholder-emoji">🐑</div>
            <div>pick a session</div>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className={`shell ${pane ? 'has-selection' : ''} ${sideHidden ? 'side-hidden' : ''}`}>
      {newChatOpen && (
        <NewChatDialog
          roster={roster}
          onClose={() => setNewChatOpen(false)}
          onCreated={(paneId) => {
            setNewChatOpen(false);
            location.hash = `#/agent/${encodeURIComponent(paneId)}`;
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
        // phone (sidebar ↔ detail swap) and collapsed-to-rail desktop —
        // visibility handled by the .shell CSS classes
        <>
          {sidebar}
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
