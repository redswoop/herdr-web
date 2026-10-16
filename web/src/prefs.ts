import { useEffect, useState } from 'react';
import { apiUrl, get } from './api';
import { applyTheme, currentTheme, saveTheme, type Theme } from './theme';
import { setRainColors } from './cyber-fx';

/* Appearance prefs. Theme + per-theme colors follow you across devices
   (stored server-side, cached locally so boot doesn't flash). Text sizes are
   per-device: a phone and a 27" monitor want different type. */

export type FontKey = 'ui' | 'chat' | 'input' | 'code';
export type Fonts = Record<FontKey, number>;
export type Colors = Partial<Record<Theme, Record<string, string>>>;

export const FONT_AREAS: { key: FontKey; label: string; hint: string }[] = [
  { key: 'ui', label: 'Interface', hint: 'lists, headers, buttons' },
  { key: 'chat', label: 'Conversation', hint: 'messages and the file viewer' },
  { key: 'input', label: 'Composer', hint: 'what you type' },
  { key: 'code', label: 'Code', hint: 'relative to the text around it' },
];
export const FONT_MIN = 0.75;
export const FONT_MAX = 1.6;
/** under 16px iOS zooms the page on focus, so touch keeps the composer ≥ 100% */
export const inputFloor = () => (matchMedia('(pointer: coarse)').matches ? 1 : FONT_MIN);

/** the knobs each theme exposes, keyed by CSS custom property (sans --) */
export const COLOR_ROLES: Record<Theme, { key: string; label: string }[]> = {
  default: [
    { key: 'accent', label: 'Primary' },
    { key: 'blocked', label: 'Needs you' },
    { key: 'working', label: 'Working' },
    { key: 'done', label: 'Done' },
    { key: 'idle', label: 'Idle' },
    { key: 'text', label: 'Text' },
    { key: 'sub', label: 'Muted text' },
    { key: 'bg', label: 'Background' },
  ],
  cyber: [
    { key: 'red', label: 'Primary' },
    { key: 'accent', label: 'Secondary' },
    { key: 'hot', label: 'Action buttons' },
    { key: 'blocked', label: 'Needs you' },
    { key: 'working', label: 'Working' },
    { key: 'done', label: 'Done' },
    { key: 'text', label: 'Text' },
    { key: 'sub', label: 'Muted text' },
    { key: 'bg', label: 'Background' },
  ],
};

const FONTS_COOKIE = 'herdr.fonts';
const COLORS_CACHE = 'herdr.colors';
const EVENT = 'herdr-prefs';
const DEFAULT_FONTS: Fonts = { ui: 1, chat: 1, input: 1, code: 1 };

let fonts: Fonts = { ...DEFAULT_FONTS };
let colors: Colors = {};

/* ---------------- fonts (cookie, this device) ---------------- */

function loadFonts(): Fonts {
  const raw = document.cookie.match(/(?:^|;\s*)herdr\.fonts=([^;]*)/)?.[1] ?? '';
  const out = { ...DEFAULT_FONTS };
  for (const part of decodeURIComponent(raw).split(',')) {
    const [k, v] = part.split(':');
    const n = Number(v);
    if (k in out && n >= FONT_MIN && n <= FONT_MAX) out[k as FontKey] = n;
  }
  return out;
}

function applyFonts() {
  const st = document.documentElement.style;
  fonts.input = Math.max(fonts.input, inputFloor());
  for (const k of Object.keys(fonts) as FontKey[]) {
    if (fonts[k] === 1) st.removeProperty(`--fs-${k}`);
    else st.setProperty(`--fs-${k}`, String(fonts[k]));
  }
}

export function setFont(k: FontKey, v: number) {
  fonts = { ...fonts, [k]: Math.round(v * 100) / 100 };
  applyFonts();
  const s = (Object.keys(fonts) as FontKey[]).map((key) => `${key}:${fonts[key]}`).join(',');
  document.cookie = `${FONTS_COOKIE}=${encodeURIComponent(s)}; Path=/; Max-Age=31536000; SameSite=Lax`;
  changed();
}

/* ---------------- colors (server, cached) ---------------- */

const applied = new Set<string>();

function applyColors(t: Theme = currentTheme()) {
  const root = document.documentElement;
  for (const k of applied) root.style.removeProperty(k);
  applied.clear();
  const set = (k: string, v: string) => {
    root.style.setProperty(k, v);
    applied.add(k);
  };
  const c = colors[t] ?? {};
  for (const [k, v] of Object.entries(c)) set(`--${k}`, v);
  // the surface ramp and button ink are derived, so one knob stays coherent
  if (c.bg) {
    set('--surface', `color-mix(in srgb, ${c.bg}, var(--text) 4%)`);
    set('--surface-2', `color-mix(in srgb, ${c.bg}, var(--text) 7%)`);
    set('--surface-3', `color-mix(in srgb, ${c.bg}, var(--text) 11%)`);
  }
  if (c.accent && t === 'default') set('--accent-ink', luma(c.accent) > 0.5 ? '#0b0b10' : '#ffffff');
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', c.bg ?? (t === 'cyber' ? '#0b0607' : '#0e0e13'));
  if (t === 'cyber') {
    const red = cssVar('--red') || '#ff6a5c';
    const hot = mix(red, '#ffd27a', 0.5);
    setRainColors({ stream: red, head: mix(red, '#ffffff', 0.75), hot, hotHead: mix(hot, '#ffffff', 0.7) });
  }
}

/** the color a role has with no override — read live so it never drifts from the CSS */
export function defaultColor(key: string): string {
  const root = document.documentElement;
  const prop = `--${key}`;
  const mine = root.style.getPropertyValue(prop);
  root.style.removeProperty(prop);
  const v = cssVar(prop);
  if (mine) root.style.setProperty(prop, mine);
  return /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : '#888888';
}

export function colorOf(t: Theme, key: string): string | null {
  return colors[t]?.[key] ?? null;
}

/** null clears the override back to the theme's own color */
export function setColor(t: Theme, key: string, v: string | null) {
  const next = { ...(colors[t] ?? {}) };
  if (v) next[key] = v.toLowerCase();
  else delete next[key];
  colors = { ...colors, [t]: next };
  if (!Object.keys(next).length) delete colors[t];
  if (t === currentTheme()) applyColors(t);
  cacheColors();
  push();
  changed();
}

export function resetColors(t: Theme) {
  delete colors[t];
  colors = { ...colors };
  applyColors(t);
  cacheColors();
  push();
  changed();
}

/** user-facing switch: transition, cookie, and every other device */
export function setTheme(t: Theme) {
  applyTheme(t, { flip: true });
  saveTheme(t);
  push();
}

function cacheColors() {
  try {
    localStorage.setItem(COLORS_CACHE, JSON.stringify(colors));
  } catch {}
}

/* ---------------- server sync ---------------- */

let pushTimer: ReturnType<typeof setTimeout> | undefined;
function push() {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    fetch(apiUrl('/api/prefs'), {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ theme: currentTheme(), colors }),
    }).catch(() => {});
  }, 400); // color pickers fire per pixel of drag
}

async function pull() {
  try {
    const r = await get('/api/prefs');
    if (!r.ok) return;
    const { prefs } = (await r.json()) as { prefs: { theme: Theme; colors: Colors } | null };
    if (!prefs) return push(); // first device to ask seeds the server
    if (JSON.stringify(prefs.colors) !== JSON.stringify(colors)) {
      colors = prefs.colors;
      cacheColors();
      applyColors();
      changed();
    }
    if (prefs.theme !== currentTheme()) {
      applyTheme(prefs.theme);
      saveTheme(prefs.theme);
    }
  } catch {}
}

/* ---------------- boot + react ---------------- */

export function initPrefs() {
  fonts = loadFonts();
  try {
    colors = JSON.parse(localStorage.getItem(COLORS_CACHE) ?? '{}') ?? {};
  } catch {}
  applyFonts();
  applyColors();
  addEventListener('herdr-theme', (e) => applyColors((e as CustomEvent<Theme>).detail));
  // another device may have changed things while this tab slept
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && pull());
  // a ?theme= link is an explicit choice: tell the server, don't let it overrule
  if (new URLSearchParams(location.search).has('theme')) push();
  else pull();
}

function changed() {
  dispatchEvent(new Event(EVENT));
}

/** re-render on any prefs change; returns the current snapshot */
export function usePrefs(): { fonts: Fonts; colors: Colors } {
  const [, bump] = useState(0);
  useEffect(() => {
    const on = () => bump((n) => n + 1);
    addEventListener(EVENT, on);
    addEventListener('herdr-theme', on);
    return () => {
      removeEventListener(EVENT, on);
      removeEventListener('herdr-theme', on);
    };
  }, []);
  return { fonts, colors };
}

/* ---------------- color math ---------------- */

function cssVar(prop: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(prop).trim();
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', '').slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(a: string, b: string, t: number): string {
  const A = rgb(a);
  const B = rgb(b);
  return `#${A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
}

function luma(hex: string) {
  const [r, g, b] = rgb(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}
