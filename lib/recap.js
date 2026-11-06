// Session recaps by the local model. Rules, because a summariser that hogs
// the 5090 is worse than no summariser:
//   - only through the arbiter (:8081) and only with a model it ALREADY has
//     loaded — never cause a load, never swap models;
//   - never while a gaffer gpu job is running or yielded on this box;
//   - only at act breaks (the session is not `working`), only when the
//     transcript moved since the last recap, at most once per 2 min per pane;
//   - one request in flight at a time.
// Results persist in <state>/recaps.json keyed by session id.
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fetchJson } from './signals.js';

const MIN_GAP_MS = 120_000;
const MODELS_TTL_MS = 30_000;

let recaps = null;     // sessionId -> { now, next, at, mtimeMs, model }
let file = null;
let inFlight = false;
let modelsAt = 0;
let loadedModel = null;
const lastTry = new Map(); // paneId -> ts
let saveTimer = null;

async function load(stateDir) {
  if (recaps) return;
  file = path.join(stateDir, 'recaps.json');
  try { recaps = JSON.parse(await fsp.readFile(file, 'utf8')); } catch { recaps = {}; }
}
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    try {
      await fsp.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      // keep it bounded: newest 200
      const entries = Object.entries(recaps).sort((a, b) => b[1].at - a[1].at).slice(0, 200);
      await fsp.writeFile(`${file}.tmp`, JSON.stringify(Object.fromEntries(entries)), { mode: 0o600 });
      await fsp.rename(`${file}.tmp`, file);
    } catch {}
  }, 2000);
}

export async function residentModel(cfg) {
  const now = Date.now();
  if (now - modelsAt < MODELS_TTL_MS) return loadedModel;
  modelsAt = now;
  try {
    const d = await fetchJson(`${cfg.llm}/models`, { timeoutMs: 3000 });
    const loaded = (d.data ?? []).filter((m) => m.status?.value === 'loaded').map((m) => m.id);
    const want = cfg.model ? loaded.find((m) => m === cfg.model) : null;
    loadedModel = want ?? loaded.find((m) => /qwen/i.test(m)) ?? loaded[0] ?? null;
  } catch {
    loadedModel = null;
  }
  return loadedModel;
}

export function gpuBusy(ctx) {
  return ctx.store.bySource('gaffer').some((s) => s.kind === 'job' && s.needs === 'gpu'
    && (s.jobState === 'running' || s.jobState === 'yielded') && (!s.host || s.host === ctx.hostname));
}

/** one chat completion against the arbiter, thinking off; returns the text */
export async function chat(cfg, model, system, user, maxTokens = 200) {
  const r = await fetchJson(`${cfg.llm}/chat/completions`, {
    method: 'POST',
    timeoutMs: 60_000,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: maxTokens,
      chat_template_kwargs: { enable_thinking: false },
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    }),
  });
  return String(r.choices?.[0]?.message?.content ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

const SYSTEM = `You write two-line status cards for a board that shows what each coding-agent session is doing. Read the transcript excerpt (USER = the human, AGENT = the assistant). Reply with exactly two lines:
NOW: <what is happening right now, past tense if it just finished, ≤ 110 characters>
NEXT: <what the human does next, imperative, addressed to them ("Review…", "Decide…", "Nothing; agent is working"), ≤ 60 characters>
Plain text. No markdown, no quotes, no preamble, no third line.`;

function excerpt(texts, max = 3800) {
  const parts = [];
  let n = 0;
  for (let i = texts.length - 1; i >= 0; i -= 1) {
    const t = texts[i];
    const body = String(t.text).replace(/\s+/g, ' ').trim().slice(0, 900);
    const line = `${t.role === 'user' ? 'USER' : 'AGENT'}: ${body}`;
    if (n + line.length > max) break;
    parts.push(line);
    n += line.length + 1;
  }
  return parts.reverse().join('\n');
}

function parse(text) {
  const t = String(text ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  const now = (t.match(/NOW:\s*(.+)/i) ?? [])[1]?.trim();
  const next = (t.match(/NEXT:\s*(.+)/i) ?? [])[1]?.trim();
  if (!now) return null;
  return { now: now.slice(0, 160), next: (next ?? '').slice(0, 140) };
}

/**
 * Returns the recap on file for this session (maybe stale) and, when the
 * rules allow, refreshes it in the background. Never throws, never blocks
 * the probe on the model.
 */
export async function maybeRecap(s, ctx) {
  const cfg = { llm: 'http://127.0.0.1:8081/v1', ...(ctx.config.recap ?? {}) };
  if (cfg.enabled === false || !s.sessionId) return null;
  await load(ctx.stateDir);
  const have = recaps[s.sessionId] ?? null;
  const fresh = have && have.mtimeMs === s.mtimeMs;
  if (fresh || inFlight) return have;
  if (s.status === 'working' || !s.texts?.length) return have;
  const now = Date.now();
  if (now - (lastTry.get(s.paneId) ?? 0) < MIN_GAP_MS) return have;
  if (gpuBusy(ctx)) return have;
  const model = await residentModel(cfg);
  if (!model) return have;
  lastTry.set(s.paneId, now);
  inFlight = true;
  const mtimeMs = s.mtimeMs;
  (async () => {
    try {
      const r = await fetchJson(`${cfg.llm}/chat/completions`, {
        method: 'POST',
        timeoutMs: 60_000,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          max_tokens: 200,
          chat_template_kwargs: { enable_thinking: false },
          messages: [
            { role: 'system', content: SYSTEM },
            { role: 'user', content: `Session in ${s.cwd ?? '?'} (status: ${s.status}).\n\n${excerpt(s.texts)}` },
          ],
        }),
      });
      const parsed = parse(r.choices?.[0]?.message?.content);
      if (parsed) {
        recaps[s.sessionId] = { ...parsed, at: Date.now(), mtimeMs, model };
        save();
        ctx.store.broadcast([`recap:${s.paneId}`]);
      }
    } catch (e) {
      ctx.log.warn(`signals: recap ${s.paneId}: ${e.message}`);
    } finally {
      inFlight = false;
    }
  })();
  return have;
}

// ---------- workspace recaps ----------
// One card per project, not per session: the members' beats go in, two lines
// come out. Same gates as above. A project with one session just borrows that
// session's recap — no model call for a restatement.

const WS_SYSTEM = `You write a two-line status card for ONE project on a board of coding-agent sessions. You get the project's live sessions, each with what the human last asked, what the agent last said, and (sometimes) a per-session recap. Combine them. Reply with exactly two lines:
NOW: <what is going on in this project across its sessions, ≤ 140 characters>
NEXT: <what the human does next, imperative, addressed to them, ≤ 60 characters>
Plain text. No markdown, no session names unless needed to disambiguate, no third line.`;

const WS_GAP_MS = 180_000;
const wsLastTry = new Map();

/**
 * @param ws { key, title, mtimeMs (max over members), members: [{ title, status, asked, said, recap }] }
 */
export async function maybeRecapWorkspace(ws, ctx) {
  const cfg = { llm: 'http://127.0.0.1:8081/v1', ...(ctx.config.recap ?? {}) };
  if (cfg.enabled === false || !ws.members.length) return null;
  await load(ctx.stateDir);
  if (ws.members.length === 1) {
    const r = ws.members[0].recap;
    return r ? { now: r.now, next: r.next, at: r.at, model: r.model, borrowed: true } : null;
  }
  const id = `ws:${ws.key}`;
  const have = recaps[id] ?? null;
  if ((have && have.mtimeMs === ws.mtimeMs) || inFlight) return have;
  const now = Date.now();
  if (now - (wsLastTry.get(id) ?? 0) < WS_GAP_MS) return have;
  if (gpuBusy(ctx)) return have;
  const model = await residentModel(cfg);
  if (!model) return have;
  wsLastTry.set(id, now);
  inFlight = true;
  const mtimeMs = ws.mtimeMs;
  (async () => {
    try {
      const lines = ws.members.map((m, i) => [
        `${i + 1}. "${m.title}" (${m.status})`,
        m.recap ? `   recap: ${m.recap.now} / next: ${m.recap.next}` : null,
        m.asked ? `   human asked: ${m.asked}` : null,
        m.said ? `   agent said: ${m.said}` : null,
      ].filter(Boolean).join('\n')).join('\n');
      const text = await chat(cfg, model, WS_SYSTEM, `Project: ${ws.title}\n\n${lines}`, 220);
      const parsed = parse(text);
      if (parsed) {
        recaps[id] = { ...parsed, at: Date.now(), mtimeMs, model };
        save();
        ctx.store.broadcast([id]);
      }
    } catch (e) {
      ctx.log.warn(`signals: recap ${id}: ${e.message}`);
    } finally {
      inFlight = false;
    }
  })();
  return have;
}
