import { useEffect, useState } from 'react';

const FRESH_MS = 12_000; // the server pushes a roster every ~5s

/** The connection dot, made honest: green while rosters keep arriving, an
 *  amber age once they stop, red when the stream is down. Tap = refresh. */
export function Freshness({
  connected,
  syncedAt,
  refreshing,
  onRefresh,
}: {
  connected: boolean;
  syncedAt: number;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  // own tick, so the session list doesn't re-render every second
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const age = syncedAt ? now - syncedAt : Infinity;
  const state = refreshing ? 'busy' : !connected ? 'down' : age > FRESH_MS ? 'stale' : 'ok';
  const secs = Math.round(age / 1000);
  const label =
    state === 'busy' ? 'refreshing…'
    : state === 'down' ? 'disconnected — tap to retry'
    : `updated ${secs < 1 ? 'just now' : `${secs}s ago`} — tap to refresh`;
  return (
    <button
      type="button"
      className={`freshness ${state}`}
      title={label}
      aria-label={label}
      onClick={onRefresh}
      disabled={refreshing}
    >
      <span className="dot" />
      {state === 'stale' && Number.isFinite(age) && (
        <span className="freshness-age">{secs < 60 ? `${secs}s` : `${Math.round(secs / 60)}m`}</span>
      )}
    </button>
  );
}
