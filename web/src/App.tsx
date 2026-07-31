import { useEffect, useState } from 'react';
import { AgentView } from './components/AgentView';
import { NewChatDialog } from './components/NewChatDialog';
import { Sidebar } from './components/Sidebar';
import { TokenGate } from './components/TokenGate';
import { usePush } from './hooks/usePush';
import { useRoster } from './hooks/useRoster';

function paneFromHash(): string | null {
  const m = location.hash.match(/^#\/agent\/(.+)$/);
  return m ? decodeURIComponent(m[1]) : null;
}

export default function App() {
  const { roster, connected, authNeeded } = useRoster();
  const push = usePush();
  const [pane, setPane] = useState<string | null>(paneFromHash);
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
    const onHash = () => setPane(paneFromHash());
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

  if (authNeeded) return <TokenGate />;

  return (
    <div className={`shell ${pane ? 'has-selection' : ''} ${sideHidden ? 'side-hidden' : ''}`}>
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
      <div className="rail">
        <button className="ghost rail-toggle" aria-label="show session list" onClick={toggleSide}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 7l5 5-5 5M13 7l5 5-5 5" />
          </svg>
        </button>
        {blockedCount > 0 && (
          <span className="rail-blocked" title={`${blockedCount} blocked`}>{blockedCount}</span>
        )}
        <span className={`dot rail-dot ${connected ? 'ok' : ''}`} title="daemon connection" />
      </div>
      <div className="detail">
        {pane ? (
          <AgentView
            key={pane}
            agent={agent}
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
    </div>
  );
}
