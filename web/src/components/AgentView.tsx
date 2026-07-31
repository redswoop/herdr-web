import { useEffect, useMemo, useState } from 'react';
import { agentPath, post } from '../api';
import { useAgentSession } from '../hooks/useAgentSession';
import { useBlockedContext } from '../hooks/useBlockedContext';
import type { Agent } from '../types';
import { BlockedCard } from './BlockedCard';
import { Composer } from './Composer';
import { Transcript } from './Transcript';

export function AgentView({ agent, onBack }: { agent: Agent | undefined; onBack: () => void }) {
  const paneId = agent?.paneId ?? '';
  const status = agent?.status;
  const { items, error, send, interrupt, cooldown } = useAgentSession(paneId);
  const { ctx, refresh } = useBlockedContext(paneId, status);
  const [screen, setScreen] = useState<string | null>(null);
  const [keysPinned, setKeysPinned] = useState(false);
  const [keysForced, setKeysForced] = useState(false); // 409 fallback

  const blocked = status === 'blocked';
  useEffect(() => {
    if (!blocked) {
      setKeysForced(false);
      setScreen(null);
    }
  }, [blocked]);

  // the latest locally-sent bubble gets tap-to-stop while the agent works
  const cancellableKey = useMemo(() => {
    if (status !== 'working') return null;
    for (let i = items.length - 1; i >= 0; i -= 1) {
      const it = items[i];
      if (it.type === 'mine' && (it.mine.state === 'sent' || it.mine.state === 'confirmed')) {
        return it.mine.key;
      }
    }
    return null;
  }, [items, status]);

  const onAnswer = async (keys: string[], expect: string | null) => {
    const r = await post(agentPath(paneId, 'answer'), { keys, expect });
    if (r.status === 409) {
      // screen no longer shows what we thought — fall back to raw controls
      setKeysForced(true);
      alert('The screen changed — showing raw keys instead.');
      return false;
    }
    if (!r.ok) {
      alert((await r.json()).error ?? r.statusText);
      return false;
    }
    setTimeout(refresh, 600); // menu may advance to the next question
    return true;
  };

  const peekScreen = async () => {
    if (screen !== null) {
      setScreen(null);
      return;
    }
    const r = await fetch(agentPath(paneId, 'screen'));
    const { text } = await r.json();
    setScreen((text ?? '').replace(/\n{3,}/g, '\n\n').trimEnd());
  };

  const showBlockedCard = blocked && !keysForced && ctx != null && ctx.kind !== 'none' && ctx.kind !== 'unknown';
  const showKeys = keysPinned || (blocked && (keysForced || ctx?.kind === 'unknown'));

  return (
    <div className="view">
      <header className="bar">
        <button className="ghost back" aria-label="back" onClick={onBack}>
          ←
        </button>
        <div className="who">
          <div className="agent-name">
            {agent ? `${agent.agent} · ${agent.paneId}` : paneId}
          </div>
          <div className="sub">{agent?.cwd ?? ''}</div>
        </div>
        <span className={`chip ${status ?? ''}`}>{status ?? '—'}</span>
      </header>

      {blocked && (
        <div className="blocked-banner">
          <span className="banner-text">agent is waiting on you</span>
          <button className="ghost" onClick={peekScreen}>
            {screen !== null ? 'hide screen' : 'view screen'}
          </button>
        </div>
      )}
      {screen !== null && <pre className="screen">{screen}</pre>}

      <Transcript
        items={items}
        error={error}
        cancellableKey={cancellableKey}
        onInterrupt={interrupt}
      />

      {showBlockedCard && ctx && <BlockedCard ctx={ctx} onAnswer={onAnswer} />}

      <Composer
        paneId={paneId}
        status={status}
        cooldown={cooldown}
        showKeys={showKeys}
        onSend={send}
        onInterrupt={interrupt}
        onToggleKeys={() => setKeysPinned((p) => !p)}
      />
    </div>
  );
}
