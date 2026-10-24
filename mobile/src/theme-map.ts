/* Pure (no react-native import, so it is unit-testable): herdr's token
   vocabulary for Capra, and how the CyberDOS design language maps onto it.
   The stock skin's values mirror web/src/style.css; the cyber skin's come
   from the design language itself. */
import { DEFAULT_PALETTE, derive, isRole, type Derived, type RoleColors } from '@redswoop/cyberdos';
import { TOKEN_ROLE, type Theme } from '@herdr/shared/cyber';

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
  /** the skin's chrome colour (titles, rails, your voice); = accent on the stock skin */
  red: string;
  /** the one primary action; = accent on the stock skin */
  hot: string;
}

export const STOCK_DEFAULT: Palette = {
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
};

/** herdr colours from a (partial) set of design-language roles over the
 *  stock palette; `tuned` keeps the stock ramp when nothing moved the bg */
export function cyberPalette(roles: Partial<RoleColors> = {}): { colors: Palette; roles: RoleColors; tuned: Partial<Derived> } {
  const r: RoleColors = { ...DEFAULT_PALETTE.colors, ...roles };
  const tuned: Partial<Derived> = roles.bg ? {} : (DEFAULT_PALETTE.derived ?? {});
  const d = derive(r, tuned);
  const colors: Palette = {
    bg: r.bg,
    surface: d.surface,
    surface2: d.surface2,
    surface3: d.surface3,
    hairline: d.hairline,
    text: r.text,
    sub: r.sub,
    accent: r[TOKEN_ROLE.accent],
    accentInk: d.liveInk,
    blocked: r[TOKEN_ROLE.blocked],
    working: r[TOKEN_ROLE.working],
    done: r[TOKEN_ROLE.done],
    idle: r[TOKEN_ROLE.idle],
    red: r[TOKEN_ROLE.red],
    hot: r[TOKEN_ROLE.hot],
  };
  return { colors, roles: r, tuned };
}

/** the cyber overrides a theme's custom set may carry: only real roles */
export function onlyRoles(overrides: Record<string, string>): Partial<RoleColors> {
  const out: Partial<RoleColors> = {};
  for (const [k, v] of Object.entries(overrides)) if (isRole(k)) out[k] = v;
  return out;
}

export function isCyber(t: Theme): boolean {
  return t === 'cyber';
}
