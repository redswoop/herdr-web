import { useEffect, useState } from 'react';
import { AgentView } from './components/AgentView';
import { RosterView } from './components/RosterView';
import { usePush } from './hooks/usePush';
import { useRoster } from './hooks/useRoster';

function paneFromHash(): string | null {
  const m = location.hash.match(/^#\/agent\/(.+)$/);
  return m ? decodeURIComponent(m[1]) : null;
}

export default function App() {
  const { roster, connected } = useRoster();
  const push = usePush();
  const [pane, setPane] = useState<string | null>(paneFromHash);

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

  if (pane) {
    return (
      <AgentView
        key={pane}
        agent={roster.agents.find((a) => a.paneId === pane)}
        onBack={() => {
          location.hash = '';
        }}
      />
    );
  }

  return (
    <RosterView
      roster={roster}
      connected={connected}
      pushSupported={push.supported}
      pushOn={push.subscribed}
      onToggPush={push.toggle}
      onOpen={(id) => {
        location.hash = `#/agent/${encodeURIComponent(id)}`;
      }}
    />
  );
}
