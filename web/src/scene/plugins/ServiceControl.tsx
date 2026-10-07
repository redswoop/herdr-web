import { useEffect, useState } from 'react';
import type { ServiceData } from '../types';
import type { CardProps } from './index';

function fmtUptime(s: number): string {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m${String(s % 60).padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h${String(m % 60).padStart(2, '0')}m`;
  return `${Math.floor(h / 24)}d${h % 24}h`;
}

/** uptime that keeps counting between polls */
function Uptime({ base, at }: { base: number; at: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  return <b>{fmtUptime(base + Math.max(0, Math.round((Date.now() - at) / 1000)))}</b>;
}

function stateClass(d: ServiceData | null): string {
  if (!d || !d.ok) return 'unknown';
  if (d.load === 'not-found') return 'missing';
  if (d.active === 'active') return 'ok';
  if (d.active === 'failed') return 'bad';
  if (d.active === 'activating' || d.active === 'deactivating' || d.active === 'reloading') return 'warn';
  return 'off';
}

/** `service-control`: a systemd unit — one status line, one meta line, keys. */
export function ServiceControl({ card, act }: CardProps) {
  const d = card.data as ServiceData | null;
  const unit = typeof card.props.unit === 'string' ? card.props.unit : '?';
  const scope = card.props.scope === 'system' ? 'system' : 'user';
  const [busy, setBusy] = useState<string | null>(null);
  const cls = stateClass(d);
  const running = d?.active === 'active';
  const missing = d?.load === 'not-found';

  const press = async (action: string) => {
    if (action === 'stop' && !confirm(`Stop ${unit}?`)) return;
    setBusy(action);
    try {
      await act(card.id, action);
    } catch (e) {
      alert(String((e as Error).message ?? e));
    } finally {
      setBusy(null);
    }
  };

  const last = card.lastAction;
  const stateText = !d
    ? 'polling…'
    : missing
      ? 'not found'
      : d.ok
        ? `${d.active}${d.sub && d.sub !== d.active ? `·${d.sub}` : ''}`
        : 'status error';
  return (
    <div className={`scene-svc state-${cls}`}>
      <div className="scene-svc-head">
        <span className="scene-svc-dot" />
        <span className="scene-svc-state">{stateText}</span>
        {d?.uptimeSec != null && (
          <span className="scene-svc-uptime">
            up <Uptime base={d.uptimeSec} at={d.at} />
          </span>
        )}
      </div>
      <div className="scene-svc-meta">
        <code>{unit}</code>
        <span>{scope === 'system' ? 'system' : '--user'}</span>
        {d?.pid ? <span>pid {d.pid}</span> : null}
        {d && d.restarts > 0 ? <span className="warn">↻{d.restarts}</span> : null}
      </div>
      {d?.description && <div className="scene-svc-desc">{d.description}</div>}
      {d?.err && <pre className="scene-text scene-err">{d.err}</pre>}
      <div className="scene-svc-actions">
        <button className="sc-key" disabled={!!busy || missing} onClick={() => press('restart')}>
          <b>r</b>
          {busy === 'restart' ? 'estarting…' : 'estart'}
        </button>
        {running ? (
          <button className="sc-key danger" disabled={!!busy} onClick={() => press('stop')}>
            <b>s</b>
            {busy === 'stop' ? 'topping…' : 'top'}
          </button>
        ) : (
          <button className="sc-key" disabled={!!busy || missing} onClick={() => press('start')}>
            <b>s</b>
            {busy === 'start' ? 'tarting…' : 'tart'}
          </button>
        )}
        {last && (
          <span className={`scene-svc-last ${last.ok ? 'ok' : 'bad'}`} title={new Date(last.at).toLocaleTimeString()}>
            {last.text}
          </span>
        )}
      </div>
      {d?.log && <pre className="scene-text scene-svc-log">{d.log}</pre>}
    </div>
  );
}
