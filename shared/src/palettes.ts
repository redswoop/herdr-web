/** Skins layered over the stock tokens. Web: <html data-theme>; Capra: ThemeProvider. */
export type Theme = 'default' | 'cyber';

/* Shipped palettes per theme. Each fills every color role the theme exposes
   (COLOR_ROLES in prefs.ts); the surface ramp, glows and rain derive from
   these, so a palette only has to name the roles. Same rule as the stock
   skin: one dominant neon, one counter-accent, one signal — no rainbows. */

export type Palette = {
  id: string;
  name: string;
  tag: string;
  /** the theme's own stylesheet values: listed for swatches, never applied */
  stock?: boolean;
  colors: Record<string, string>;
};

export const PALETTES: Partial<Record<Theme, Palette[]>> = {
  cyber: [
    {
      id: 'night-city',
      name: 'Night City',
      tag: 'red chrome, teal live, yellow signal',
      stock: true,
      colors: {
        red: '#ff6a5c', accent: '#5fe3d4', hot: '#fcee0a', blocked: '#fcee0a',
        working: '#5ef6ff', done: '#4b9e96', idle: '#54413f',
        text: '#f1e3d2', sub: '#9b867b', bg: '#0b0607',
      },
    },
    {
      id: 'arasaka',
      name: 'Arasaka',
      tag: 'crimson + steel, corporate cold',
      colors: {
        red: '#e8243a', accent: '#c3d2e2', hot: '#ffc93a', blocked: '#ffc93a',
        working: '#e4eefa', done: '#6b7a8b', idle: '#463739',
        text: '#f2ecea', sub: '#8e8688', bg: '#090506',
      },
    },
    {
      id: 'militech',
      name: 'Militech',
      tag: 'amber HUD, olive live, orange alert',
      colors: {
        red: '#e5a62c', accent: '#a3d05e', hot: '#ff5f2e', blocked: '#ff5f2e',
        working: '#c2f070', done: '#6e8c46', idle: '#41422e',
        text: '#ebe6cf', sub: '#8e8a6f', bg: '#090a05',
      },
    },
    {
      id: 'netrunner',
      name: 'Netrunner',
      tag: 'phosphor green, ice blue, pink spike',
      colors: {
        red: '#3cff9e', accent: '#5ec8ff', hot: '#ff3fa4', blocked: '#ff3fa4',
        working: '#82ffc8', done: '#2f9b73', idle: '#2a3c35',
        text: '#d8f5e6', sub: '#7a998a', bg: '#030a07',
      },
    },
    {
      id: 'kabuki',
      name: 'Kabuki',
      tag: 'magenta neon on violet, cyan live',
      colors: {
        red: '#ff2fa0', accent: '#3ef0ff', hot: '#ffe14d', blocked: '#ffe14d',
        working: '#72f6ff', done: '#8a70b4', idle: '#4a3452',
        text: '#f4e4f2', sub: '#9c86a2', bg: '#0b0410',
      },
    },
    {
      id: 'afterlife',
      name: 'Afterlife',
      tag: 'bar gold over deep teal',
      colors: {
        red: '#e2b450', accent: '#4fd1c5', hot: '#ff4f5e', blocked: '#ff4f5e',
        working: '#82e9de', done: '#3f8d85', idle: '#36403e',
        text: '#efe6d4', sub: '#8e897b', bg: '#040a0a',
      },
    },
    {
      id: 'trauma-team',
      name: 'Trauma Team',
      tag: 'clinical blue + white, red alarm',
      colors: {
        red: '#3fb6ff', accent: '#e6f3f8', hot: '#ff3b4e', blocked: '#ff3b4e',
        working: '#72e2ff', done: '#4a89a5', idle: '#33424a',
        text: '#e7f0f4', sub: '#7f929b', bg: '#04080a',
      },
    },
    {
      id: 'silverhand',
      name: 'Silverhand',
      tag: 'chrome arm, red live, yellow signal',
      colors: {
        red: '#c9ccd0', accent: '#ff3346', hot: '#fcee0a', blocked: '#fcee0a',
        working: '#ff6070', done: '#8d5a5f', idle: '#3e3a3a',
        text: '#ece8e6', sub: '#8b8583', bg: '#090808',
      },
    },
    {
      id: 'blackwall',
      name: 'Blackwall',
      tag: 'all red, all the way down',
      colors: {
        red: '#ff2a3c', accent: '#ff9478', hot: '#ffe6b0', blocked: '#ffe6b0',
        working: '#ffb39c', done: '#9c4a4a', idle: '#43282a',
        text: '#f6dcd6', sub: '#9a7470', bg: '#080203',
      },
    },
  ],
};

export function palettesFor(t: Theme): Palette[] {
  return PALETTES[t] ?? [];
}

export function findPalette(t: Theme, id: string | undefined): Palette | undefined {
  const all = palettesFor(t);
  return all.find((p) => p.id === id) ?? all[0];
}
