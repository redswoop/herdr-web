/* Theme tokens for Capra: the same roles web/src/style.css + theme-cyber.css
   expose, resolved once per (theme, palette, overrides) into a Tokens object.
   Components never import colors: they call useTheme() for inline values and
   useStyles(make) for StyleSheets, which are built once per Tokens identity. */
import { createContext, createElement, useContext, useEffect, useState, type ReactNode } from 'react';
import { PixelRatio, Platform, StyleSheet, type TextStyle, type ViewStyle } from 'react-native';

/**
 * Dynamic Type by hand for body text that carries a lineHeight. Under Fabric
 * (RN 0.86, iOS) a Text with lineHeight + RN's own font scaling measures a
 * paragraph at a wider width than its frame once the scaled values go
 * fractional — at the "Extra Large" text size a reply's last line was clipped
 * on the right and the bottom (2026-10-20, reproduced on a Pro Max Simulator
 * via `simctl ui content_size extra-large`; integer sizes fixed it). Use
 * `px()` for fontSize/lineHeight on such Text and set allowFontScaling={false}
 * on it. Read once at launch: a text-size change mid-run shows after relaunch.
 */
export const fontScale = PixelRatio.getFontScale();
export const px = (n: number) => Math.round(n * fontScale);
import type { Theme } from '@herdr/shared/palettes';

export type { Theme };

export interface Palette {
  bg: string;
  surface: string;
  surface2: string;
  surface3: string;
  hairline: string;
  text: string;
  sub: string;
  accent: string;
  accentInk: string;
  blocked: string;
  working: string;
  done: string;
  idle: string;
  /** cyber's chrome colour (titles, rails, your voice); = accent on the stock skin */
  red: string;
  /** the one primary action; = accent on the stock skin */
  hot: string;
}

export type Weight = '400' | '500' | '600' | '700' | '900';
export type FontKind = 'ui' | 'display' | 'mono' | 'input';

export interface Tokens {
  theme: Theme;
  cyber: boolean;
  colors: Palette;
  radius: { sm: number; md: number; lg: number };
  /** a one-off radius (pills, bubbles): as given on stock, square on cyber */
  r: (n: number) => number;
  /** screen background (both themes: a Screen draws its own backdrop) */
  canvas: string;
  /** translucent HUD glass for rows and bars (plain surface on stock) */
  glass: string;
  glass2: string;
  /** neon text: a halo in the given colour (nothing on stock) */
  glow: (color: string, radius?: number) => TextStyle;
  /** neon box: a soft outer light (nothing on stock) */
  boxGlow: (color: string, radius?: number, strength?: number) => ViewStyle;
  /** faint phosphor halo on reading text */
  phosphor: TextStyle;
  /** HUD label grammar: mono, tracked, uppercase (nothing on stock) */
  hud: TextStyle;
  /** family + weight for a Text, resolved per theme (custom faces need the
   *  exact loaded name, so weight is folded into the family on cyber) */
  font: (kind: FontKind, weight?: Weight) => TextStyle;
  status: (status: string | undefined) => string;
  /** a status dot: round on stock, a diamond on cyber */
  dot: (size: number) => ViewStyle;
}

/* ---------------- stock values (mirror the stylesheets) ---------------- */

export const STOCK: Record<Theme, Palette> = {
  default: {
    bg: '#0e0e13',
    surface: '#17171e',
    surface2: '#1f1f29',
    surface3: '#2a2a37',
    hairline: 'rgba(255, 255, 255, 0.07)',
    text: '#e9e9f0',
    sub: '#9a9aab',
    accent: '#7aa2f7',
    accentInk: '#0b0b10',
    blocked: '#f7768e',
    working: '#e0af68',
    done: '#9ece6a',
    idle: '#565f89',
    red: '#7aa2f7',
    hot: '#7aa2f7',
  },
  cyber: {
    bg: '#0b0607',
    surface: '#140b0c',
    surface2: '#1f1112',
    surface3: '#2b1719',
    hairline: 'rgba(255, 106, 92, 0.16)',
    text: '#f1e3d2',
    sub: '#9b867b',
    accent: '#5fe3d4',
    accentInk: '#050405',
    blocked: '#fcee0a',
    working: '#5ef6ff',
    done: '#4b9e96',
    idle: '#54413f',
    red: '#ff6a5c',
    hot: '#fcee0a',
  },
};

/* ---------------- fonts ---------------- */

/** loaded by name in boot.tsx; the names are what fontFamily must say */
export const FONT_FILES: Record<string, number> = {
  Orbitron_700Bold: require('@expo-google-fonts/orbitron/700Bold/Orbitron_700Bold.ttf'),
  Orbitron_900Black: require('@expo-google-fonts/orbitron/900Black/Orbitron_900Black.ttf'),
  ChakraPetch_400Regular: require('@expo-google-fonts/chakra-petch/400Regular/ChakraPetch_400Regular.ttf'),
  ChakraPetch_500Medium: require('@expo-google-fonts/chakra-petch/500Medium/ChakraPetch_500Medium.ttf'),
  ChakraPetch_600SemiBold: require('@expo-google-fonts/chakra-petch/600SemiBold/ChakraPetch_600SemiBold.ttf'),
  ChakraPetch_700Bold: require('@expo-google-fonts/chakra-petch/700Bold/ChakraPetch_700Bold.ttf'),
  ShareTechMono_400Regular: require('@expo-google-fonts/share-tech-mono/400Regular/ShareTechMono_400Regular.ttf'),
};

const SYSTEM_MONO = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

const CYBER_FACES: Record<FontKind, Partial<Record<Weight, string>>> = {
  display: { '400': 'Orbitron_700Bold', '500': 'Orbitron_700Bold', '600': 'Orbitron_700Bold', '700': 'Orbitron_700Bold', '900': 'Orbitron_900Black' },
  ui: { '400': 'ChakraPetch_400Regular', '500': 'ChakraPetch_500Medium', '600': 'ChakraPetch_600SemiBold', '700': 'ChakraPetch_700Bold', '900': 'ChakraPetch_700Bold' },
  // the composer stays proportional (Armen's call on the web skin)
  input: { '400': 'ChakraPetch_400Regular', '500': 'ChakraPetch_500Medium', '600': 'ChakraPetch_600SemiBold', '700': 'ChakraPetch_700Bold', '900': 'ChakraPetch_700Bold' },
  mono: { '400': 'ShareTechMono_400Regular', '500': 'ShareTechMono_400Regular', '600': 'ShareTechMono_400Regular', '700': 'ShareTechMono_400Regular', '900': 'ShareTechMono_400Regular' },
};

function fontFor(theme: Theme): Tokens['font'] {
  if (theme === 'cyber') {
    // custom faces carry their weight in the name; a fontWeight on top makes
    // Android fall back to a synthesized system face
    return (kind, weight = '400') => ({ fontFamily: CYBER_FACES[kind][weight] });
  }
  return (kind, weight = '400') =>
    kind === 'mono' ? { fontFamily: SYSTEM_MONO, fontWeight: weight } : { fontWeight: weight };
}

/* ---------------- derivation ---------------- */

/** stock values + whatever a palette or custom set overrides; the surface
 *  ramp and hairline follow (same rule as web/src/prefs.ts applyColors) */
export function buildTokens(theme: Theme, overrides: Record<string, string> = {}): Tokens {
  const c: Palette = { ...STOCK[theme] };
  for (const [k, v] of Object.entries(overrides)) if (k in c) (c as unknown as Record<string, string>)[k] = v;
  if (overrides.bg) {
    c.surface = mix(c.bg, c.text, 0.04);
    c.surface2 = mix(c.bg, c.text, 0.07);
    c.surface3 = mix(c.bg, c.text, 0.11);
  }
  if (theme === 'cyber') c.hairline = alpha(c.red, 0.16);
  else if (overrides.accent) c.accentInk = luma(c.accent) > 0.5 ? '#0b0b10' : '#ffffff';
  if (theme === 'default') {
    c.red = c.accent;
    c.hot = c.accent;
  }
  const cyber = theme === 'cyber';
  const status = (s: string | undefined) =>
    s === 'blocked' ? c.blocked : s === 'working' ? c.working : s === 'done' ? c.done : s === 'idle' ? c.idle : c.sub;
  const font = fontFor(theme);
  return {
    theme,
    cyber,
    colors: c,
    radius: cyber ? { sm: 0, md: 0, lg: 0 } : { sm: 10, md: 14, lg: 18 },
    r: (n) => (cyber ? 0 : n),
    canvas: c.bg,
    glass: cyber ? alpha(c.surface, 0.78) : c.surface,
    glass2: cyber ? alpha(c.surface2, 0.85) : c.surface2,
    glow: (color, radius = 10) =>
      cyber ? { textShadowColor: color, textShadowRadius: radius, textShadowOffset: { width: 0, height: 0 } } : {},
    boxGlow: (color, radius = 12, strength = 0.55) =>
      cyber ? { boxShadow: `0 0 ${radius}px ${alpha(color, strength)}` } : {},
    phosphor: cyber
      ? { textShadowColor: alpha(c.red, 0.22), textShadowRadius: 12, textShadowOffset: { width: 0, height: 0 } }
      : {},
    hud: cyber ? { ...font('mono'), letterSpacing: 1.4, textTransform: 'uppercase' } : {},
    font,
    status,
    dot: (size) =>
      cyber
        ? { width: size * 0.85, height: size * 0.85, transform: [{ rotate: '45deg' }] }
        : { width: size, height: size, borderRadius: size / 2 },
  };
}

/* ---------------- context ---------------- */

export const DEFAULT_TOKENS = buildTokens('default');

const ThemeContext = createContext<Tokens>(DEFAULT_TOKENS);

/** the prefs module hands tokens in; this is the react side of it */
export function ThemeProvider({
  tokens,
  children,
}: {
  tokens: Tokens;
  children: ReactNode;
}) {
  return createElement(ThemeContext.Provider, { value: tokens }, children);
}

export function useTheme(): Tokens {
  return useContext(ThemeContext);
}

type Maker<T> = (t: Tokens) => T;
const sheets = new WeakMap<Tokens, Map<Maker<unknown>, unknown>>();

/** StyleSheet.create per theme: `make` runs once per Tokens identity, so a
 *  component pays nothing per render and everything repaints on a flip */
export function useStyles<T extends StyleSheet.NamedStyles<T>>(make: Maker<T>): T {
  const t = useTheme();
  let m = sheets.get(t);
  if (!m) sheets.set(t, (m = new Map()));
  let s = m.get(make as Maker<unknown>) as T | undefined;
  if (!s) m.set(make as Maker<unknown>, (s = StyleSheet.create(make(t))));
  return s;
}

/** subscribe to a tokens source outside react (prefs.ts) */
export function useTokensFrom(current: () => Tokens, subscribe: (cb: () => void) => () => void): Tokens {
  const [t, setT] = useState(current);
  useEffect(() => subscribe(() => setT(current())), [current, subscribe]);
  return t;
}

/* ---------------- color math ---------------- */

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', '').slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function mix(a: string, b: string, t: number): string {
  const A = rgb(a);
  const B = rgb(b);
  return `#${A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
}

export function alpha(hex: string, a: number): string {
  const [r, g, b] = rgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function luma(hex: string) {
  const [r, g, b] = rgb(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}
