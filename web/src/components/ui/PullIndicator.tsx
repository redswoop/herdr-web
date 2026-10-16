/** The pull-to-refresh affordance at the top of a scroller: grows with the
 *  pull, flips to "release" once armed, spins while the refresh runs. */
export function PullIndicator({ pull, armed, busy }: { pull: number; armed: boolean; busy: boolean }) {
  if (!pull && !busy) return null;
  return (
    <div className="pull" style={{ height: busy ? 36 : pull }} aria-live="polite">
      <span className={`pull-glyph ${armed ? 'armed' : ''} ${busy ? 'busy' : ''}`}>↻</span>
      <span className="pull-text sub">{busy ? 'refreshing…' : armed ? 'release to refresh' : 'pull to refresh'}</span>
    </div>
  );
}
