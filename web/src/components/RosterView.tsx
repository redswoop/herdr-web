import type { Agent, Roster } from '../types';

const ORDER: Record<string, number> = { blocked: 0, working: 1, idle: 2, unknown: 3, done: 4 };

export function RosterView({
  roster,
  connected,
  pushSupported,
  pushOn,
  onToggPush,
  onOpen,
}: {
  roster: Roster;
  connected: boolean;
  pushSupported: boolean;
  pushOn: boolean;
  onToggPush: () => void;
  onOpen: (paneId: string) => void;
}) {
  const agents = [...roster.agents].sort(
    (a, b) => (ORDER[a.status] ?? 9) - (ORDER[b.status] ?? 9),
  );

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
    <div className="view">
      <header className="bar">
        <h1>🐑 herd</h1>
        <button className="build sub" onClick={showDiagnostics} title="server build · tap for details">
          {roster.build ?? ''}
        </button>
        {pushSupported && (
          <button
            className={`ghost bell ${pushOn ? 'on' : ''}`}
            onClick={onToggPush}
            title="notify when an agent blocks"
          >
            {pushOn ? '🔔' : '🔕'}
          </button>
        )}
        <span className={`dot ${connected ? 'ok' : ''}`} title="daemon connection" />
      </header>
      <main className="scroll">
        {agents.length === 0 ? (
          <div className="empty">
            {roster.herdrDown ? 'herdr server unreachable' : 'no agents detected'}
          </div>
        ) : (
          agents.map((a) => <AgentCard key={a.paneId} agent={a} onOpen={onOpen} />)
        )}
      </main>
    </div>
  );
}

function AgentCard({ agent: a, onOpen }: { agent: Agent; onOpen: (id: string) => void }) {
  return (
    <button className={`card ${a.status}`} onClick={() => onOpen(a.paneId)}>
      <span className={`status-dot ${a.status}`} />
      <span className="info">
        <span className="title">
          {a.agent ?? '?'} <span className="title-sep">·</span> {a.title || a.paneId}
        </span>
        <span className="sub">
          {a.cwd ?? ''}
          {a.hasTranscript ? '' : ' · no transcript'}
        </span>
      </span>
      <span className={`chip ${a.status}`}>{a.status}</span>
    </button>
  );
}
