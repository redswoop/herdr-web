/** Phone home surface: list ↔ cards. Rendered in the same slot of both
 *  headers so flipping views doesn't move the control under your thumb. */
export function HomeToggle({
  view,
  onPick,
}: {
  view: 'list' | 'cards';
  onPick: (v: 'list' | 'cards') => void;
}) {
  return (
    <span className="home-toggle" role="group" aria-label="home view">
      <button
        className={view === 'list' ? 'on' : ''}
        aria-pressed={view === 'list'}
        aria-label="session list"
        onClick={() => view !== 'list' && onPick('list')}
      >
        ☰
      </button>
      <button
        className={view === 'cards' ? 'on' : ''}
        aria-pressed={view === 'cards'}
        aria-label="project overview"
        onClick={() => view !== 'cards' && onPick('cards')}
      >
        ⊞
      </button>
    </span>
  );
}
