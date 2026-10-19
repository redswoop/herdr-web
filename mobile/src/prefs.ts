/* Appearance prefs, mirrored from web/src/prefs.ts: theme + per-theme palette
   pick + custom overrides follow you across devices through /api/prefs. The
   phone caches the last answer in kv so boot doesn't flash the stock skin.
   Text sizes are per-device and not here (yet). */
import { apiUrl, get, getPlatform } from '@herdr/shared';
import { findPalette, palettesFor, type Theme } from '@herdr/shared/palettes';
import { buildTokens, DEFAULT_TOKENS, type Tokens } from './theme';

export type Colors = Partial<Record<Theme, Record<string, string>>>;
export type Picks = Partial<Record<Theme, string>>;

const CACHE_KEY = 'herdr.prefs';
const THEMES: Theme[] = ['default', 'cyber'];

let theme: Theme = 'default';
let colors: Colors = {};
let palette: Picks = {};
let base: Picks = {}; // the preset a custom set was forked from
let tokens: Tokens = DEFAULT_TOKENS;

const listeners = new Set<() => void>();

export function currentTokens(): Tokens {
  return tokens;
}

export function currentTheme(): Theme {
  return theme;
}

export function subscribePrefs(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/* ---------------- what's showing ---------------- */

/** a preset id, or 'custom' (same rules as web so the two never disagree) */
export function paletteOf(t: Theme): string {
  const all = palettesFor(t);
  if (!all.length) return 'custom';
  const p = palette[t];
  if (p === 'custom' || all.some((x) => x.id === p)) return p!;
  return colors[t] ? 'custom' : all[0].id;
}

function effective(t: Theme): Record<string, string> {
  const p = paletteOf(t);
  const b = findPalette(t, p === 'custom' ? base[t] : p);
  const fromBase = b && !b.stock ? b.colors : {};
  return p === 'custom' ? { ...fromBase, ...(colors[t] ?? {}) } : fromBase;
}

function rebuild() {
  tokens = buildTokens(theme, effective(theme));
  for (const cb of listeners) cb();
}

/* ---------------- user actions ---------------- */

export function setTheme(t: Theme) {
  if (t === theme) return;
  theme = t;
  saved();
}

export function setPalette(t: Theme, id: string) {
  palette = { ...palette, [t]: id };
  saved();
}

function saved() {
  rebuild();
  cache();
  push();
}

/* ---------------- cache + server ---------------- */

function cache() {
  try {
    getPlatform().kv.set(CACHE_KEY, JSON.stringify({ theme, colors, palette, base }));
  } catch {}
}

let pushTimer: ReturnType<typeof setTimeout> | undefined;
function push() {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    fetch(apiUrl('/api/prefs'), {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ theme, colors, palette, base }),
    }).catch(() => {});
  }, 400);
}

type Wire = { theme?: Theme; colors?: Colors; palette?: Picks; base?: Picks };

function adopt(p: Wire): boolean {
  const next = {
    theme: THEMES.includes(p.theme as Theme) ? (p.theme as Theme) : theme,
    colors: p.colors ?? {},
    palette: p.palette ?? palette,
    base: p.base ?? base,
  };
  const same =
    next.theme === theme &&
    JSON.stringify([next.colors, next.palette, next.base]) === JSON.stringify([colors, palette, base]);
  if (same) return false;
  ({ theme, colors, palette, base } = next);
  return true;
}

/** ask the server; the first device to ask seeds it */
export async function pullPrefs(): Promise<void> {
  try {
    const r = await get('/api/prefs');
    if (!r.ok) return;
    const { prefs } = (await r.json()) as { prefs: Wire | null };
    if (!prefs) return push();
    if (adopt(prefs)) {
      rebuild();
      cache();
    }
  } catch {}
}

/** once, after the platform is up: cached skin now, server's answer when it comes */
export function initPrefs(): void {
  try {
    const raw = getPlatform().kv.get(CACHE_KEY);
    if (raw) adopt(JSON.parse(raw) as Wire);
  } catch {}
  rebuild();
  getPlatform().onWake(() => void pullPrefs());
  void pullPrefs();
}
