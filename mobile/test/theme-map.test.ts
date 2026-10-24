import { describe, expect, it } from 'vitest';
import { DEFAULT_PALETTE, NATIVE_FONT_FILES, PALETTES } from '@redswoop/cyberdos';
import { STOCK_DEFAULT, cyberPalette, onlyRoles } from '../src/theme-map';

/* Capra wears the design language through theme-map.ts: these pin the
   mapping so a role rename upstream can't silently repaint the app. */

describe('cyberPalette', () => {
  it('maps the stock skin exactly as the stylesheet does', () => {
    const { colors } = cyberPalette();
    expect(colors.red).toBe('#ff6a5c'); // chrome
    expect(colors.accent).toBe('#5fe3d4'); // live
    expect(colors.hot).toBe('#fcee0a'); // signal
    expect(colors.blocked).toBe('#fcee0a'); // alarm
    expect(colors.working).toBe('#5ef6ff'); // active
    expect(colors.done).toBe('#4b9e96'); // ok
    expect(colors.idle).toBe('#54413f'); // muted
    expect(colors.bg).toBe('#0b0607');
    // the hand-tuned ramp, not the 4/7/11% rule
    expect(colors.surface).toBe('#140b0c');
    expect(colors.surface2).toBe('#1f1112');
    expect(colors.surface3).toBe('#2b1719');
    expect(colors.hairline).toBe('rgba(255, 106, 92, 0.16)');
    expect(colors.accentInk).toBe('#050405');
  });
  it('re-derives the ramp when a palette moves the background', () => {
    const kabuki = PALETTES.find((p) => p.id === 'kabuki')!;
    const { colors, roles } = cyberPalette(kabuki.colors);
    expect(roles).toEqual(kabuki.colors);
    expect(colors.red).toBe(kabuki.colors.chrome);
    expect(colors.surface).not.toBe('#140b0c');
    expect(colors.surface.startsWith('#')).toBe(true);
  });
  it('treats a partial custom set as overrides on the stock palette', () => {
    const { colors } = cyberPalette({ chrome: '#123456' });
    expect(colors.red).toBe('#123456');
    expect(colors.accent).toBe(DEFAULT_PALETTE.colors.live);
    expect(colors.surface).toBe('#140b0c');
  });
  it('ignores keys that are not roles', () => {
    expect(onlyRoles({ chrome: '#111111', red: '#222222', junk: '#333333' })).toEqual({ chrome: '#111111' });
  });
  it('keeps the stock skin where it was', () => {
    expect(STOCK_DEFAULT.accent).toBe('#7aa2f7');
    expect(STOCK_DEFAULT.red).toBe(STOCK_DEFAULT.accent);
  });
});

describe('fonts', () => {
  it('bundles every face the design language names', async () => {
    // theme.ts spells the require()s out for Metro; keep it in step with the package
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('../src/theme.ts', import.meta.url).pathname, 'utf8');
    for (const [name, path] of Object.entries(NATIVE_FONT_FILES)) {
      expect(src, name).toContain(`${name}: require('${path}')`);
    }
  });
});
