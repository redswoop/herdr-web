import { useEffect } from 'react';
import { useTheme, type Theme } from '../theme';
import {
  COLOR_ROLES,
  FONT_AREAS,
  FONT_MAX,
  FONT_MIN,
  colorOf,
  defaultColor,
  inputFloor,
  resetColors,
  setColor,
  setFont,
  setTheme,
  usePrefs,
} from '../prefs';

const THEMES: { key: Theme; label: string }[] = [
  { key: 'default', label: 'Stock' },
  { key: 'cyber', label: '⌁ Cyber' },
];

/** theme, its colors, and per-area text size — every change applies live */
export function PrefsDialog({ onClose }: { onClose: () => void }) {
  const theme = useTheme();
  const { fonts, colors } = usePrefs();
  const custom = !!colors[theme];

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal prefs" role="dialog" aria-label="preferences">
        <header className="modal-head">
          <h2>preferences</h2>
          <button type="button" className="ghost" aria-label="close" onClick={onClose}>
            ✕
          </button>
        </header>

        <section className="prefs-sec">
          <div className="prefs-label">theme</div>
          <div className="seg-row">
            {THEMES.map((t) => (
              <button
                key={t.key}
                type="button"
                className={`seg ${theme === t.key ? 'on' : ''}`}
                onClick={() => theme !== t.key && setTheme(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </section>

        <section className="prefs-sec">
          <div className="prefs-label">
            colors <span className="prefs-note">· {THEMES.find((t) => t.key === theme)?.label} · all devices</span>
            {custom && (
              <button type="button" className="prefs-reset" onClick={() => resetColors(theme)}>
                reset all
              </button>
            )}
          </div>
          <div className="prefs-colors">
            {COLOR_ROLES[theme].map((r) => {
              const mine = colorOf(theme, r.key);
              const v = mine ?? defaultColor(r.key);
              return (
                <label key={r.key} className={`prefs-color ${mine ? 'set' : ''}`} title={v}>
                  <input type="color" value={v} onChange={(e) => setColor(theme, r.key, e.target.value)} />
                  <span className="prefs-color-name">{r.label}</span>
                  {mine && (
                    <button
                      type="button"
                      className="prefs-undo"
                      title="back to the theme's color"
                      aria-label={`reset ${r.label}`}
                      onClick={(e) => {
                        e.preventDefault();
                        setColor(theme, r.key, null);
                      }}
                    >
                      ↺
                    </button>
                  )}
                </label>
              );
            })}
          </div>
        </section>

        <section className="prefs-sec">
          <div className="prefs-label">
            text size <span className="prefs-note">· this device</span>
          </div>
          {FONT_AREAS.map((a) => {
            const min = a.key === 'input' ? inputFloor() : FONT_MIN;
            return (
              <div key={a.key} className="prefs-font">
                <div className="prefs-font-head">
                  <span>{a.label}</span>
                  <span className="sub">{a.hint}</span>
                  <button
                    type="button"
                    className="prefs-pct"
                    title="back to 100%"
                    onClick={() => setFont(a.key, 1)}
                  >
                    {Math.round(fonts[a.key] * 100)}%
                  </button>
                </div>
                <input
                  type="range"
                  min={min}
                  max={FONT_MAX}
                  step={0.05}
                  value={fonts[a.key]}
                  onChange={(e) => setFont(a.key, Number(e.target.value))}
                  aria-label={`${a.label} text size`}
                />
              </div>
            );
          })}
        </section>

        <footer className="modal-foot">
          <button type="button" className="btn primary" onClick={onClose}>
            done
          </button>
        </footer>
      </div>
    </div>
  );
}
