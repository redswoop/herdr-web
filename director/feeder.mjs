#!/usr/bin/env node
// The feeder: watches a target pane through herdr-web and nudges the
// director pane (a claude session with the scene MCP server) whenever the
// story moves. It has no opinions — the director does the thinking.
//
//   node feeder.mjs --pane w20:p1 [--api http://100.119.251.97:7693]
//     [--model sonnet] [--director-pane w20:p2] [--dry-run]
//     [--while-working 90] [--min-gap 15] [--delta-chars 5000]
//
// On boot it finds an existing director pane for the target (label
// "director:<pane>") or spawns one into the target's workspace with
// --model, the scene MCP config, and a tool allowlist. HERDR_WEB_TOKEN is
// appended as ?token= when the daemon runs with auth.
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compactEvents, budget } from './lib/compact.mjs';
import { subscribe } from './lib/sse.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const argOf = (name, dflt) => {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : dflt;
};
const flag = (name) => args.includes(name);

const PANE = argOf('--pane');
const API = (argOf('--api', process.env.HERDR_WEB_API ?? 'http://100.119.251.97:7693')).replace(/\/$/, '');
const TOKEN = process.env.HERDR_WEB_TOKEN ?? null;
const MODEL = argOf('--model', 'sonnet');
const DIRECTOR_ARG = argOf('--director-pane', null);
const DRY = flag('--dry-run');
const WHILE_WORKING = Number(argOf('--while-working', 90)) * 1000;
const MIN_GAP = Number(argOf('--min-gap', 15)) * 1000;
const DELTA_CHARS = Number(argOf('--delta-chars', 5000));
const DEBOUNCE = 3000;
const BACKSTAGE = argOf('--backstage', 'backstage'); // workspace label that holds director panes
const STATE_DIR = process.env.HERDR_WEB_STATE ?? path.join(os.homedir(), '.local', 'state', 'herdr-web');

if (!PANE) {
  console.error('usage: feeder.mjs --pane <paneId> [--api url] [--model sonnet] [--director-pane id] [--dry-run]');
  process.exit(2);
}

const ts = () => new Date().toISOString().slice(11, 19);
const log = (m) => console.log(`${ts()} ${m}`);

const url = (p) => {
  const u = new URL(`${API}${p}`);
  if (TOKEN) u.searchParams.set('token', TOKEN);
  return u.toString();
};
const agentPath = (pane, a) => `/api/agent/${encodeURIComponent(pane)}/${a}`;
export const directorLabel = (pane) => `director:${pane}`;

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

/** Build the nudge the director receives. Short on purpose: it has tools. */
export function buildNudge({ first, attached, status, agent, delta, pending, scope }) {
  if (first && attached) {
    return [
      `[feeder re-attached] The daemon or feeder restarted. The catalog may have new card types and the scene may have been restored from disk.`,
      'Re-read scene_catalog and scene_get, pull transcript_tail (40), fix anything stale, and reply with one line.',
    ].join('\n');
  }
  if (first) {
    return [
      `You are now the director for pane ${PANE} (${agent?.displayAgent ?? agent?.agent ?? 'agent'} in ${agent?.cwd ?? '?'}${agent?.label ? `, "${agent.label}"` : ''}). Scene scope: ${scope}.`,
      'Start by calling scene_catalog, scene_get, and transcript_tail (80). Then dress the stage for where the story is right now, and reply with one line.',
    ].join('\n');
  }
  const head = `[nudge] agent status: ${status ?? 'unknown'}; ${pending} new event${pending === 1 ? '' : 's'}.`;
  return delta ? `${head}\n\n${delta}\n\nAdjust the scene if the story moved; otherwise reply "no change".` : `${head} Adjust the scene if needed; otherwise reply "no change".`;
}

// ---------- director pane ----------
let roster = { agents: [] };
let directorPane = DIRECTOR_ARG;
let attached = !!DIRECTOR_ARG; // re-attached to a running director (vs freshly spawned)

export const directorName = (pane) => `director-${pane.replace(/\W+/g, '')}`;

/** herdr surfaces the agent NAME as the pane label (the label we pass to
 *  /api/chats doesn't survive), so match on either. */
function findDirector(r) {
  const wants = new Set([directorLabel(PANE), directorName(PANE)]);
  return r.agents.find((a) => a.agent === 'claude' && (wants.has(a.label) || wants.has(a.title)))?.paneId ?? null;
}

async function writeMcpConfig() {
  await fsp.mkdir(STATE_DIR, { recursive: true });
  const file = path.join(STATE_DIR, `director-mcp-${PANE.replace(/\W+/g, '_')}.json`);
  const cfg = {
    mcpServers: {
      scene: {
        command: 'node',
        args: [path.join(here, 'mcp.mjs')],
        env: { HERDR_WEB_API: API, TARGET_PANE: PANE, ...(TOKEN ? { HERDR_WEB_TOKEN: TOKEN } : {}) },
      },
    },
  };
  await fsp.writeFile(file, JSON.stringify(cfg, null, 2));
  return file;
}

/** Claude Code greets a never-opened directory with a "trust this folder?"
 *  dialog, which herdr reports as blocked and the spawn path treats as a
 *  failed launch. Pre-accept it for the stage dir, same flag the dialog
 *  sets. Only touches our own project entry. */
async function preTrustStage(dir) {
  const file = path.join(os.homedir(), '.claude.json');
  let cfg;
  try {
    cfg = JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch (e) {
    log(`cannot read ${file} (${e.message}) — the director may block on the trust dialog`);
    return;
  }
  cfg.projects ??= {};
  const p = (cfg.projects[dir] ??= {});
  if (p.hasTrustDialogAccepted && p.hasClaudeMdExternalIncludesApproved) return;
  p.hasTrustDialogAccepted = true;
  p.hasClaudeMdExternalIncludesApproved = true;
  await fsp.writeFile(file, JSON.stringify(cfg, null, 2));
  log(`pre-trusted ${dir} in ~/.claude.json`);
}

async function ensureDirector() {
  if (directorPane) return directorPane;
  const r = await getJson('/api/roster');
  roster = r;
  const target = r.agents.find((a) => a.paneId === PANE);
  if (!target) throw new Error(`target pane ${PANE} not in roster`);
  const existing = findDirector(r);
  if (existing) {
    log(`attached to existing director pane ${existing}`);
    directorPane = existing;
    attached = true;
    return existing;
  }
  const stage = path.join(here, 'stage');
  const mcp = await writeMcpConfig();
  if (!DRY) await preTrustStage(stage);
  const spawnArgs = [
    '--model', MODEL,
    '--name', 'director',
    '--mcp-config', mcp,
    '--strict-mcp-config',
    '--allowedTools', 'mcp__scene__*', 'Bash',
    '--disallowedTools', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit',
  ];
  if (DRY) {
    log(`DRY RUN: would spawn director: claude ${spawnArgs.join(' ')} in ${stage}`);
    return null;
  }
  // Directors live backstage, in their own workspace. A tab created in the
  // target's workspace becomes that workspace's current tab even with
  // focus off, so the next time Armen switches back he lands on the
  // director instead of his own pane. (seen 2026-10-06 in herdr's log)
  const backstage = r.workspaces?.find((w) => w.label === BACKSTAGE)?.workspaceId ?? null;
  log(`spawning director pane (${MODEL}) ${backstage ? `in ${backstage}` : `in a new "${BACKSTAGE}" workspace`}…`);
  const j = await postJson('/api/chats', {
    kind: 'claude',
    name: directorName(PANE),
    cwd: stage,
    ...(backstage ? { workspaceId: backstage } : { label: BACKSTAGE }),
    args: spawnArgs,
  });
  directorPane = j.paneId;
  log(`director pane ${directorPane} up`);
  return directorPane;
}

// ---------- feeding ----------
let status = null;
let directorStatus = null;
let agent = null;
let pending = [];
let first = true;
let tickTimer = null;
let lastTick = 0;
let wantTick = false;
let workingTimer = null;
let offset = 0;

function scheduleTick(why, delay = DEBOUNCE) {
  wantTick = true;
  if (tickTimer) return;
  const gap = Math.max(delay, MIN_GAP - (Date.now() - lastTick));
  log(`nudge in ${Math.round(gap / 1000)}s (${why})`);
  tickTimer = setTimeout(() => {
    tickTimer = null;
    tick().catch((e) => log(`nudge failed: ${e.message ?? e}`));
  }, gap);
}

async function tick() {
  if (!wantTick) return;
  // the director is mid-turn: its prompt would queue behind the current
  // turn and arrive stale. Hold; the roster transition re-triggers.
  if (directorStatus === 'working') {
    log('director busy — holding nudge');
    return;
  }
  if (directorStatus === 'blocked') {
    log('director is BLOCKED on a prompt — needs a human (permission?). Holding.');
    return;
  }
  wantTick = false;
  const events = pending;
  pending = [];
  const delta = budget(compactEvents(events), DELTA_CHARS);
  const msg = buildNudge({ first, attached, status, agent, delta, pending: events.length, scope: `pane:${PANE}` });
  if (DRY) {
    log(`DRY RUN nudge (${msg.length} chars):\n${msg}`);
  } else {
    await postJson(agentPath(directorPane, 'prompt'), { text: msg });
    log(`nudged director: ${events.length} events, ${msg.length} chars${first ? ' (first)' : ''}`);
  }
  first = false;
  lastTick = Date.now();
}

function onTargetStatus(next) {
  if (next === status) return;
  const prev = status;
  status = next;
  log(`target ${prev ?? '∅'} → ${next}`);
  if (prev === 'working' && (next === 'idle' || next === 'blocked' || next === 'done')) scheduleTick(`turn ended (${next})`);
  if (next === 'blocked' && prev !== 'working') scheduleTick('blocked');
  if (next === 'working') {
    clearInterval(workingTimer);
    workingTimer = setInterval(() => {
      if (pending.length) scheduleTick('long turn, periodic');
    }, WHILE_WORKING);
  } else {
    clearInterval(workingTimer);
    workingTimer = null;
  }
}

function onDirectorStatus(next) {
  if (next === directorStatus) return;
  const prev = directorStatus;
  directorStatus = next;
  log(`director ${prev ?? '∅'} → ${next}`);
  if (prev === 'working' && next !== 'working' && wantTick) scheduleTick('director free', 1000);
}

// ---------- boot ----------
await ensureDirector();
if (!directorPane && !DRY) throw new Error('no director pane');

subscribe(url('/api/roster/stream'), {
  log,
  onFrame: ({ event, data }) => {
    if (event !== 'roster') return;
    roster = JSON.parse(data);
    const a = roster.agents.find((x) => x.paneId === PANE);
    if (a) {
      agent = a;
      onTargetStatus(a.status);
    } else if (!roster.herdrDown && roster.updatedAt) {
      onTargetStatus('gone');
    }
    if (directorPane) {
      const d = roster.agents.find((x) => x.paneId === directorPane);
      if (d) onDirectorStatus(d.status);
      else if (!roster.herdrDown && roster.updatedAt) {
        log('director pane left the roster — exiting');
        process.exit(1);
      }
    }
  },
});

let stopStream = null;
async function openTranscript(initial) {
  stopStream?.();
  const t = await getJson(agentPath(PANE, 'transcript'));
  offset = t.offset ?? 0;
  if (initial) {
    log(`transcript: ${(t.events ?? []).length} events; the director pulls the tail itself on the first nudge`);
    scheduleTick('boot', 1500);
  } else {
    log('transcript reset — resuming');
  }
  stopStream = subscribe(url(`${agentPath(PANE, 'stream')}?offset=${offset}`), {
    log,
    onFrame: ({ event, data }) => {
      if (event === 'reset') {
        openTranscript(false).catch((e) => log(`reopen failed: ${e.message}`));
        return;
      }
      if (event !== 'events') return;
      const evs = JSON.parse(data);
      pending.push(...evs);
      if (evs.some((e) => e.kind === 'user' || e.kind === 'command')) scheduleTick('user spoke');
    },
  });
}
await openTranscript(true);

process.on('SIGINT', () => {
  log('bye (director pane stays up; re-run to re-attach)');
  process.exit(0);
});
