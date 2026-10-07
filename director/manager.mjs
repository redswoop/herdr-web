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
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compactEvents, budget } from './lib/compact.mjs';
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
const DEBOUNCE = 3000;
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
// workspaces: { [wsId]: { lastTurnAt, turns } }
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
const panes = new Map(); // paneId -> { agent, status, stop, pending: [] }
const wsRuns = new Map(); // wsId -> { timer, want, running, lastTick, workingTimer, why }
let running = 0;

const watched = (a) => (a.agent === 'claude' || a.agent === 'grok') && (!ONLY.length || ONLY.includes(a.workspaceId));
const wsLabel = (ws) => roster.workspaces?.find((w) => w.workspaceId === ws)?.label ?? ws;

function wsRun(ws) {
  let r = wsRuns.get(ws);
  if (!r) {
    r = { timer: null, want: false, running: false, lastTick: 0, workingTimer: null, why: '' };
    wsRuns.set(ws, r);
  }
  return r;
}

function scheduleTurn(ws, why, delay = DEBOUNCE) {
  const r = wsRun(ws);
  r.want = true;
  r.why = why;
  if (r.timer || r.running) return;
  const gap = Math.max(delay, MIN_GAP - (Date.now() - r.lastTick));
  log(`[${ws}] turn in ${Math.round(gap / 1000)}s (${why})`);
  r.timer = setTimeout(() => {
    r.timer = null;
    runTurn(ws).catch((e) => log(`[${ws}] turn failed: ${e.message ?? e}`));
  }, gap);
}

// ---------- transcripts ----------
async function openPane(a) {
  const id = a.paneId;
  const p = { agent: a, status: a.status, stop: null, pending: [] };
  panes.set(id, p);
  const cur = state.panes[id];
  let t;
  try {
    t = await getJson(`/api/agent/${encodeURIComponent(id)}/transcript`);
  } catch (e) {
    log(`[${id}] transcript unavailable (${e.message}); will retry on next roster change`);
    panes.delete(id);
    return;
  }
  const total = t.events?.length ?? 0;
  let offset = t.offset ?? 0;
  if (cur && cur.sessionId === t.sessionId && cur.offset <= offset) {
    // same session as our cursor: open the stream AT the cursor and the
    // server replays exactly what we haven't seen, no approximation
    offset = cur.offset;
    if (cur.offset < (t.offset ?? 0)) log(`[${id}] resuming from cursor; ${(t.offset ?? 0) - cur.offset} bytes unseen`);
  } else if (total) {
    p.pending.push(...(t.events ?? []).slice(-40)); // a new pane: a glimpse of its recent story
  }
  state.panes[id] = { offset, sessionId: t.sessionId ?? null };
  saveState();
  if (p.pending.length) scheduleTurn(a.workspaceId, `${id} has ${p.pending.length} unseen events`);
  p.stop = subscribe(url(`/api/agent/${encodeURIComponent(id)}/stream?offset=${offset}`), {
    log: (m) => log(`[${id}] ${m}`),
    onFrame: ({ event, data }) => {
      if (event === 'offset') {
        // the cursor only advances once a turn has consumed the events;
        // until then remember where the stream is
        p.streamOffset = Number(data);
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
      if (evs.some((e) => e.kind === 'user' || e.kind === 'command')) scheduleTurn(p.agent.workspaceId, `${id}: user spoke`);
    },
  });
}

function closePane(id) {
  const p = panes.get(id);
  if (!p) return;
  p.stop?.();
  panes.delete(id);
  if (p.pending.length) scheduleTurn(p.agent.workspaceId, `${id} left with ${p.pending.length} unseen events`);
}

function onStatus(p, next) {
  if (next === p.status) return;
  const prev = p.status;
  p.status = next;
  const ws = p.agent.workspaceId;
  const r = wsRun(ws);
  if (prev === 'working' && (next === 'idle' || next === 'blocked' || next === 'done')) scheduleTurn(ws, `${p.agent.paneId} turn ended (${next})`);
  if (next === 'blocked' && prev !== 'working') scheduleTurn(ws, `${p.agent.paneId} blocked`);
  const anyWorking = [...panes.values()].some((x) => x.agent.workspaceId === ws && x.status === 'working');
  if (anyWorking && !r.workingTimer) {
    r.workingTimer = setInterval(() => {
      const pend = [...panes.values()].filter((x) => x.agent.workspaceId === ws).reduce((n, x) => n + x.pending.length, 0);
      if (pend) scheduleTurn(ws, 'long turn, periodic');
    }, WHILE_WORKING);
  } else if (!anyWorking && r.workingTimer) {
    clearInterval(r.workingTimer);
    r.workingTimer = null;
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
export function buildPrompt({ ws, label, agents, notes, deltas, scene, first }) {
  const paneLines = agents
    .map((a) => `- ${a.paneId}: ${a.displayAgent ?? a.agent} "${a.label ?? a.title}" — ${a.status}, cwd ${a.cwd ?? '?'}`)
    .join('\n');
  const delta = deltas.length
    ? deltas.map(({ paneId, text }) => `[pane ${paneId}]\n${text}`).join('\n\n')
    : '(nothing new in the transcripts — a status changed)';
  return [
    `You are the director for workspace ${ws}${label && label !== ws ? ` ("${label}")` : ''}. Scene scope: ws:${ws}.`,
    `PANES:\n${paneLines || '(none)'}`,
    `YOUR NOTES (your only memory; ${first ? 'none yet — this is your first turn here' : 'from your last turn'}):\n${notes || '(empty)'}`,
    `SINCE YOU LAST LOOKED:\n${delta}`,
    `SCENE NOW:\n${scene}`,
    first
      ? 'First turn: call scene_catalog once, then dress the stage for where the story is. Call transcript_tail for any pane whose context you need.'
      : 'Adjust the scene with scene_apply if the story moved; otherwise leave it.',
    'Then call notes_write with your rewritten notes (≤ 40 lines: the story, what is on stage and why, what to watch for, what you decided not to show). Use knowledge_append only for durable facts about the machine. Reply with ONE line.',
  ].join('\n\n');
}

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

async function runTurn(ws) {
  const r = wsRun(ws);
  if (!r.want) return;
  if (r.running) return;
  if (running >= CONCURRENCY) {
    log(`[${ws}] waiting for a slot (${running} turns running)`);
    setTimeout(() => runTurn(ws).catch(() => {}), 5000);
    return;
  }
  r.running = true;
  r.want = false;
  running += 1;
  const wsPanes = [...panes.values()].filter((p) => p.agent.workspaceId === ws);
  const deltas = [];
  for (const p of wsPanes) {
    if (!p.pending.length) continue;
    const text = budget(compactEvents(p.pending), Math.floor(DELTA_CHARS / Math.max(1, wsPanes.filter((x) => x.pending.length).length)));
    deltas.push({ paneId: p.agent.paneId, text, events: p.pending });
    p.pending = [];
  }
  const w = (state.workspaces[ws] ??= { turns: 0, lastTurnAt: 0 });
  const first = !w.turns;
  try {
    const notes = await fsp.readFile(notesFile(ws), 'utf8').catch(() => '');
    const snapshot = await getJson(`/api/scene/${encodeURIComponent(`ws:${ws}`)}`);
    const prompt = buildPrompt({ ws, label: wsLabel(ws), agents: wsPanes.map((p) => p.agent), notes, deltas, scene: describeScene(snapshot), first });
    const nEvents = deltas.reduce((n, d) => n + d.events.length, 0);
    log(`[${ws}] turn ${w.turns + 1}: ${nEvents} events from ${deltas.length} pane(s), ${prompt.length} chars, ${snapshot.cards.length} cards (${r.why})`);
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
        for (const d of deltas) panes.get(d.paneId)?.pending.unshift(...d.events); // retry later with the same delta
        r.want = true;
      } else {
        const line = String(j.result ?? '').trim().replace(/\s+/g, ' ');
        log(`[${ws}] turn done in ${secs}s, ${j.num_turns ?? '?'} steps, $${(j.total_cost_usd ?? 0).toFixed(3)}${j.is_error ? ' ERROR' : ''}: ${line.slice(0, 200)}`);
        w.turns += 1;
        w.lastTurnAt = Date.now();
        w.lastLine = line.slice(0, 300);
        w.cost = (w.cost ?? 0) + (j.total_cost_usd ?? 0);
        await publishLog(ws, line);
      }
    }
    // cursors: whatever we fed is seen — advance to where the stream was
    for (const p of wsPanes) {
      const cur = state.panes[p.agent.paneId];
      if (cur && p.streamOffset != null && !p.pending.length) cur.offset = p.streamOffset;
      if (cur) cur.seenAt = Date.now();
    }
    saveState();
  } catch (e) {
    log(`[${ws}] turn error: ${e.message ?? e}`);
    for (const d of deltas) panes.get(d.paneId)?.pending.unshift(...d.events);
    r.want = true;
  } finally {
    r.running = false;
    r.lastTick = Date.now();
    running -= 1;
    if (r.want) scheduleTurn(ws, 'queued during turn');
  }
}

/** The director's one-liner and its notes go on stage as a collapsed card,
 *  so its reasoning is inspectable without a terminal. */
async function publishLog(ws, line) {
  const notes = await fsp.readFile(notesFile(ws), 'utf8').catch(() => '');
  const w = state.workspaces[ws];
  const body = `${line || '(no reply)'}\n\n---\n${notes.trim() || '(no notes)'}\n\n_turn ${w.turns} · $${(w.cost ?? 0).toFixed(2)} total_`;
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
