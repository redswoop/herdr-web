// The director: for one scene (a live session), pick the two or three
// signals that are actually part of its story and say why in a few words.
// Candidates are mechanical (a job launched from this cwd, a disk the
// transcript keeps naming, a service it talks to); the director only ranks
// and captions. Same VRAM rules as recaps (lib/recap.js): resident model
// only, never while the GPU renders, one in flight, and a cast is only
// re-picked when the candidate set or the transcript changed.
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { chat, gpuBusy, residentModel } from './recap.js';

const MIN_GAP_MS = 180_000;
let scenes = null; // sessionId -> { hash, cast: [{key, why}], at, model }
let file = null;
let inFlight = false;
let saveTimer = null;
const lastTry = new Map();

async function load(stateDir) {
  if (scenes) return;
  file = path.join(stateDir, 'scenes.json');
  try { scenes = JSON.parse(await fsp.readFile(file, 'utf8')); } catch { scenes = {}; }
}
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    try {
      await fsp.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      const entries = Object.entries(scenes).sort((a, b) => b[1].at - a[1].at).slice(0, 200);
      await fsp.writeFile(`${file}.tmp`, JSON.stringify(Object.fromEntries(entries)), { mode: 0o600 });
      await fsp.rename(`${file}.tmp`, file);
    } catch {}
  }, 2000);
}

const SYSTEM = `You direct a status board for one coding-agent session. You get the session's recap and a numbered list of live signals that MIGHT belong to it (jobs launched from its directory, disks and services its transcript mentions). Pick the ones that are genuinely part of what this session is doing or waiting on — usually 1 to 3, often fewer, sometimes none. For each pick write one short caption (≤ 60 characters) that says why it matters to THIS session, e.g. "the bake this session kicked off" or "where its renders land". Reply with one line per pick, "N: caption", most important first. Reply NONE if nothing belongs.`;

/** mechanical fallback when the model can't be used: quiet by default —
 *  what this session launched, plus anything it mentions that is actually
 *  loud right now. A calm GPU it once talked about is not a story. */
export function rankByRule(cands) {
  const rank = { 'needs-you': 0, alarm: 1, down: 2, warn: 3, busy: 4, ok: 5, idle: 6 };
  const loud = (s) => rank[s.state] <= rank.busy;
  return [...cands]
    .filter((c) => c.attached || loud(c.sig))
    .sort((a, b) => (b.attached ? 1 : 0) - (a.attached ? 1 : 0) || rank[a.sig.state] - rank[b.sig.state])
    .slice(0, 3)
    .map((c) => ({ key: c.sig.key, why: c.why }));
}

function hashOf(s, cands) {
  const h = createHash('sha1');
  h.update(String(s.mtimeMs));
  for (const c of cands) h.update(`${c.sig.key}|${c.sig.state}|${c.attached ? 1 : 0};`);
  return h.digest('hex').slice(0, 12);
}

/**
 * Returns { cast, by } for this scene — the model's pick when it has one for
 * this exact situation, else the rule's — and asks the model in the
 * background when the rules allow.
 */
export async function direct(s, cands, ctx) {
  // the model settings live under the herd probe's `recap` section: one knob for both
  const cfg = { llm: 'http://127.0.0.1:8081/v1', ...(ctx.configOf?.('herd')?.recap ?? ctx.config.recap ?? {}) };
  if (!cands.length) return { cast: [], by: 'rule' };
  await load(ctx.stateDir);
  const hash = hashOf(s, cands);
  const have = s.sessionId ? scenes[s.sessionId] : null;
  if (have?.hash === hash) return { cast: have.cast, by: 'director' };
  const fallback = { cast: rankByRule(cands), by: 'rule' };
  if (cfg.enabled === false || !s.sessionId || inFlight) return fallback;
  if (s.status === 'working') return fallback;
  const now = Date.now();
  if (now - (lastTry.get(s.paneId) ?? 0) < MIN_GAP_MS) return fallback;
  if (gpuBusy(ctx)) return fallback;
  const model = await residentModel(cfg);
  if (!model) return fallback;
  lastTry.set(s.paneId, now);
  inFlight = true;
  (async () => {
    try {
      const list = cands.map((c, i) => `${i + 1}. [${c.sig.state}] ${c.sig.title}${c.sig.detail ? ` — ${c.sig.detail}` : ''} (${c.attached ? 'launched from this session\'s directory' : c.why})`).join('\n');
      const user = `Session in ${s.cwd ?? '?'}.\nRecap: ${s.recap?.now ?? s.said ?? '(none)'}\nNext: ${s.recap?.next ?? '(unknown)'}\n\nCandidates:\n${list}`;
      const text = await chat(cfg, model, SYSTEM, user, 160);
      const cast = [];
      for (const line of text.split('\n')) {
        const m = /^\s*(\d+)\s*[:.)-]\s*(.+)$/.exec(line);
        if (!m) continue;
        const c = cands[Number(m[1]) - 1];
        if (c && !cast.some((x) => x.key === c.sig.key)) cast.push({ key: c.sig.key, why: m[2].trim().replace(/^["']|["']$/g, '').slice(0, 80) });
        if (cast.length >= 3) break;
      }
      scenes[s.sessionId] = { hash, cast, at: Date.now(), model };
      save();
      ctx.store.broadcast([`scene:${s.paneId}`]);
    } catch (e) {
      ctx.log.warn(`signals: director ${s.paneId}: ${e.message}`);
    } finally {
      inFlight = false;
    }
  })();
  return fallback;
}
