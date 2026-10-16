import { useTheme } from '../../theme';
import { setTheme } from '../../prefs';

/** flip between the stock skin and the neon one; `compact` is the header glyph */
export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const theme = useTheme();
  const cyber = theme === 'cyber';
  const flip = () => {
    setTheme(cyber ? 'default' : 'cyber');
  };
  return (
    <button
      className={`theme-toggle sub ${compact ? 'compact' : ''} ${cyber ? 'on' : ''}`}
      onClick={flip}
      title={cyber ? 'jack out (stock theme)' : 'jack in (cyberpunk theme)'}
      aria-label={cyber ? 'switch to stock theme' : 'switch to cyberpunk theme'}
    >
      {compact ? '⌁' : cyber ? '⌁ jack out' : '⌁ jack in'}
    </button>
  );
}
