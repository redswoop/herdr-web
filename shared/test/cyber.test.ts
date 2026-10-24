import { describe, expect, it } from 'vitest';
import { PALETTES, ROLES, migrateRoleKeys } from '@redswoop/cyberdos';
import { STATUS_ROLE, TOKEN_ROLE, findPalette, herdrBootLines, palettesFor } from '../src/cyber';

describe('herdr ↔ cyberdos adapter', () => {
  it('maps every agent status onto a role', () => {
    for (const s of ['blocked', 'working', 'done', 'idle']) expect(ROLES).toContain(STATUS_ROLE[s]);
  });
  it('aliases every stock token the skin re-points', () => {
    expect(Object.values(TOKEN_ROLE).every((r) => (ROLES as readonly string[]).includes(r))).toBe(true);
    // the legacy pref keys were exactly these token names
    expect(migrateRoleKeys(Object.fromEntries(Object.keys(TOKEN_ROLE).map((k) => [k, '#000000'])))).toEqual(
      Object.fromEntries(Object.values(TOKEN_ROLE).map((r) => [r, '#000000'])),
    );
  });
  it('offers presets only for the cyber skin', () => {
    expect(palettesFor('cyber')).toBe(PALETTES);
    expect(palettesFor('default')).toEqual([]);
    expect(findPalette('cyber', 'kabuki')?.id).toBe('kabuki');
    expect(findPalette('cyber', 'nope')?.id).toBe('night-city');
    expect(findPalette('default', 'anything')).toBeUndefined();
  });
  it('brands the boot log', () => {
    const l = herdrBootLines('stormer.tail93d23c.ts.net');
    expect(l[0]).toMatch(/^HERDR\/\/OS/);
    expect(l[1]).toBe('> handshake stormer.tailnet .... OK');
    expect(l.at(-1)).toBe('WELCOME BACK, RUNNER');
    expect(herdrBootLines(null)[1]).toContain('localhost');
  });
});
