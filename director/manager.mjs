#!/usr/bin/env node
// The stage manager: watches the whole herd through herdr-web and, whenever
// a workspace's story moves, runs one headless director turn for it.
//
// A director turn is `claude -p` from the stage dir (so CLAUDE.md is its
// brain) with the scene MCP server attached. It is stateless: the prompt
// carries the director's own notes, everything that happened since the
// last turn, and the scene; the turn ends by rewriting the notes. Memory
// is a file per workspace, cursors are persisted, nothing replays.
//
//   node manager.mjs [--api http://100.119.251.97:7693] [--model sonnet]
//     [--only w20,w31] [--dry-run] [--while-working 90] [--min-gap 20]
//     [--concurrency 2] [--delta-chars 6000] [--turn-timeout 300]
//
// The pure parts (prompt, cursor resume, delta split, scheduler) live in
// lib/manager-core.mjs and are unit-tested; this file is the wiring.
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Scheduler, buildLogBody, buildPrompt, resumeOffset, splitDeltas } from './lib/manager-core.mjs';
import { describeScene } from './lib/scene-view.mjs';
import { subscribe } from './lib/sse.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const argOf = (name, dflt) => {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : dflt;
};
const flag = (name) => args.includes(name);

const API = (argOf('--api', process.env.HERDR_WEB_API ?? 'http://100.119.251.97:7693')).replace(/\/$/, '');
const TOKEN = process.env.HERDR_WEB_TOKEN ?? null;
const MODEL = argOf('--model', 'sonnet');
const ONLY = (argOf('--only', '') || '').split(',').filter(Boolean);
const DRY = flag('--dry-run');
const WHILE_WORKING = Number(argOf('--while-working', 90)) * 1000;
const MIN_GAP = Number(argOf('--min-gap', 20)) * 1000;
const CONCURRENCY = Number(argOf('--concurrency', 2));
const DELTA_CHARS = Number(argOf('--delta-chars', 6000));
const TURN_TIMEOUT = Number(argOf('--turn-timeout', 300)) * 1000;
const STAGE = path.join(here, 'stage');
const STATE_DIR = process.env.HERDR_WEB_STATE ?? path.join(os.homedir(), '.local', 'state', 'herdr-web');
const STATE_FILE = path.join(STATE_DIR, 'stage-manager.json');
const KNOWLEDGE_FILE = path.join(STAGE, 'knowledge', 'learned.md');
const notesFile = (ws) => path.join(STATE_DIR, 'director-notes', `${ws}.md`);

const ts = () => new Date().toISOString().slice(11, 19);
const log = (m) => console.log(`${ts()} ${m}`);

const url = (p) => {
  const u = new URL(`${API}${p}`);
  if (TOKEN) u.searchParams.set('token', TOKEN);
  return u.toString();
};
async function getJson(p) {
  const r = await fetch(url(p));
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `${p}: ${r.status}`);
  return j;
}
async function postJson(p, body) {
  const r = await fetch(url(p), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `${p}: ${r.status}`);
  return j;
}

// ---------- persisted state ----------
// panes: { [paneId]: { offset, sessionId } }  — transcript cursors
// workspaces: { [wsId]: { turns, lastTurnAt, lastLine, cost } }
let state = { panes: {}, workspaces: {} };
async function loadState() {
  try {
    state = { panes: {}, workspaces: {}, ...JSON.parse(await fsp.readFile(STATE_FILE, 'utf8')) };
  } catch {}
}
let saveTimer = null;
function saveState() {
  if (saveTimer) return;
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    try {
      await fsp.mkdir(STATE_DIR, { recursive: true });
      await fsp.writeFile(STATE_FILE, JSON.stringify(state, null, 1));
    } catch (e) {
      log(`state save failed: ${e.message}`);
    }
  }, 500);
}

// ---------- the herd ----------
let roster = { agents: [], workspaces: [] };
const panes = new Map(); // paneId -> { agent, status, stop, pending: [], streamOffset }
const workingTimers = new Map(); // wsId -> interval during long turns
const scheduler = new Scheduler({ run: runTurn, debounce: 3000, minGap: MIN_GAP, concurrency: CONCURRENCY, log });

const watched = (a) => (a.agent === 'claude' || a.agent === 'grok') && (!ONLY.length || ONLY.includes(a.workspaceId));
const wsLabel = (ws) => roster.workspaces?.find((w) => w.workspaceId === ws)?.label ?? ws;
const wsPanes = (ws) => [...panes.values()].filter((p) => p.agent.workspaceId === ws);

// ---------- transcripts ----------
async function openPane(a) {
  const id = a.paneId;
  const p = { agent: a, status: a.status, stop: null, pending: [], streamOffset: null };
  panes.set(id, p);
  let t;
  try {
    t = await getJson(`/api/agent/${encodeURIComponent(id)}/transcript`);
  } catch (e) {
    log(`[${id}] transcript unavailable (${e.message}); will retry on next roster change`);
    panes.delete(id);
    return;
  }
  const { offset, seed, unseenBytes } = resumeOffset(state.panes[id], t);
  if (unseenBytes) log(`[${id}] resuming from cursor; ${unseenBytes} bytes unseen`);
  p.pending.push(...seed);
  state.panes[id] = { offset, sessionId: t.sessionId ?? null };
  saveState();
  if (p.pending.length) scheduler.schedule(a.workspaceId, `${id} has ${p.pending.length} unseen events`);
  p.stop = subscribe(url(`/api/agent/${encodeURIComponent(id)}/stream?offset=${offset}`), {
    log: (m) => log(`[${id}] ${m}`),
    onFrame: ({ event, data }) => {
      if (event === 'offset') {
        p.streamOffset = Number(data); // the cursor advances only once a turn consumed the events
        return;
      }
      if (event === 'reset') {
        p.stop?.();
        panes.delete(id);
        delete state.panes[id];
        openPane(p.agent).catch((e) => log(`[${id}] reopen failed: ${e.message}`));
        return;
      }
      if (event !== 'events') return;
      const evs = JSON.parse(data);
      p.pending.push(...evs);
      if (evs.some((e) => e.kind === 'user' || e.kind === 'command')) scheduler.schedule(p.agent.workspaceId, `${id}: user spoke`);
    },
  });
}

function closePane(id) {
  const p = panes.get(id);
  if (!p) return;
  p.stop?.();
  panes.delete(id);
  if (p.pending.length) scheduler.schedule(p.agent.workspaceId, `${id} left with ${p.pending.length} unseen events`);
}

function onStatus(p, next) {
  if (next === p.status) return;
  const prev = p.status;
  p.status = next;
  const ws = p.agent.workspaceId;
  if (prev === 'working' && (next === 'idle' || next === 'blocked' || next === 'done')) scheduler.schedule(ws, `${p.agent.paneId} turn ended (${next})`);
  if (next === 'blocked' && prev !== 'working') scheduler.schedule(ws, `${p.agent.paneId} blocked`);
  const anyWorking = wsPanes(ws).some((x) => x.status === 'working');
  if (anyWorking && !workingTimers.has(ws)) {
    workingTimers.set(ws, setInterval(() => {
      if (wsPanes(ws).some((x) => x.pending.length)) scheduler.schedule(ws, 'long turn, periodic');
    }, WHILE_WORKING));
  } else if (!anyWorking && workingTimers.has(ws)) {
    clearInterval(workingTimers.get(ws));
    workingTimers.delete(ws);
  }
}

function onRoster(r) {
  roster = r;
  const want = new Map(r.agents.filter(watched).map((a) => [a.paneId, a]));
  for (const [id, a] of want) {
    const p = panes.get(id);
    if (!p) {
      openPane(a).catch((e) => log(`[${id}] open failed: ${e.message}`));
      continue;
    }
    p.agent = a;
    onStatus(p, a.status);
  }
  if (!r.herdrDown && r.updatedAt) {
    for (const id of [...panes.keys()]) if (!want.has(id)) closePane(id);
  }
}

// ---------- the turn ----------
function runClaude(prompt, { ws, mcpConfig }) {
  return new Promise((resolve) => {
    const cliArgs = [
      '-p',
      '--model', MODEL,
      '--output-format', 'json',
      '--mcp-config', mcpConfig,
      '--strict-mcp-config',
      '--allowedTools', 'mcp__scene__*', 'Bash',
      '--disallowedTools', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'WebSearch', 'WebFetch',
    ];
    const child = spawn('claude', cliArgs, { cwd: STAGE, env: { ...process.env, CLAUDECODE: '' }, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const t = setTimeout(() => {
      child.kill('SIGKILL');
      log(`[${ws}] turn timed out after ${TURN_TIMEOUT / 1000}s`);
    }, TURN_TIMEOUT);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { err += String(e.message ?? e); });
    child.on('close', (code) => {
      clearTimeout(t);
      let j = null;
      try { j = JSON.parse(out); } catch {}
      resolve({ code, json: j, raw: out, err });
    });
    child.stdin.end(prompt);
  });
}

async function writeMcpConfig(ws) {
  await fsp.mkdir(path.dirname(notesFile(ws)), { recursive: true });
  const file = path.join(STATE_DIR, `director-mcp-${ws}.json`);
  const cfg = {
    mcpServers: {
      scene: {
        command: 'node',
        args: [path.join(here, 'mcp.mjs')],
        env: {
          HERDR_WEB_API: API,
          WORKSPACE_ID: ws,
          NOTES_FILE: notesFile(ws),
          KNOWLEDGE_FILE,
          ...(TOKEN ? { HERDR_WEB_TOKEN: TOKEN } : {}),
        },
      },
    },
  };
  await fsp.writeFile(file, JSON.stringify(cfg, null, 2));
  return file;
}

async function runTurn(ws, why) {
  const ps = wsPanes(ws);
  const deltas = splitDeltas(ps.map((p) => ({ paneId: p.agent.paneId, pending: p.pending })), DELTA_CHARS);
  for (const p of ps) p.pending = [];
  const w = (state.workspaces[ws] ??= { turns: 0, lastTurnAt: 0 });
  const first = !w.turns;
  const requeue = () => {
    for (const d of deltas) panes.get(d.paneId)?.pending.unshift(...d.events);
  };
  try {
    const notes = await fsp.readFile(notesFile(ws), 'utf8').catch(() => '');
    const snapshot = await getJson(`/api/scene/${encodeURIComponent(`ws:${ws}`)}`);
    const prompt = buildPrompt({ ws, label: wsLabel(ws), agents: ps.map((p) => p.agent), notes, deltas, scene: describeScene(snapshot), first });
    const nEvents = deltas.reduce((n, d) => n + d.events.length, 0);
    log(`[${ws}] turn ${w.turns + 1}: ${nEvents} events from ${deltas.length} pane(s), ${prompt.length} chars, ${snapshot.cards.length} cards (${why})`);
    if (DRY) {
      log(`[${ws}] DRY RUN prompt:\n${prompt}`);
    } else {
      const mcp = await writeMcpConfig(ws);
      const t0 = Date.now();
      const res = await runClaude(prompt, { ws, mcpConfig: mcp });
      const j = res.json;
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      if (!j) {
        log(`[${ws}] turn produced no JSON (exit ${res.code}): ${(res.err || res.raw).trim().slice(0, 300)}`);
        requeue();
        throw new Error('no result');
      }
      const line = String(j.result ?? '').trim().replace(/\s+/g, ' ');
      log(`[${ws}] turn done in ${secs}s, ${j.num_turns ?? '?'} steps, $${(j.total_cost_usd ?? 0).toFixed(3)}${j.is_error ? ' ERROR' : ''}: ${line.slice(0, 200)}`);
      w.turns += 1;
      w.lastTurnAt = Date.now();
      w.lastLine = line.slice(0, 300);
      w.cost = (w.cost ?? 0) + (j.total_cost_usd ?? 0);
      await publishLog(ws, line);
    }
    // cursors: whatever we fed is seen — advance to where the stream was
    for (const p of ps) {
      const cur = state.panes[p.agent.paneId];
      if (cur && p.streamOffset != null && !p.pending.length) cur.offset = p.streamOffset;
    }
    saveState();
  } catch (e) {
    requeue();
    throw e; // the scheduler logs it and re-queues the workspace
  }
}

/** The director's one-liner and its notes go on stage as a collapsed card,
 *  so its reasoning is inspectable without a terminal. */
async function publishLog(ws, line) {
  const notes = await fsp.readFile(notesFile(ws), 'utf8').catch(() => '');
  const w = state.workspaces[ws];
  const body = buildLogBody({ line, notes, turns: w.turns, cost: w.cost });
  try {
    await postJson(`/api/scene/${encodeURIComponent(`ws:${ws}`)}/ops`, {
      ops: [{ op: 'mount', plugin: 'summary', id: 'director', title: 'director', props: { body, tone: 'info', collapsed: true } }],
    });
  } catch (e) {
    log(`[${ws}] couldn't publish director log: ${e.message}`);
  }
}

// ---------- boot ----------
await loadState();
log(`stage manager up: ${API} | ${MODEL}${ONLY.length ? ` | only ${ONLY.join(',')}` : ''}${DRY ? ' | DRY RUN' : ''}`);
subscribe(url('/api/roster/stream'), {
  log,
  onFrame: ({ event, data }) => {
    if (event === 'roster') onRoster(JSON.parse(data));
  },
});

process.on('SIGINT', () => {
  log('bye');
  process.exit(0);
});
