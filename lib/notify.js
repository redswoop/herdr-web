// Notification layer: subscription store + coordinator (design stolen from
// collie's bridge/notifications.ts, credit where due):
//   • debounce — blocked-then-handled-at-the-desk within the window never buzzes
//   • coalesce — the whole herd shares ONE notification slot, re-rendered per change
//   • retract — resolving an agent (or its pane closing) updates or clears the
//     phone's notification, so handled work never lingers on the lock screen
// Plus the thing collie can't do: the alert is enriched server-side with the
// actual question + tappable answer actions (we have blocked-context; they don't).
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { genVapidKeys, sendPush } from './webpush.js';

const STATE_DIR = process.env.HERDR_WEB_STATE
  ?? path.join(os.homedir(), '.local', 'state', 'herdr-web');
const HERD_TAG = 'herd';
// Apple rejects BadJwtToken for placeholder subjects like @localhost / .local.
// Use a real-looking contact URL; override with HERDR_WEB_VAPID_SUBJECT if you want.
const SUBJECT = process.env.HERDR_WEB_VAPID_SUBJECT ?? 'mailto:herdr-web@example.com';

async function writeState(file, data) {
  await fsp.mkdir(STATE_DIR, { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  await fsp.rename(tmp, file);
}

export class PushStore {
  constructor() {
    this.subsFile = path.join(STATE_DIR, 'subscriptions.json');
    this.vapidFile = path.join(STATE_DIR, 'vapid.json');
    this.subs = new Map(); // endpoint -> subscription
    this.vapid = null;
  }

  async init() {
    try {
      this.vapid = JSON.parse(await fsp.readFile(this.vapidFile, 'utf8'));
    } catch {
      this.vapid = genVapidKeys(); // zero-config: mint keys on first run
      await writeState(this.vapidFile, this.vapid);
    }
    try {
      for (const s of JSON.parse(await fsp.readFile(this.subsFile, 'utf8'))) {
        this.subs.set(s.endpoint, s);
      }
    } catch {}
    return this;
  }

  async add(sub) {
    this.subs.set(sub.endpoint, sub);
    await writeState(this.subsFile, [...this.subs.values()]);
  }

  async remove(endpoint) {
    if (this.subs.delete(endpoint)) await writeState(this.subsFile, [...this.subs.values()]);
  }

  // Deliver to every device; prune subscriptions the push service says are gone.
  // Returns per-endpoint status codes for diagnostics.
  async broadcast(payload, opts = {}) {
    const dead = [];
    const results = [];
    await Promise.all([...this.subs.values()].map(async (sub) => {
      // endpoint tail distinguishes two devices from one device subscribed twice
      const host = `${new URL(sub.endpoint).host}…${sub.endpoint.slice(-6)}`;
      try {
        const status = await sendPush(sub, payload, { topic: 'herdr-herd', ...opts }, this.vapid, SUBJECT);
        results.push({ host, status });
        if (status === 404 || status === 410) dead.push(sub.endpoint);
        else if (status >= 400) console.warn(`[push] ${status} from ${host}`);
        else console.log(`[push] ${status} → ${host} tag=${payload.tag ?? '-'}`);
      } catch (e) {
        results.push({ host, status: 0, error: String(e.message ?? e) });
        console.warn(`[push] send failed: ${e.message ?? e}`);
      }
    }));
    for (const e of dead) await this.remove(e);
    return results;
  }
}

const NOTIFIABLE = new Set(['blocked', 'done']);

export class Coordinator {
  // getContext(paneId) -> blocked-context ({kind, questions|question|tool,...})
  // or null; called at fire time so the notification carries the question.
  constructor(store, getContext, delayMs = 20_000) {
    this.store = store;
    this.getContext = getContext;
    this.delayMs = delayMs;
    this.pending = new Map();     // paneId -> timer
    this.outstanding = new Map(); // paneId -> {agent, cwd, status}
    // Emits are chained so rapid transitions can't reorder in flight (an
    // enriched summary awaits blocked-context; a clear doesn't — unserialized,
    // the clear can overtake it and a stale "needs you" wins).
    this.chain = Promise.resolve();
  }

  onTransition(a, to) {
    const id = a.paneId;
    if (!NOTIFIABLE.has(to)) return this.resolve(id);
    clearTimeout(this.pending.get(id));
    this.pending.set(id, setTimeout(() => {
      this.pending.delete(id);
      this.outstanding.set(id, { agent: a.agent, cwd: a.cwd, status: to });
      this.emit(true);
    }, this.delayMs));
  }

  onRemove(paneId) { this.resolve(paneId); }

  resolve(id) {
    clearTimeout(this.pending.get(id));
    this.pending.delete(id);
    if (this.outstanding.delete(id)) this.emit(false);
  }

  emit(renotify) {
    const run = () => this.doEmit(renotify).catch(() => {});
    this.chain = this.chain.then(run, run);
    return this.chain;
  }

  async doEmit(renotify) {
    if (!this.store.subs.size) return;
    if (!this.outstanding.size) {
      return this.store.broadcast({ type: 'clear', tag: HERD_TAG });
    }
    const entries = [...this.outstanding.entries()];
    let msg;
    if (entries.length === 1) {
      const [paneId, a] = entries[0];
      msg = {
        title: `${a.agent} ${a.status === 'blocked' ? 'needs you' : 'is done'}`,
        body: shortCwd(a.cwd),
        tag: HERD_TAG, paneId, renotify,
      };
      if (a.status === 'blocked') await this.enrich(msg, paneId);
    } else {
      const alerts = entries.map(([, a]) => a);
      const all = (s) => alerts.every((a) => a.status === s);
      msg = {
        title: all('blocked') ? `${alerts.length} agents need you`
          : all('done') ? `${alerts.length} agents done`
            : `${alerts.length} agents need attention`,
        body: alerts.map((a) => a.agent).join(', '),
        tag: HERD_TAG, renotify,
      };
    }
    return this.store.broadcast(msg);
  }

  // Put the agent's actual question in the body, and (when the choice is
  // simple enough) answer buttons on the notification itself. Android caps
  // actions at Notification.maxActions (2 on Chrome) — beyond that, tap-to-open.
  async enrich(msg, paneId) {
    const ctx = await this.getContext(paneId).catch(() => null);
    if (!ctx) return;
    if (ctx.kind === 'ask' && ctx.questions?.length) {
      const q = ctx.questions[0];
      msg.body = q.question;
      if (ctx.questions.length === 1 && !q.multiSelect && q.options?.length === 2) {
        msg.actions = q.options.map((o, i) => ({
          title: o.label, keys: [String(i + 1)], expect: o.label.slice(0, 30),
        }));
      }
    } else if (ctx.kind === 'menu') {
      msg.body = ctx.question || ctx.header || msg.body;
      if (ctx.options?.length === 2) {
        msg.actions = ctx.options.map((o) => ({
          title: o.label, keys: [String(o.n)], expect: o.label.slice(0, 30),
        }));
      }
    } else if (ctx.kind === 'permission') {
      msg.body = `🔒 wants to run ${ctx.tool}`;
      // options are parsed off the live screen — their labels are the ground
      // truth for expect. No parse → no buttons: a guessed digit on a
      // non-uniform prompt can answer "No" when the button said "Always".
      if (ctx.options?.length >= 2) {
        msg.actions = ctx.options.slice(0, 2).map((o) => ({
          title: o.label, keys: [String(o.n)], expect: o.label.slice(0, 30),
        }));
      }
    }
  }
}

function shortCwd(cwd) {
  return (cwd ?? '').replace(os.homedir(), '~');
}
