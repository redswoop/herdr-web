import { describe, expect, it } from 'vitest';
import { clampFont, formatFonts, parseFonts } from '../src/fonts';

describe('fonts', () => {
  it('round-trips and ignores junk', () => {
    expect(parseFonts('ui:1,chat:1.2,input:1,code:0.9')).toEqual({ ui: 1, chat: 1.2, input: 1, code: 0.9 });
    expect(parseFonts('chat:9,bogus:1,input:0.5')).toEqual({ ui: 1, chat: 1, input: 1, code: 1 });
    expect(parseFonts(null)).toEqual({ ui: 1, chat: 1, input: 1, code: 1 });
    const f = { ui: 1, chat: 1.25, input: 1.1, code: 0.95 };
    expect(parseFonts(formatFonts(f))).toEqual(f);
  });
  it('clamps to the range on a 0.01 grid', () => {
    expect(clampFont(0.2)).toBe(0.75);
    expect(clampFont(3)).toBe(1.6);
    expect(clampFont(1.04999)).toBe(1.05);
  });
});
