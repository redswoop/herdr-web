/* herdr's adapter onto the CyberDOS design language (github.com/redswoop/cyberdos).
   The skin speaks in roles; herdr speaks in agent statuses. This is the one
   place the two vocabularies meet, for web and Capra alike. */
import { PALETTES, bootLines, hostLabel, migrateRoleKeys, type Palette, type Role, type RoleColors } from '@redswoop/cyberdos';

export type { Palette, Role, RoleColors };
export { PALETTES, migrateRoleKeys };

/** Skins layered over the stock tokens. Web: <html data-theme>; Capra: ThemeProvider. */
export type Theme = 'default' | 'cyber';
export const THEMES: Theme[] = ['default', 'cyber'];

/** an agent status → the role it paints with */
export const STATUS_ROLE: Record<string, Role> = {
  blocked: 'alarm',
  working: 'active',
  done: 'ok',
  idle: 'muted',
};

/** herdr's stock token → the design-language role it aliases under the skin
 *  (web: the alias block in theme-cyber.css; Capra: buildTokens) */
export const TOKEN_ROLE = {
  red: 'chrome',
  accent: 'live',
  hot: 'signal',
  blocked: 'alarm',
  working: 'active',
  done: 'ok',
  idle: 'muted',
} as const satisfies Record<string, Role>;

/** presets per theme: the stock skin has none, the cyber skin ships nine */
export function palettesFor(t: Theme): Palette[] {
  return t === 'cyber' ? PALETTES : [];
}

export function findPalette(t: Theme, id: string | undefined): Palette | undefined {
  const all = palettesFor(t);
  return all.find((p) => p.id === id) ?? all[0];
}

/** the jack-in boot log, herdr-branded; `host` is the daemon's hostname */
export function herdrBootLines(host: string | null | undefined): string[] {
  return bootLines({
    title: 'HERDR//OS 20.77 — NETRUNNER EDITION',
    host: hostLabel(host),
    steps: ['> decrypting roster ........... OK', '> ICE countermeasures ......... BYPASSED', '> waking the herd ............. 🐑'],
    last: 'WELCOME BACK, RUNNER',
  });
}
