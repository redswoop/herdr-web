/* Per-device text sizes: four multipliers a phone and a 27" monitor set
 * differently, so they never go through /api/prefs. Web keeps them in a
 * cookie, Capra in kv — both as `ui:1,chat:1.2,input:1,code:0.9`. */

export type FontKey = 'ui' | 'chat' | 'input' | 'code';
export type Fonts = Record<FontKey, number>;

export const FONT_AREAS: { key: FontKey; label: string; hint: string }[] = [
  { key: 'ui', label: 'Interface', hint: 'lists, headers, buttons' },
  { key: 'chat', label: 'Conversation', hint: 'messages and the file viewer' },
  { key: 'input', label: 'Composer', hint: 'what you type' },
  { key: 'code', label: 'Code', hint: 'relative to the text around it' },
];
export const FONT_MIN = 0.75;
export const FONT_MAX = 1.6;
export const FONT_STEP = 0.05;
export const DEFAULT_FONTS: Fonts = { ui: 1, chat: 1, input: 1, code: 1 };

export const clampFont = (v: number) =>
  Math.round(Math.min(FONT_MAX, Math.max(FONT_MIN, v)) * 100) / 100;

/** `ui:1,chat:1.2` → Fonts; unknown keys and out-of-range values fall back */
export function parseFonts(raw: string | null | undefined): Fonts {
  const out = { ...DEFAULT_FONTS };
  for (const part of (raw ?? '').split(',')) {
    const [k, v] = part.split(':');
    const n = Number(v);
    if (k in out && n >= FONT_MIN && n <= FONT_MAX) out[k as FontKey] = n;
  }
  return out;
}

export function formatFonts(f: Fonts): string {
  return (Object.keys(f) as FontKey[]).map((k) => `${k}:${f[k]}`).join(',');
}
