// The file viewer's jumps: ⌂ home (the session's project root) and pinned
// places. Pins live on the host, not the device — you pin a folder on the
// desktop and expect it on the phone — and are stored `~/`-relative, so one
// pin means the right folder on each box.
import { execFile } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const STATE_DIR = process.env.HERDR_WEB_STATE
  ?? path.join(os.homedir(), '.local', 'state', 'herdr-web');
const FILE = path.join(STATE_DIR, 'places.json');
const PINS_MAX = 20;

const home = () => os.homedir();
const untilde = (s) => s.replace(/^~(?=\/|$)/, home());
/** `/home/me/Sync` → `~/Sync`; anything outside home stays absolute */
export function tilde(p) {
  const h = home();
  return p === h ? '~' : p.startsWith(`${h}/`) ? `~${p.slice(h.length)}` : p;
}

/** keep absolute or `~/` paths, normalised, de-duplicated, capped */
export function cleanPins(list) {
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    if (typeof raw !== 'string' || raw.length > 1024 || !/^[~/]/.test(raw)) continue;
    const abs = path.resolve(untilde(raw));
    const pin = tilde(abs.length > 1 ? abs.replace(/\/$/, '') : abs);
    if (!out.includes(pin)) out.push(pin);
    if (out.length >= PINS_MAX) break;
  }
  return out;
}

const view = (pins) => pins.map((pin) => ({ pin, path: untilde(pin) }));

async function loadPins() {
  try {
    return cleanPins(JSON.parse(await fsp.readFile(FILE, 'utf8')).pins);
  } catch {
    return [];
  }
}

export async function savePins(list) {
  const pins = cleanPins(list);
  await fsp.mkdir(STATE_DIR, { recursive: true, mode: 0o700 });
  const tmp = `${FILE}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify({ pins }, null, 2), { mode: 0o600 });
  await fsp.rename(tmp, FILE);
  return view(pins);
}

// git toplevel per cwd: a session started in src/foo/lib still lands on
// src/foo. Remembered — a session's cwd doesn't change repos under it.
const roots = new Map();
export function projectRoot(cwd) {
  if (!cwd) return Promise.resolve(home());
  const dir = path.resolve(untilde(cwd));
  if (!roots.has(dir)) {
    roots.set(
      dir,
      new Promise((resolve) => {
        execFile('git', ['-C', dir, 'rev-parse', '--show-toplevel'], { timeout: 3000 }, (err, out) => {
          const top = !err && out.trim();
          if (!top) roots.delete(dir); // not a repo (yet): ask again next time
          resolve(top || dir);
        });
      }),
    );
  }
  return roots.get(dir);
}

export async function places(cwd) {
  const [root, pins] = await Promise.all([projectRoot(cwd), loadPins()]);
  return { home: root, pins: view(pins) };
}
