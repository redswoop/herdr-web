/* Theme tokens for Capra: the same roles web/src/style.css exposes, resolved
   once per (theme, palette, overrides) into a Tokens object. The cyber skin's
   values come from @redswoop/cyberdos (theme-map.ts maps its roles onto
   herdr's names) and its CyberTokens ride along as `t.cd` for the skin's own
   components. Components never import colors: they call useTheme() for
   inline values and useStyles(make) for StyleSheets, built once per Tokens. */
import { createContext, createElement, useContext, useEffect, useState, type ReactNode } from 'react';
import { PixelRatio, Platform, StyleSheet, type TextStyle, type ViewStyle } from 'react-native';

import { DEFAULT_FONTS, type FontKey, type Fonts } from '@herdr/shared';
import { NATIVE_FACES, NATIVE_FONT_FILES, alpha, luma, mix } from '@redswoop/cyberdos';
import { CyberProvider, buildCyberTokens, type CyberTokens } from '@redswoop/cyberdos/native';
import { STOCK_DEFAULT, cyberPalette, onlyRoles, type Palette } from './theme-map';

/**
 * Text sizes. Two knobs multiply every size: the user's per-area pref
 * (`t.fonts`, same four areas as web, per device) and iOS Dynamic Type.
 *
 * `t.sz(area, n)` — fontSize for ordinary Text: the pref is applied here,
 * Dynamic Type by RN's own allowFontScaling.
 * `t.px(area, n)` — for Text that sets a lineHeight: BOTH factors, rounded
 * to an integer, with allowFontScaling={false} on the element. Under Fabric
 * (RN 0.86, iOS) a lineHeight + RN's scaling went fractional at text size
 * Extra Large and the paragraph was laid out wider than its frame — last
 * line clipped right and bottom (2026-10-20, reproduced on a Pro Max
 * Simulator via `simctl ui content_size extra-large`; integers fixed it).
 * Dynamic Type is read once at launch; a change mid-run shows after relaunch.
 */
export const fontScale = PixelRatio.getFontScale();
export type { FontKey, Fonts };
import type { Theme } from '@herdr/shared/cyber';

export type { Theme, Palette };

export type Weight = '400' | '500' | '600' | '700' | '900';
export type FontKind = 'ui' | 'display' | 'mono' | 'input';

export interface Tokens {
  theme: Theme;
  cyber: boolean;
  /** the design language's own tokens, for @redswoop/cyberdos/native pieces */
  cd: CyberTokens;
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
  /** per-area text size multipliers (this device) */
  fonts: Fonts;
  /** fontSize for a Text that lets RN apply Dynamic Type */
  sz: (area: FontKey, n: number) => number;
  /** fontSize/lineHeight for a Text with allowFontScaling={false} */
  px: (area: FontKey, n: number) => number;
  status: (status: string | undefined) => string;
  /** a status dot: round on stock, a diamond on cyber */
  dot: (size: number) => ViewStyle;
}

/* ---------------- stock values ---------------- */

export const STOCK: Record<Theme, Palette> = {
  default: STOCK_DEFAULT,
  cyber: cyberPalette().colors,
};

/* ---------------- fonts ---------------- */

/** loaded by name in boot.tsx; the names are what fontFamily must say.
 *  Metro needs literal require() paths, so the manifest is spelled out here
 *  and checked against the package's list at test time. */
export const FONT_FILES: Record<string, number> = {
  Orbitron_700Bold: require('@expo-google-fonts/orbitron/700Bold/Orbitron_700Bold.ttf'),
  Orbitron_900Black: require('@expo-google-fonts/orbitron/900Black/Orbitron_900Black.ttf'),
  ChakraPetch_400Regular: require('@expo-google-fonts/chakra-petch/400Regular/ChakraPetch_400Regular.ttf'),
  ChakraPetch_500Medium: require('@expo-google-fonts/chakra-petch/500Medium/ChakraPetch_500Medium.ttf'),
  ChakraPetch_600SemiBold: require('@expo-google-fonts/chakra-petch/600SemiBold/ChakraPetch_600SemiBold.ttf'),
  ChakraPetch_700Bold: require('@expo-google-fonts/chakra-petch/700Bold/ChakraPetch_700Bold.ttf'),
  ShareTechMono_400Regular: require('@expo-google-fonts/share-tech-mono/400Regular/ShareTechMono_400Regular.ttf'),
};
export { NATIVE_FONT_FILES };

const SYSTEM_MONO = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

function fontFor(theme: Theme): Tokens['font'] {
  if (theme === 'cyber') {
    // custom faces carry their weight in the name; a fontWeight on top makes
    // Android fall back to a synthesized system face
    return (kind, weight = '400') => ({ fontFamily: NATIVE_FACES[kind][weight] });
  }
  return (kind, weight = '400') =>
    kind === 'mono' ? { fontFamily: SYSTEM_MONO, fontWeight: weight } : { fontWeight: weight };
}

/* ---------------- derivation ---------------- */

/** stock values + whatever a palette or custom set overrides. On the cyber
 *  skin the overrides are design-language roles and the surface ramp is the
 *  skin's rule; on the stock skin they are herdr's own keys (same rule as
 *  web/src/prefs.ts applyColors). */
export function buildTokens(theme: Theme, overrides: Record<string, string> = {}, fonts: Fonts = DEFAULT_FONTS): Tokens {
  const cyber = theme === 'cyber';
  let c: Palette;
  let cd: CyberTokens;
  if (cyber) {
    const roles = onlyRoles(overrides);
    const p = cyberPalette(roles);
    c = p.colors;
    cd = buildCyberTokens(p.roles, true, p.tuned);
  } else {
    c = { ...STOCK.default };
    for (const [k, v] of Object.entries(overrides)) if (k in c) (c as unknown as Record<string, string>)[k] = v;
    if (overrides.bg) {
      c.surface = mix(c.bg, c.text, 0.04);
      c.surface2 = mix(c.bg, c.text, 0.07);
      c.surface3 = mix(c.bg, c.text, 0.11);
    }
    if (overrides.accent) c.accentInk = luma(c.accent) > 0.5 ? '#0b0b10' : '#ffffff';
    c.red = c.accent;
    c.hot = c.accent;
    cd = buildCyberTokens({}, false);
  }
  const status = (s: string | undefined) =>
    s === 'blocked' ? c.blocked : s === 'working' ? c.working : s === 'done' ? c.done : s === 'idle' ? c.idle : c.sub;
  const font = fontFor(theme);
  // code is relative to the text around it, as on web
  const mult = (a: FontKey) => (a === 'code' ? fonts.chat * fonts.code : fonts[a]);
  const sz = (a: FontKey, n: number) => Math.round(n * mult(a) * 100) / 100;
  const px = (a: FontKey, n: number) => Math.round(n * mult(a) * fontScale);
  return {
    theme,
    cyber,
    cd,
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
    fonts,
    sz,
    px,
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
  return createElement(ThemeContext.Provider, { value: tokens }, createElement(CyberProvider, { tokens: tokens.cd, children }));
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

/* ---------------- color math (the design language's) ---------------- */

export { alpha, mix };
