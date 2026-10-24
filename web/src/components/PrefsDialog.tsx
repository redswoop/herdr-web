import { useEffect, type CSSProperties } from 'react';
import { useTheme, type Theme } from '../theme';
import {
  COLOR_ROLES,
  FONT_AREAS,
  FONT_MAX,
  FONT_MIN,
  baseOf,
  colorOf,
  defaultColor,
  inputFloor,
  paletteOf,
  resetColors,
  setColor,
  setFont,
  setPalette,
  setTheme,
  usePrefs,
} from '../prefs';
import { palettesFor, type Palette } from '../palettes';

const THEMES: { key: Theme; label: string }[] = [
  { key: 'default', label: 'Stock' },
  { key: 'cyber', label: '⌁ Cyber' },
];

/** theme, its colors, and per-area text size — every change applies live */
export function PrefsDialog({ onClose }: { onClose: () => void }) {
  const theme = useTheme();
  const { fonts, colors } = usePrefs();
  const presets = palettesFor(theme);
  const pick = paletteOf(theme);
  const base = baseOf(theme);
  const custom = pick === 'custom' && !!colors[theme];

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

        {presets.length > 0 && (
          <section className="prefs-sec">
            <div className="prefs-label">
              palette <span className="prefs-note">· all devices</span>
            </div>
            <div className="palette-grid">
              {presets.map((p) => (
                <PaletteTile key={p.id} p={p} on={pick === p.id} onPick={() => setPalette(theme, p.id)} />
              ))}
              {custom && (
                <PaletteTile
                  p={{
                    id: 'custom',
                    name: 'Custom',
                    tag: `from ${base?.name ?? 'stock'}`,
                    colors: Object.fromEntries(
                      ['chrome', 'live', 'signal', 'active', 'text', 'sub', 'bg'].map((k) => [
                        k,
                        colorOf(theme, k) ?? defaultColor(theme, k),
                      ]),
                    ) as Palette['colors'],
                  }}
                  on
                  onPick={() => {}}
                />
              )}
              {!custom && colors[theme] && (
                <button type="button" className="palette-tile custom-back" onClick={() => setPalette(theme, 'custom')}>
                  <span className="palette-name">Custom</span>
                  <span className="palette-tag">back to your colors</span>
                </button>
              )}
            </div>
          </section>
        )}

        <section className="prefs-sec">
          <div className="prefs-label">
            colors{' '}
            <span className="prefs-note">
              ·{' '}
              {presets.length
                ? pick === 'custom'
                  ? `custom, from ${base?.name}`
                  : `${base?.name} · tweak one to fork it`
                : `${THEMES.find((t) => t.key === theme)?.label} · all devices`}
            </span>
            {custom && (
              <button type="button" className="prefs-reset" onClick={() => resetColors(theme)}>
                {presets.length ? `back to ${base?.name}` : 'reset all'}
              </button>
            )}
          </div>
          <div className="prefs-colors">
            {COLOR_ROLES[theme].map((r) => {
              const mine = colorOf(theme, r.key);
              const v = mine ?? defaultColor(theme, r.key);
              return (
                <label key={r.key} className={`prefs-color ${mine ? 'set' : ''}`} title={v}>
                  <input type="color" value={v} onChange={(e) => setColor(theme, r.key, e.target.value)} />
                  <span className="prefs-color-name">{r.label}</span>
                  {mine && (
                    <button
                      type="button"
                      className="prefs-undo"
                      title={base ? `back to ${base.name}'s color` : "back to the theme's color"}
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

/** a palette drawn in its own colors, so the tile is the preview */
function PaletteTile({ p, on, onPick }: { p: Palette; on: boolean; onPick: () => void }) {
  const c = p.colors;
  const style = {
    '--p-bg': c.bg,
    '--p-red': c.chrome,
    '--p-text': c.text,
    '--p-sub': c.sub,
  } as CSSProperties;
  return (
    <button
      type="button"
      className={`palette-tile ${on ? 'on' : ''}`}
      style={style}
      aria-pressed={on}
      title={p.tag}
      onClick={onPick}
    >
      <span className="palette-name">{p.name}</span>
      <span className="palette-tag">{p.tag}</span>
      <span className="palette-swatches">
        {[c.chrome, c.live, c.signal, c.active].map((v, i) => (
          <i key={i} style={{ background: v, color: v }} />
        ))}
      </span>
    </button>
  );
}
