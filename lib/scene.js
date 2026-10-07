// Scene store: the plot-driven side panel. A scene is an ordered list of
// mounted plugin cards for one scope (`pane:<id>` today, `ws:<id>` later).
// Anything — a curl, the web UI, the director agent — mutates a scene by
// posting ops; every subscribed client gets the new snapshot over SSE.
//
// Plugins come in two halves. The server half (this file's catalog) owns a
// manifest the director reads and, optionally, a *source*: a data producer
// that runs while the card is mounted and pushes `data` events. The React
// half lives in web/src/scene/plugins and only renders.
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import path from 'node:path';

const MAX_CARDS = 24;
const MAX_HISTORY = 120;

// ---------- plugin catalog ----------

/** Walk a dotted path through parsed JSON. `a.b.0.c` — numeric segments
 *  index arrays. Returns undefined on any miss. */
export function jsonPath(obj, p) {
  let cur = obj;
  for (const seg of String(p).split('.')) {
    if (seg === '') continue;
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[seg];
  }
  return cur;
}

/** Pull a number out of command output per the card's parse spec. */
export function extractValue(out, parse) {
  if (!parse) {
    const n = Number(out.trim());
    return Number.isFinite(n) ? n : undefined;
  }
  if (parse.json != null) {
    try {
      const v = jsonPath(JSON.parse(out), parse.json);
      const n = typeof v === 'number' ? v : Number(v);
      return Number.isFinite(n) ? n : undefined;
    } catch {
      return undefined;
    }
  }
  if (parse.regex) {
    try {
      const m = new RegExp(parse.regex, 'm').exec(out);
      const s = m?.[parse.group ?? 1] ?? m?.[0];
      const n = Number(s);
      return Number.isFinite(n) ? n : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** Turn `k: v` / `k=v` / `k v` lines into pairs — for the kv renderer. */
export function parseKv(out) {
  const pairs = [];
  for (const raw of out.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^([^:=\t]+?)\s*[:=\t]\s*(.+)$/.exec(line) ?? /^(\S+)\s+(.+)$/.exec(line);
    if (m) pairs.push([m[1].trim(), m[2].trim()]);
    else pairs.push([line, '']);
  }
  return pairs;
}

function runShell(cmd, { timeoutMs = 10_000, cwd } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    let out = '';
    let err = '';
    let done = false;
    const child = spawn('sh', ['-c', cmd], { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    const finish = (code, timedOut = false) => {
      if (done) return;
      done = true;
      clearTimeout(t);
      resolve({ code, out: out.slice(0, 64_000), err: err.slice(0, 8_000), ms: Date.now() - started, timedOut });
    };
    const t = setTimeout(() => {
      child.kill('SIGKILL');
      finish(null, true);
    }, timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { err += String(e.message ?? e); finish(-1); });
    child.on('close', (code) => finish(code));
  });
}

/** command-watch source: poll a shell command, publish parsed results. */
function commandWatchSource(props, emit, { run = runShell } = {}) {
  const interval = Math.max(1000, Number(props.interval) || 5000);
  const history = [];
  let stopped = false;
  let running = false;
  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      const r = await run(props.cmd, { cwd: props.cwd });
      if (stopped) return;
      const value = extractValue(r.out, props.parse);
      if (value !== undefined) {
        history.push({ t: Date.now(), v: value });
        if (history.length > MAX_HISTORY) history.shift();
      }
      emit({
        at: Date.now(),
        ok: r.code === 0 && !r.timedOut,
        code: r.code,
        timedOut: r.timedOut,
        ms: r.ms,
        out: r.out,
        err: r.err,
        value,
        kv: props.render === 'kv' ? parseKv(r.out) : undefined,
        history: props.render === 'sparkline' ? history.slice() : undefined,
      });
    } finally {
      running = false;
    }
  };
  tick();
  const timer = setInterval(tick, interval).unref();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

// ---------- service-control ----------

const UNIT_RE = /^[\w@.\-]+$/;

function runArgs(cmd, args, { timeoutMs = 15_000 } = {}) {
  return new Promise((resolve) => {
    let out = '';
    let err = '';
    let done = false;
    const child = spawn(cmd, args, { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    const finish = (code, timedOut = false) => {
      if (done) return;
      done = true;
      clearTimeout(t);
      resolve({ code, out, err, timedOut });
    };
    const t = setTimeout(() => {
      child.kill('SIGKILL');
      finish(null, true);
    }, timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { err += String(e.message ?? e); finish(-1); });
    child.on('close', (code) => finish(code));
  });
}

function systemctlArgs(props, ...rest) {
  // user units talk to the user manager; system units need root for
  // actions (passwordless sudo -n — a password prompt just fails) but not
  // for `show`
  const sys = props.scope === 'system';
  return sys ? ['sudo', ['-n', 'systemctl', ...rest]] : ['systemctl', ['--user', ...rest]];
}

const SHOW_PROPS = 'LoadState,ActiveState,SubState,Result,MainPID,NRestarts,ExecMainStartTimestampMonotonic,Description';

/** systemctl show → one status object; `uptimeSec` from the monotonic clock
 *  so no timezone/locale parsing of the pretty timestamp. */
export function parseShow(out, nowMonotonicSec) {
  const kv = {};
  for (const line of out.split('\n')) {
    const i = line.indexOf('=');
    if (i > 0) kv[line.slice(0, i)] = line.slice(i + 1);
  }
  const mono = Number(kv.ExecMainStartTimestampMonotonic);
  const running = kv.ActiveState === 'active' && mono > 0 && Number.isFinite(nowMonotonicSec);
  return {
    load: kv.LoadState ?? null,
    active: kv.ActiveState ?? null,
    sub: kv.SubState ?? null,
    result: kv.Result ?? null,
    pid: Number(kv.MainPID) || null,
    restarts: Number(kv.NRestarts) || 0,
    description: kv.Description ?? null,
    uptimeSec: running ? Math.max(0, Math.round(nowMonotonicSec - mono / 1e6)) : null,
  };
}

async function monotonicNow() {
  try {
    return Number((await fsp.readFile('/proc/uptime', 'utf8')).split(' ')[0]);
  } catch {
    return NaN;
  }
}

async function serviceStatus(props, { run = runArgs } = {}) {
  const [cmd, args] = props.scope === 'system'
    ? ['systemctl', ['show', props.unit, '-p', SHOW_PROPS]] // show needs no root
    : ['systemctl', ['--user', 'show', props.unit, '-p', SHOW_PROPS]];
  const r = await run(cmd, args);
  const st = parseShow(r.out, await monotonicNow());
  let log;
  const n = Number(props.log) || 0;
  if (n > 0) {
    const [jc, jargs] = props.scope === 'system'
      ? ['journalctl', ['-u', props.unit, '-n', String(Math.min(n, 40)), '--no-pager', '-o', 'cat']]
      : ['journalctl', ['--user', '-u', props.unit, '-n', String(Math.min(n, 40)), '--no-pager', '-o', 'cat']];
    const j = await run(jc, jargs);
    log = j.out.replace(/\s+$/, '');
  }
  return { at: Date.now(), ok: r.code === 0, err: r.err.trim() || undefined, ...st, log };
}

/** service-control source: poll status; `refresh()` re-polls now (after
 *  an action) so the card doesn't sit stale for an interval. */
function serviceControlSource(props, emit, opts = {}) {
  const interval = Math.max(2000, Number(props.interval) || 10_000);
  let stopped = false;
  let running = false;
  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      const data = await serviceStatus(props, opts);
      if (!stopped) emit(data);
    } finally {
      running = false;
    }
  };
  tick();
  const timer = setInterval(tick, interval).unref();
  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
    refresh: tick,
  };
}

async function serviceAction(action, props, { run = runArgs } = {}) {
  const [cmd, args] = systemctlArgs(props, action, props.unit);
  const r = await run(cmd, args);
  const detail = (r.err || r.out).trim();
  if (r.timedOut) return { ok: false, text: `${action} ${props.unit}: timed out` };
  if (r.code !== 0) return { ok: false, text: `${action} ${props.unit} failed (exit ${r.code})${detail ? `: ${detail}` : ''}` };
  return { ok: true, text: `${action} ${props.unit}: ok` };
}

/** Manifests are written FOR the director: `description` and the prop docs
 *  are what it reads when deciding what to put on stage. `actions` are
 *  buttons the human can press on the card; the director cannot invoke them. */
export const PLUGINS = {
  'service-control': {
    name: 'service-control',
    description:
      'A systemd unit as a control: live state (active/failed/…), uptime, pid, restart count, optional journal tail, and restart/stop/start buttons the human can press. Use when the conversation is about a service — one just got built, restarted, is being debugged, or the user asked "is X up".',
    props: {
      unit: { type: 'string', required: true, doc: 'unit name, e.g. comfyui.service (".service" optional)' },
      scope: { type: 'string', enum: ['user', 'system'], doc: 'systemd --user (default) or the system manager (actions need passwordless sudo)' },
      interval: { type: 'number', doc: 'ms between status polls; min 2000, default 10000' },
      log: { type: 'number', doc: 'also show the last N journal lines (max 40); default 0' },
      actions: { type: 'object', doc: 'ignored; buttons are restart/stop/start, chosen by current state' },
    },
    source: serviceControlSource,
    validate(props) {
      if (!UNIT_RE.test(props.unit)) throw new SceneError('service-control: unit must match [\\w@.-]+');
    },
    actions: {
      restart: { doc: 'systemctl restart', run: (props, opts) => serviceAction('restart', props, opts) },
      stop: { doc: 'systemctl stop', run: (props, opts) => serviceAction('stop', props, opts) },
      start: { doc: 'systemctl start', run: (props, opts) => serviceAction('start', props, opts) },
    },
  },
  summary: {
    name: 'summary',
    description:
      'A short markdown card: where the conversation is, what is being decided, a checklist, a warning. Use it for the one-paragraph "state of play".',
    props: {
      body: { type: 'string', required: true, doc: 'markdown body (keep it under ~8 lines)' },
      tone: { type: 'string', enum: ['info', 'ok', 'warn', 'bad'], doc: 'accent color; default info' },
      collapsed: { type: 'boolean', doc: 'start collapsed (title only); the human can expand it' },
    },
  },
  'command-watch': {
    name: 'command-watch',
    description:
      'Run a shell command on an interval and show the result live. Renders as raw text, key/value rows, a single gauge, or a sparkline. Use for temps, disk, build/queue status, service checks — anything a one-liner can answer.',
    props: {
      cmd: { type: 'string', required: true, doc: 'shell command (sh -c), must exit within 10s' },
      interval: { type: 'number', doc: 'ms between runs; min 1000, default 5000' },
      cwd: { type: 'string', doc: 'working directory for the command' },
      render: { type: 'string', enum: ['text', 'kv', 'gauge', 'sparkline'], doc: 'default text' },
      parse: {
        type: 'object',
        doc: 'how to get a number for gauge/sparkline: {json:"a.b.c"} dotted path into JSON stdout, or {regex:"...", group:1}; omit if stdout is just a number',
      },
      unit: { type: 'string', doc: 'suffix shown after the value, e.g. "°C", "%", "GiB"' },
      min: { type: 'number', doc: 'gauge floor; default 0' },
      max: { type: 'number', doc: 'gauge ceiling; default 100' },
      warn: { type: 'number', doc: 'value at/above which the gauge turns amber' },
      bad: { type: 'number', doc: 'value at/above which the gauge turns red' },
      lines: { type: 'number', doc: 'text render: max lines to show (tail); default 12' },
    },
    source: commandWatchSource,
  },
};

/** The catalog as the director sees it — manifests only, no functions. */
export function catalog() {
  return Object.values(PLUGINS).map(({ source, validate, actions, ...m }) => ({
    ...m,
    live: !!source,
    actions: actions ? Object.fromEntries(Object.entries(actions).map(([k, a]) => [k, a.doc])) : undefined,
  }));
}

// ---------- store ----------

export class SceneError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export class SceneStore {
  constructor({ plugins = PLUGINS, sourceOpts = {}, persistFile = null, log = () => {} } = {}) {
    this.plugins = plugins;
    this.sourceOpts = sourceOpts;
    this.persistFile = persistFile;
    this.log = log;
    this.scenes = new Map(); // scope -> { rev, cards: Card[] }
    this.clients = new Map(); // scope -> Set<res>
    this.sources = new Map(); // `${scope}\0${id}` -> { stop, refresh? }
    this.seq = 0;
    this.saveTimer = null;
  }

  /** Bring scenes back from disk (card list only — data refills from the
   *  sources, which restart here). Unknown plugins are dropped. */
  async load() {
    if (!this.persistFile) return;
    let j;
    try {
      j = JSON.parse(await fsp.readFile(this.persistFile, 'utf8'));
    } catch {
      return;
    }
    for (const [scope, s] of Object.entries(j.scenes ?? {})) {
      const cards = (s.cards ?? []).filter((c) => this.plugins[c.plugin]);
      this.scenes.set(scope, { rev: s.rev ?? 0, cards: cards.map((c) => ({ ...c, data: null })) });
      for (const c of cards) {
        const n = Number(/^c(\d+)$/.exec(c.id)?.[1]);
        if (n > this.seq) this.seq = n;
        this.startSource(scope, c);
      }
    }
    this.log(`scene: restored ${[...this.scenes.values()].reduce((n, s) => n + s.cards.length, 0)} cards in ${this.scenes.size} scopes`);
  }

  save() {
    if (!this.persistFile || this.saveTimer) return;
    this.saveTimer = setTimeout(async () => {
      this.saveTimer = null;
      const scenes = {};
      for (const [scope, s] of this.scenes) {
        if (!s.cards.length) continue;
        scenes[scope] = { rev: s.rev, cards: s.cards.map(({ data, ...c }) => c) };
      }
      try {
        await fsp.mkdir(path.dirname(this.persistFile), { recursive: true });
        await fsp.writeFile(this.persistFile, JSON.stringify({ scenes }, null, 1));
      } catch (e) {
        this.log(`scene: save failed: ${e.message}`);
      }
    }, 250);
  }

  scene(scope) {
    let s = this.scenes.get(scope);
    if (!s) {
      s = { rev: 0, cards: [] };
      this.scenes.set(scope, s);
    }
    return s;
  }

  snapshot(scope) {
    const s = this.scene(scope);
    return { scope, rev: s.rev, cards: s.cards };
  }

  scopes() {
    return [...this.scenes.entries()]
      .filter(([, s]) => s.cards.length)
      .map(([scope, s]) => ({ scope, rev: s.rev, cards: s.cards.length }));
  }

  /** Apply ops atomically-ish: validate all first, then mutate. */
  apply(scope, ops) {
    if (!Array.isArray(ops) || !ops.length) throw new SceneError('ops: non-empty array');
    for (const op of ops) this.validate(scope, op);
    const s = this.scene(scope);
    for (const op of ops) this.exec(scope, s, op);
    s.rev += 1;
    this.broadcast(scope, 'scene', this.snapshot(scope));
    this.save();
    return this.snapshot(scope);
  }

  /** A human pressed a button on a card. Runs the plugin's action, records
   *  the result on the card, re-polls its source, tells every client. */
  async action(scope, id, name) {
    const s = this.scene(scope);
    const card = s.cards.find((c) => c.id === id);
    if (!card) throw new SceneError(`no card "${id}"`, 404);
    const act = this.plugins[card.plugin]?.actions?.[name];
    if (!act) throw new SceneError(`${card.plugin} has no action "${name}"`);
    let result;
    try {
      result = await act.run(card.props, this.sourceOpts);
    } catch (e) {
      result = { ok: false, text: String(e.message ?? e) };
    }
    card.lastAction = { name, at: Date.now(), ...result };
    card.updatedAt = Date.now();
    this.broadcast(scope, 'action', { id, action: name, result: card.lastAction });
    // a restart takes a beat to show in `show`; poll now and again shortly
    const src = this.sources.get(`${scope}\0${id}`);
    if (src?.refresh) {
      src.refresh();
      setTimeout(() => src.refresh(), 1500).unref();
    }
    return card.lastAction;
  }

  validate(scope, op) {
    if (!op || typeof op !== 'object') throw new SceneError('op: object');
    const s = this.scene(scope);
    switch (op.op) {
      case 'mount': {
        const m = this.plugins[op.plugin];
        if (!m) throw new SceneError(`unknown plugin "${op.plugin}" — see /api/scene-plugins`);
        if (op.id != null && typeof op.id !== 'string') throw new SceneError('mount.id: string');
        const props = op.props ?? {};
        if (typeof props !== 'object' || Array.isArray(props)) throw new SceneError('mount.props: object');
        for (const [k, spec] of Object.entries(m.props)) {
          if (spec.required && props[k] == null) throw new SceneError(`${op.plugin}: props.${k} required`);
          if (props[k] != null && spec.type && typeof props[k] !== spec.type) {
            throw new SceneError(`${op.plugin}: props.${k} must be ${spec.type}`);
          }
          if (props[k] != null && spec.enum && !spec.enum.includes(props[k])) {
            throw new SceneError(`${op.plugin}: props.${k} must be one of ${spec.enum.join(', ')}`);
          }
        }
        m.validate?.(props);
        const replacing = op.id != null && s.cards.some((c) => c.id === op.id);
        if (!replacing && s.cards.length >= MAX_CARDS) throw new SceneError(`scene full (${MAX_CARDS} cards)`, 409);
        return;
      }
      case 'update':
      case 'unmount':
      case 'move': {
        if (typeof op.id !== 'string') throw new SceneError(`${op.op}.id: string`);
        const card = s.cards.find((c) => c.id === op.id);
        if (!card) throw new SceneError(`no card "${op.id}"`, 404);
        if (op.op === 'move' && !Number.isInteger(op.to)) throw new SceneError('move.to: integer');
        if (op.op === 'update' && op.props) {
          if (typeof op.props !== 'object' || Array.isArray(op.props)) throw new SceneError('update.props: object');
          this.plugins[card.plugin]?.validate?.({ ...card.props, ...op.props });
        }
        return;
      }
      case 'clear':
        return;
      default:
        throw new SceneError(`unknown op "${op.op}"`);
    }
  }

  exec(scope, s, op) {
    switch (op.op) {
      case 'mount': {
        const id = op.id ?? `c${++this.seq}`;
        const now = Date.now();
        const card = {
          id,
          plugin: op.plugin,
          title: op.title ?? null,
          props: op.props ?? {},
          data: null,
          mountedAt: now,
          updatedAt: now,
        };
        const i = s.cards.findIndex((c) => c.id === id);
        if (i !== -1) {
          this.stopSource(scope, id);
          card.mountedAt = s.cards[i].mountedAt;
          s.cards[i] = card;
        } else if (Number.isInteger(op.at)) {
          s.cards.splice(Math.max(0, Math.min(op.at, s.cards.length)), 0, card);
        } else {
          s.cards.push(card);
        }
        this.startSource(scope, card);
        return;
      }
      case 'update': {
        const card = s.cards.find((c) => c.id === op.id);
        if (op.title !== undefined) card.title = op.title;
        if (op.props) {
          card.props = { ...card.props, ...op.props };
          // a source reads its props once — bounce it
          this.stopSource(scope, card.id);
          this.startSource(scope, card);
        }
        card.updatedAt = Date.now();
        return;
      }
      case 'unmount': {
        this.stopSource(scope, op.id);
        s.cards = s.cards.filter((c) => c.id !== op.id);
        return;
      }
      case 'move': {
        const i = s.cards.findIndex((c) => c.id === op.id);
        const [card] = s.cards.splice(i, 1);
        s.cards.splice(Math.max(0, Math.min(op.to, s.cards.length)), 0, card);
        return;
      }
      case 'clear': {
        for (const c of s.cards) this.stopSource(scope, c.id);
        s.cards = [];
        return;
      }
    }
  }

  startSource(scope, card) {
    const src = this.plugins[card.plugin]?.source;
    if (!src) return;
    const key = `${scope}\0${card.id}`;
    // a source returns either a stop() or { stop, refresh }
    const handle = {};
    const ret = src(card.props, (data) => {
      // the card may have been replaced since — only the live one takes data
      if (this.sources.get(key) !== handle) return;
      card.data = data;
      card.updatedAt = Date.now();
      this.broadcast(scope, 'data', { id: card.id, data });
    }, this.sourceOpts);
    if (typeof ret === 'function') handle.stop = ret;
    else Object.assign(handle, ret);
    this.sources.set(key, handle);
  }

  stopSource(scope, id) {
    const key = `${scope}\0${id}`;
    const h = this.sources.get(key);
    if (!h) return;
    this.sources.delete(key);
    try { h.stop?.(); } catch {}
  }

  subscribe(scope, res) {
    let set = this.clients.get(scope);
    if (!set) {
      set = new Set();
      this.clients.set(scope, set);
    }
    set.add(res);
    res.on('close', () => {
      set.delete(res);
      if (!set.size) this.clients.delete(scope);
    });
  }

  broadcast(scope, event, payload) {
    const set = this.clients.get(scope);
    if (!set) return;
    const frame = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const res of set) {
      try { res.write(frame); } catch {}
    }
  }

  close() {
    for (const h of this.sources.values()) {
      try { h.stop?.(); } catch {}
    }
    this.sources.clear();
    if (this.saveTimer) clearTimeout(this.saveTimer);
  }
}
