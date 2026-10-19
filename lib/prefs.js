// Appearance prefs that follow the user across devices: theme, per-theme
// palette pick, and custom color overrides. Font sizes stay per-device on the
// client (a phone and a 27" monitor want different text), so they never come
// through here.
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const STATE_DIR = process.env.HERDR_WEB_STATE
  ?? path.join(os.homedir(), '.local', 'state', 'herdr-web');
const FILE = path.join(STATE_DIR, 'prefs.json');

const THEMES = ['default', 'cyber'];
const HEX = /^#[0-9a-f]{6}$/i;
const KEY = /^[a-z][a-z0-9-]{0,23}$/;

/** keep only well-formed fields: a bad client can't wedge every device */
export function cleanPrefs(p) {
  const out = { theme: THEMES.includes(p?.theme) ? p.theme : 'default', colors: {} };
  for (const t of THEMES) {
    const src = p?.colors?.[t];
    if (!src || typeof src !== 'object') continue;
    const c = {};
    for (const [k, v] of Object.entries(src)) if (KEY.test(k) && HEX.test(v)) c[k] = v.toLowerCase();
    if (Object.keys(c).length) out.colors[t] = c;
  }
  // palette ids are the client's to know; just keep them id-shaped
  for (const f of ['palette', 'base']) {
    out[f] = {};
    for (const t of THEMES) if (KEY.test(p?.[f]?.[t] ?? '')) out[f][t] = p[f][t];
  }
  return out;
}

export async function loadPrefs() {
  try {
    return cleanPrefs(JSON.parse(await fsp.readFile(FILE, 'utf8')));
  } catch {
    return null; // never saved — the client keeps whatever it has
  }
}

export async function savePrefs(p) {
  const clean = cleanPrefs(p);
  await fsp.mkdir(STATE_DIR, { recursive: true, mode: 0o700 });
  const tmp = `${FILE}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(clean, null, 2), { mode: 0o600 });
  await fsp.rename(tmp, FILE);
  return clean;
}
