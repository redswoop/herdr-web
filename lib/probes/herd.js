// The herd itself: a "beat" per live session — what you last asked, what the
// agent last said — read from the transcript tail, plus (when the local LLM
// is already resident and the GPU isn't rendering) a two-line recap. This is
// what lets the home page say what each session is DOING, not just its name.
import fsp from 'node:fs/promises';
import { adapterFor } from '../adapters.js';
import { maybeRecap, maybeRecapWorkspace } from '../recap.js';

const cache = new Map(); // file -> { mtimeMs, beat }
/** the cached tail for a session file (the scene probe reads mentions off it) */
export const beatFor = (file) => cache.get(file)?.beat ?? null;

const squash = (s, n) => {
  const t = String(s ?? '').replace(/<[^>]{1,40}>/g, ' ').replace(/[`*_#>]/g, '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/** last user + last assistant text from the transcript tail, newest first */
export async function tailBeat(adapter, file, bytes = 196_608) {
  let fh;
  try { fh = await fsp.open(file, 'r'); } catch { return null; }
  try {
    const st = await fh.stat();
    const len = Math.min(st.size, bytes);
    const buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, st.size - len);
    const lines = buf.toString('utf8').split('\n');
    let user = null, assistant = null, turns = 0;
    const texts = [];
    for (let i = lines.length - 1; i >= 0 && texts.length < 40; i -= 1) {
      let obj;
      try { obj = JSON.parse(lines[i]); } catch { continue; }
      let evs;
      try { evs = adapter.translate(obj) ?? []; } catch { continue; }
      for (let j = evs.length - 1; j >= 0; j -= 1) {
        const ev = evs[j];
        if (ev.kind !== 'user' && ev.kind !== 'assistant') continue;
        if (!ev.text?.trim()) continue;
        texts.push({ role: ev.kind, text: ev.text, ts: ev.ts });
        if (ev.kind === 'user') { turns += 1; user ??= ev; }
        if (ev.kind === 'assistant' && !user) assistant ??= ev; // the reply after the last prompt
        if (ev.kind === 'assistant') assistant ??= ev;
      }
    }
    texts.reverse();
    return { mtimeMs: st.mtimeMs, size: st.size, user, assistant, turns, texts };
  } finally { await fh.close(); }
}

const STATE = { blocked: 'needs-you', working: 'busy', idle: 'idle', done: 'ok', unknown: 'idle' };
const RANK = ['needs-you', 'alarm', 'down', 'warn', 'busy', 'ok', 'idle'];

export default {
  id: 'herd',
  title: 'Herd',
  every: 5000,
  async run(ctx) {
    const roster = ctx.roster();
    const out = [];
    for (const a of roster.agents ?? []) {
      const file = ctx.sessionFile?.(a.paneId);
      if (!file) continue;
      const adapter = adapterFor(a.agent);
      if (!adapter?.translate) continue;
      let st;
      try { st = await fsp.stat(file); } catch { continue; }
      let hit = cache.get(file);
      if (!hit || hit.mtimeMs !== st.mtimeMs) {
        const beat = await tailBeat(adapter, file);
        if (!beat) continue;
        hit = { mtimeMs: st.mtimeMs, beat };
        cache.set(file, hit);
      }
      const { beat } = hit;
      const recap = await maybeRecap({
        paneId: a.paneId,
        sessionId: a.sessionId,
        status: a.status,
        mtimeMs: st.mtimeMs,
        texts: beat.texts,
        cwd: a.cwd,
      }, ctx);
      const lastAt = beat.assistant?.ts ? Date.parse(beat.assistant.ts) : beat.user?.ts ? Date.parse(beat.user.ts) : null;
      out.push({
        key: `beat:${a.paneId}`,
        kind: 'text',
        title: a.label ?? a.sessionTitle ?? a.title ?? a.paneId,
        state: STATE[a.status] ?? 'idle',
        status: a.status,
        agent: a.agent,
        cwd: a.cwd,
        turns: beat.turns,
        asked: squash(beat.user?.text, 160),
        said: squash(beat.assistant?.text, 220),
        turnAt: lastAt,
        recap: recap ? { now: recap.now, next: recap.next, at: recap.at, model: recap.model } : null,
        attach: { paneId: a.paneId, cwd: a.cwd },
        detail: recap?.now ?? squash(beat.assistant?.text, 160),
      });
    }
    // one card per project: the members' beats, folded by the resident model
    const groups = new Map();
    for (const b of out) {
      const a = roster.agents.find((x) => x.paneId === b.attach.paneId);
      const key = a?.repoRoot ?? a?.cwd ?? 'nowhere';
      const g = groups.get(key) ?? { key, title: key === 'nowhere' ? 'no project' : key.split('/').pop(), mtimeMs: 0, members: [], worst: 'idle' };
      g.members.push({ title: b.title, status: b.status, asked: b.asked, said: b.said, recap: b.recap });
      g.mtimeMs = Math.max(g.mtimeMs, cache.get(ctx.sessionFile(b.attach.paneId))?.mtimeMs ?? 0);
      if (RANK.indexOf(b.state) < RANK.indexOf(g.worst)) g.worst = b.state;
      groups.set(key, g);
    }
    for (const g of groups.values()) {
      const recap = await maybeRecapWorkspace(g, ctx);
      if (!recap) continue;
      out.push({
        key: `ws:${g.key}`,
        kind: 'text',
        title: g.title,
        state: g.worst,
        recap: { now: recap.now, next: recap.next, at: recap.at, model: recap.model },
        detail: recap.now,
        attach: { cwd: g.key },
      });
    }
    if (cache.size > 64) {
      const live = new Set(out.filter((s) => s.attach?.paneId).map((s) => ctx.sessionFile?.(s.attach.paneId)));
      for (const k of cache.keys()) if (!live.has(k)) cache.delete(k);
    }
    return out;
  },
};
