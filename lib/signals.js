// Signals: the "LCARS" plumbing. Probes (lib/probes/*.js) watch the things a
// session kicks off or depends on — disk, GPU, gaffer jobs, downloads,
// services, the sessions themselves — and write small records into one
// store; the UI reads the store over SSE. Probes never talk to a dashboard
// and the dashboard never talks to a service: probes → store → views.
//
// Signal record (the whole contract; see shared/src/types.ts for the TS mirror):
//   key        unique, `<source>:<thing>`
//   source     probe id
//   kind       gauge | job | list | text
//   title      short label
//   state      ok | warn | alarm | busy | idle | needs-you | down
//   host       which box it is about ('' = this one)
//   value/unit/total   gauges (value is the number the sparkline tracks)
//   done/total/pct/eta/phase/msg   jobs (pct 0..100 when total is unknown)
//   items      lists: [{ id, label, sub, state, pct, href }]
//   detail     one line of context
//   href       where to go for more (a UI, a file path)
//   attach     { cwd, repoRoot, paneId } — the session this belongs to, if any
//   actions    verbs the probe's act() accepts for this signal
//   updatedAt  epoch ms (store-stamped)
//   rate       units/s over the recent window (store-derived for gauges)
//   history    [[t, value]…] recent samples (store-kept, capped)
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const STATE_DIR = process.env.HERDR_WEB_STATE
  ?? path.join(os.homedir(), '.local', 'state', 'herdr-web');
const CONFIG_FILE = path.join(STATE_DIR, 'signals.json');

export const STATES = ['ok', 'warn', 'alarm', 'busy', 'idle', 'needs-you', 'down'];
const STATE_RANK = { 'needs-you': 0, alarm: 1, down: 2, warn: 3, busy: 4, ok: 5, idle: 6 };
export const stateRank = (s) => STATE_RANK[s] ?? 9;
/** the three things a human needs to tell apart; everything else is plain */
export const toneOf = (state) =>
  state === 'needs-you' ? 'needs-you' : (state === 'alarm' || state === 'down') ? 'broken' : state === 'busy' ? 'working' : null;

const HISTORY_MAX = 360; // 30 min at the usual 5 s cadence
const RATE_WINDOW_MS = 10 * 60_000;

/** least-squares slope of [[t,v]] over the last window → units per second */
export function slope(history, windowMs = RATE_WINDOW_MS, now = Date.now()) {
  const pts = history.filter(([t]) => now - t <= windowMs);
  if (pts.length < 3) return null;
  const t0 = pts[0][0];
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const [t, v] of pts) {
    const x = (t - t0) / 1000;
    sx += x; sy += v; sxx += x * x; sxy += x * v;
  }
  const n = pts.length;
  const den = n * sxx - sx * sx;
  if (den === 0) return null;
  return (n * sxy - sx * sy) / den;
}

export class SignalStore {
  constructor() {
    this.signals = new Map();   // key -> record
    this.history = new Map();   // key -> [[t, v]]
    this.sources = new Map();   // id -> { id, title, every, ok, error, ranAt, ms }
    this.clients = new Set();   // SSE responses
    this.listeners = new Set(); // in-process subscribers (fn(changedKeys))
  }

  /** Replace every signal of one source with `list` (diffing away the rest). */
  replace(source, list, now = Date.now()) {
    const keep = new Set();
    const changed = [];
    for (const raw of list) {
      const key = raw.key;
      if (!key) continue;
      keep.add(key);
      if (this.put({ ...raw, source }, now)) changed.push(key);
    }
    for (const [key, s] of this.signals) {
      if (s.source === source && !keep.has(key)) {
        this.signals.delete(key);
        this.history.delete(key);
        changed.push(key);
      }
    }
    if (changed.length) this.broadcast(changed);
    return changed;
  }

  /** Upsert one record; returns true when something visible changed. */
  put(raw, now = Date.now()) {
    const key = raw.key;
    const prev = this.signals.get(key);
    const rec = {
      ...raw,
      state: STATES.includes(raw.state) ? raw.state : 'ok',
      tone: toneOf(STATES.includes(raw.state) ? raw.state : 'ok'),
      updatedAt: now,
    };
    if (typeof rec.value === 'number' && Number.isFinite(rec.value)) {
      const h = this.history.get(key) ?? [];
      const last = h[h.length - 1];
      // sample on change or every 30 s, so a flat line still has points
      if (!last || last[1] !== rec.value || now - last[0] >= 30_000) h.push([now, rec.value]);
      while (h.length > HISTORY_MAX) h.shift();
      this.history.set(key, h);
      rec.rate = raw.rate ?? slope(h, RATE_WINDOW_MS, now);
      rec.since = h[0]?.[0] ?? now;
      rec.first = h[0]?.[1] ?? rec.value;
    }
    this.signals.set(key, rec);
    if (!prev) return true;
    // ignore the clock: the client re-renders on content, not on heartbeat
    const a = { ...prev, updatedAt: 0, rate: 0, history: null };
    const b = { ...rec, updatedAt: 0, rate: 0, history: null };
    return JSON.stringify(a) !== JSON.stringify(b);
  }

  get(key) { return this.signals.get(key) ?? null; }
  bySource(source) { return [...this.signals.values()].filter((s) => s.source === source); }

  /** The whole picture, sparklines attached. */
  snapshot() {
    const signals = [...this.signals.values()].map((s) => ({ ...s, history: this.history.get(s.key) ?? [] }));
    signals.sort((a, b) => stateRank(a.state) - stateRank(b.state) || a.key.localeCompare(b.key));
    return { signals, sources: [...this.sources.values()], updatedAt: Date.now() };
  }

  broadcast(changed) {
    for (const fn of this.listeners) { try { fn(changed); } catch {} }
    if (!this.clients.size) return;
    const payload = `event: signals\ndata: ${JSON.stringify(this.snapshot())}\n\n`;
    for (const res of this.clients) {
      try { res.write(payload); } catch { this.clients.delete(res); }
    }
  }
}

// ---------- config ----------

export async function loadConfig() {
  try {
    return JSON.parse(await fsp.readFile(CONFIG_FILE, 'utf8')) ?? {};
  } catch (e) {
    if (e.code !== 'ENOENT') console.warn(`signals: ${CONFIG_FILE}: ${e.message}`);
    return {};
  }
}
export const configPath = () => CONFIG_FILE;
export const stateDir = () => STATE_DIR;

// ---------- runner ----------

/**
 * Load every probe in lib/probes, run each on its own cadence, feed the
 * store. A probe module exports:
 *   { id, title, every (ms), run(ctx) → signal[] | { signals, nextIn },
 *     act?(ctx, signal, action, body) → any, stop?() }
 * ctx = { config (its own section), roster(), store, log, hostname }.
 * Probes fail independently: a thrown run marks the source, keeps its last
 * signals, and the loop goes on. A probe that returns `nextIn` paces itself
 * (SAB polls faster while something is downloading).
 */
export class SignalRunner {
  constructor(store, { roster, sessionFile, config = {}, hostname = os.hostname(), log = console } = {}) {
    this.store = store;
    this.roster = roster ?? (() => ({ agents: [] }));
    this.sessionFile = sessionFile ?? (() => null);
    this.config = config;
    this.hostname = hostname;
    this.log = log;
    this.probes = new Map();
    this.timers = new Map();
    this.inFlight = new Map();
    this.stopped = false;
  }

  async loadProbes(dir = path.join(path.dirname(new URL(import.meta.url).pathname), 'probes')) {
    const files = (await fsp.readdir(dir)).filter((f) => f.endsWith('.js')).sort();
    for (const f of files) {
      try {
        const mod = await import(pathToFileURL(path.join(dir, f)).href);
        const probe = mod.default;
        if (!probe?.id || typeof probe.run !== 'function') continue;
        const section = this.config[probe.id] ?? {};
        if (section.enabled === false) continue;
        this.probes.set(probe.id, probe);
      } catch (e) {
        this.log.warn(`signals: probe ${f} failed to load: ${e.message}`);
      }
    }
    return [...this.probes.keys()];
  }

  ctxFor(probe) {
    return {
      config: this.config[probe.id] ?? {},
      configOf: (id) => this.config[id] ?? {},
      roster: this.roster,
      sessionFile: this.sessionFile,
      store: this.store,
      hostname: this.hostname,
      log: this.log,
      stateDir: STATE_DIR,
    };
  }

  start() {
    // pushed signals carry a ttl; sweep the expired ones
    this.sweeper = setInterval(() => {
      const now = Date.now();
      const gone = [];
      for (const [k, s] of this.store.signals) if (s.expiresAt && s.expiresAt < now) { this.store.signals.delete(k); this.store.history.delete(k); gone.push(k); }
      if (gone.length) this.store.broadcast(gone);
    }, 10_000);
    for (const probe of this.probes.values()) {
      this.store.sources.set(probe.id, { id: probe.id, title: probe.title ?? probe.id, every: probe.every ?? 10_000, ok: null, error: null, ranAt: 0, ms: 0 });
      // stagger first runs a little so the boot burst doesn't line up
      this.schedule(probe, 50 + Math.random() * 400);
      if (typeof probe.start === 'function') {
        try { probe.start(this.ctxFor(probe), () => this.kick(probe.id)); } catch (e) { this.log.warn(`signals: ${probe.id}.start: ${e.message}`); }
      }
    }
  }

  stop() {
    this.stopped = true;
    clearInterval(this.sweeper);
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    for (const probe of this.probes.values()) { try { probe.stop?.(); } catch {} }
  }

  schedule(probe, ms) {
    if (this.stopped) return;
    const old = this.timers.get(probe.id);
    if (old) clearTimeout(old);
    this.timers.set(probe.id, setTimeout(() => this.tick(probe), ms));
  }

  /** run now (an event said something changed), coalescing with a run in flight */
  kick(id) {
    const probe = this.probes.get(id);
    if (!probe) return;
    if (this.inFlight.get(id)) { this.inFlight.set(id, 'again'); return; }
    this.schedule(probe, 0);
  }

  async tick(probe) {
    const id = probe.id;
    if (this.inFlight.get(id)) return;
    this.inFlight.set(id, true);
    const src = this.store.sources.get(id);
    const t0 = Date.now();
    let nextIn = probe.every ?? 10_000;
    try {
      const out = await probe.run(this.ctxFor(probe));
      const list = Array.isArray(out) ? out : (out?.signals ?? []);
      if (out && !Array.isArray(out) && out.nextIn) nextIn = out.nextIn;
      this.store.replace(id, list);
      Object.assign(src, { ok: true, error: null, ranAt: Date.now(), ms: Date.now() - t0 });
    } catch (e) {
      const msg = String(e?.message ?? e);
      if (src.error !== msg) this.log.warn(`signals: ${id}: ${msg}`);
      Object.assign(src, { ok: false, error: msg, ranAt: Date.now(), ms: Date.now() - t0 });
      this.store.broadcast([`source:${id}`]);
      nextIn = Math.max(nextIn, 15_000); // back off a failing probe
    } finally {
      const again = this.inFlight.get(id) === 'again';
      this.inFlight.delete(id);
      this.schedule(probe, again ? 0 : nextIn);
    }
  }

  async act(key, action, body) {
    const sig = this.store.get(key);
    if (!sig) throw Object.assign(new Error(`no signal ${key}`), { status: 404 });
    const probe = this.probes.get(sig.source);
    if (!probe?.act) throw Object.assign(new Error(`${sig.source} has no actions`), { status: 400 });
    if (!(sig.actions ?? []).includes(action)) throw Object.assign(new Error(`${key} does not offer ${action}`), { status: 400 });
    const r = await probe.act(this.ctxFor(probe), sig, action, body);
    this.kick(sig.source);
    return r ?? { ok: true };
  }
}

// ---------- shared helpers for probes ----------

export const GB = 1e9;
export const fmtBytes = (n) => {
  if (n == null || !Number.isFinite(n)) return '?';
  const a = Math.abs(n);
  if (a >= 1e12) return `${(n / 1e12).toFixed(2)} TB`;
  if (a >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(0)} MB`;
  return `${Math.round(n / 1e3)} kB`;
};
export const fmtDur = (s) => {
  if (s == null || !Number.isFinite(s) || s < 0) return '?';
  if (s < 90) return `${Math.round(s)}s`;
  if (s < 5400) return `${Math.round(s / 60)}m`;
  if (s < 172_800) return `${Math.floor(s / 3600)}h${String(Math.round((s % 3600) / 60)).padStart(2, '0')}`;
  return `${Math.round(s / 86_400)}d`;
};

/** fetch with a hard timeout; rejects on non-2xx */
export async function fetchJson(url, { timeoutMs = 4000, headers = {}, method = 'GET', body } = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(url, { method, headers, body, signal: ac.signal });
    if (!r.ok) throw new Error(`${method} ${url.replace(/apikey=[^&]+/, 'apikey=…')} → ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

export const untilde = (p) => (p ?? '').replace(/^~(?=\/|$)/, os.homedir());
