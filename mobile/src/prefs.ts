/* Appearance prefs, mirrored from web/src/prefs.ts: theme + per-theme palette
   pick + custom overrides follow you across devices through /api/prefs. The
   phone caches the last answer in kv so boot doesn't flash the stock skin.
   Text sizes are per-device (kv only, same four knobs as web). */
import {
  apiUrl,
  clampFont,
  DEFAULT_FONTS,
  formatFonts,
  get,
  getPlatform,
  parseFonts,
  type FontKey,
  type Fonts,
} from '@herdr/shared';
import { THEMES, findPalette, migrateRoleKeys, palettesFor, type Theme } from '@herdr/shared/cyber';
import { buildTokens, DEFAULT_TOKENS, type Tokens } from './theme';

export type Colors = Partial<Record<Theme, Record<string, string>>>;
export type Picks = Partial<Record<Theme, string>>;

const CACHE_KEY = 'herdr.prefs';
const FONTS_KEY = 'herdr.fonts';

let theme: Theme = 'default';
let colors: Colors = {};
let palette: Picks = {};
let base: Picks = {}; // the preset a custom set was forked from
let fonts: Fonts = { ...DEFAULT_FONTS };
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
  tokens = buildTokens(theme, effective(theme), fonts);
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

export function currentFonts(): Fonts {
  return fonts;
}

/** this device only — never pushed to the server */
export function setFont(k: FontKey, v: number) {
  fonts = { ...fonts, [k]: clampFont(v) };
  rebuild();
  try {
    getPlatform().kv.set(FONTS_KEY, formatFonts(fonts));
  } catch {}
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

/** cyber colours saved before the roles were named (red/accent/hot/…) read
 *  as the roles they became; the stock skin's keys are its own and stay */
function migrate(c: Colors): Colors {
  if (!c.cyber) return c;
  const m = migrateRoleKeys(c.cyber);
  const { cyber: _, ...rest } = c;
  return Object.keys(m).length ? { ...rest, cyber: m } : rest;
}

function adopt(p: Wire): boolean {
  const next = {
    theme: THEMES.includes(p.theme as Theme) ? (p.theme as Theme) : theme,
    colors: migrate(p.colors ?? {}),
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
    fonts = parseFonts(getPlatform().kv.get(FONTS_KEY));
  } catch {}
  rebuild();
  getPlatform().onWake(() => void pullPrefs());
  void pullPrefs();
}
