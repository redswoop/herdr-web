import { useEffect, useState } from 'react';
import { PLUGINS, UnknownCard, type CardProps } from './plugins';
import type { SceneCard } from './types';
import { useScene } from './useScene';
import './scene.css';

function Card({ card, act, onClose }: { card: SceneCard; act: CardProps['act']; onClose: () => void }) {
  const Body = PLUGINS[card.plugin] ?? UnknownCard;
  const [collapsed, setCollapsed] = useState(card.props.collapsed === true);
  return (
    <section className={`scene-card plugin-${card.plugin} ${collapsed ? 'collapsed' : ''}`} data-card={card.id}>
      <header className="scene-card-hd">
        <button
          className="ghost scene-card-title"
          title={collapsed ? 'expand' : 'collapse'}
          onClick={() => setCollapsed((c) => !c)}
        >
          {card.title ?? card.plugin}
        </button>
        <span className="scene-card-plugin">{card.plugin}</span>
        <button className="ghost scene-card-x" aria-label="remove card" title="remove" onClick={onClose}>
          ×
        </button>
      </header>
      {!collapsed && (
        <div className="scene-card-body">
          <Body card={card} act={act} />
        </div>
      )}
    </section>
  );
}

const NEON_KEY = 'herdr.scene.neon';

/** A secondary scope's cards (its own subscription), stacked under the
 *  primary scope's in the same list. */
function ScopeCards({ scope, onConnected }: { scope: string; onConnected: (ok: boolean) => void }) {
  const { scene, connected, apply, act } = useScene(scope);
  useEffect(() => onConnected(connected), [connected, onConnected]);
  const strike = (id: string) => {
    apply([{ op: 'unmount', id }]).catch((e) => alert(String(e.message ?? e)));
  };
  return (
    <>
      {scene.cards.map((c) => (
        <Card key={`${scope}/${c.id}`} card={c} act={act} onClose={() => strike(c.id)} />
      ))}
    </>
  );
}

/** The plot-driven side panel. Dumb by design: it renders whatever the
 *  server says is on stage for each scope (workspace first, then pane) and
 *  lets the user strike a card. */
export function ScenePanel({ scopes, onClose }: { scopes: string[]; onClose?: () => void }) {
  const primary = scopes[0];
  const { scene, connected, apply, act } = useScene(primary);
  const extra = scopes.slice(1);
  const [extraOk, setExtraOk] = useState<Record<string, boolean>>({});
  const strike = (id: string) => {
    apply([{ op: 'unmount', id }]).catch((e) => alert(String(e.message ?? e)));
  };
  const [neon, setNeon] = useState(() => {
    try {
      return localStorage.getItem(NEON_KEY) === '1';
    } catch {
      return false;
    }
  });
  const toggleNeon = () => {
    setNeon((n) => {
      try {
        localStorage.setItem(NEON_KEY, n ? '0' : '1');
      } catch {}
      return !n;
    });
  };
  const clear = () => {
    if (scene.cards.length && confirm(`Clear the ${primary} scene?`)) {
      apply([{ op: 'clear' }]).catch((e) => alert(String(e.message ?? e)));
    }
  };
  const allOk = connected && extra.every((s) => extraOk[s] !== false);
  // the first scope's hook also serves its own cards; extra scopes get a child each
  return (
    <aside className={`scene ${neon ? 'neon' : ''}`} data-scope={scopes.join(' ')}>
      <header className="bar scene-bar">
        <span className={`dot ${allOk ? 'ok' : ''}`} title={allOk ? 'live' : 'reconnecting'} />
        <span className="scene-title">scene</span>
        <span className="scene-count" title={scopes.join(', ')}>{scene.cards.length ? scene.cards.length : ''}</span>
        <button className="ghost scene-neon" title="more neon (for Masud)" aria-pressed={neon} onClick={toggleNeon}>
          neon
        </button>
        {scene.cards.length > 0 && (
          <button className="ghost scene-clear" title={`clear the ${primary} scene`} onClick={clear}>
            clear
          </button>
        )}
        {onClose && (
          <button className="ghost scene-close" aria-label="hide scene" title="hide scene" onClick={onClose}>
            ×
          </button>
        )}
      </header>
      <div className="scene-cards">
        {scene.rev < 0 ? (
          <div className="scene-empty">connecting…</div>
        ) : (
          <>
            {scene.cards.map((c) => (
              <Card key={`${primary}/${c.id}`} card={c} act={act} onClose={() => strike(c.id)} />
            ))}
            {extra.map((s) => (
              <ScopeCards
                key={s}
                scope={s}
                onConnected={(ok) => setExtraOk((m) => (m[s] === ok ? m : { ...m, [s]: ok }))}
              />
            ))}
            {scene.cards.length === 0 && (
              <div className="scene-empty">
                <div>Nothing on stage for {primary}.</div>
                <code className="scene-hint">
                  {`curl -X POST ${location.origin}/api/scene/${encodeURIComponent(primary)}/ops \\\n  -H 'content-type: application/json' \\\n  -d '{"op":"mount","plugin":"summary","title":"hello","props":{"body":"**it works**"}}'`}
                </code>
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
