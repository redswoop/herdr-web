#!/usr/bin/env node
// The director's hands: a stdio MCP server giving a claude turn typed access
// to one workspace's scene, transcripts, notes, and knowledge through the
// herdr-web daemon.
//
// env: HERDR_WEB_API   http://host:port
//      WORKSPACE_ID    w20            (scene scope ws:<id>, transcripts of its panes)
//      TARGET_PANE     w20:p1         (pane-mode: scope pane:<id>, one transcript)
//      SCENE_SCOPE     override the scope
//      NOTES_FILE      per-workspace notes (story memory), rewritten each turn
//      KNOWLEDGE_FILE  append-only learned facts about the box
//      HERDR_WEB_TOKEN optional
import fsp from 'node:fs/promises';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { compactEvents, budget } from './lib/compact.mjs';
import { describeScene } from './lib/scene-view.mjs';

const API = (process.env.HERDR_WEB_API ?? 'http://100.119.251.97:7693').replace(/\/$/, '');
const WS = process.env.WORKSPACE_ID ?? null;
const TARGET = process.env.TARGET_PANE ?? null;
const SCOPE = process.env.SCENE_SCOPE ?? (WS ? `ws:${WS}` : TARGET ? `pane:${TARGET}` : null);
const TOKEN = process.env.HERDR_WEB_TOKEN ?? null;
const NOTES_FILE = process.env.NOTES_FILE ?? null;
const KNOWLEDGE_FILE = process.env.KNOWLEDGE_FILE ?? null;
export const NOTES_MAX_LINES = 40;
const KNOWLEDGE_MAX_BYTES = 16_000;
if (!SCOPE) {
  console.error('mcp.mjs: WORKSPACE_ID, TARGET_PANE or SCENE_SCOPE required');
  process.exit(2);
}

const url = (p) => {
  const u = new URL(`${API}${p}`);
  if (TOKEN) u.searchParams.set('token', TOKEN);
  return u.toString();
};
const scenePath = `/api/scene/${encodeURIComponent(SCOPE)}`;

async function getJson(p) {
  const r = await fetch(url(p));
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `${r.status} ${r.statusText}`);
  return j;
}
async function postJson(p, body) {
  const r = await fetch(url(p), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `${r.status} ${r.statusText}`);
  return j;
}

/** panes this director is responsible for */
async function myPanes() {
  const r = await getJson('/api/roster');
  return r.agents.filter((a) => (WS ? a.workspaceId === WS : a.paneId === TARGET));
}

const text = (s) => ({ content: [{ type: 'text', text: s }] });
const fail = (e) => ({ content: [{ type: 'text', text: `error: ${e.message ?? e}` }], isError: true });

const server = new McpServer({ name: 'scene', version: '0.2.0' });

server.registerTool(
  'scene_get',
  { description: `The scene (side panel) for ${SCOPE} as it is right now: ordered cards with their props and latest data.`, inputSchema: {} },
  async () => {
    try {
      return text(describeScene(await getJson(scenePath)));
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  'scene_catalog',
  { description: 'The card types (plugins) you can mount, with their props and any human-pressable actions.', inputSchema: {} },
  async () => {
    try {
      const { plugins } = await getJson('/api/scene-plugins');
      return text(JSON.stringify(plugins, null, 1));
    } catch (e) {
      return fail(e);
    }
  },
);

const opSchema = z.object({
  op: z.enum(['mount', 'update', 'unmount', 'move', 'clear']),
  plugin: z.string().optional(),
  id: z.string().optional(),
  title: z.string().optional(),
  props: z.record(z.string(), z.unknown()).optional(),
  at: z.number().int().optional(),
  to: z.number().int().optional(),
});

server.registerTool(
  'scene_apply',
  {
    description:
      'Change the scene. ops run in order and are validated together: a bad one rejects the whole batch. mount {plugin,id?,title?,props,at?} — an existing id is replaced in place; update {id,title?,props?} merges props; unmount {id}; move {id,to}; clear. Returns the new scene.',
    inputSchema: { ops: z.array(opSchema).min(1) },
  },
  async ({ ops }) => {
    try {
      const snap = await postJson(`${scenePath}/ops`, { ops });
      return text(`applied (rev ${snap.rev}).\n${describeScene(snap)}`);
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  'transcript_tail',
  {
    description:
      'The last N events of a pane as compact lines (USER:, AGENT:, tool calls, clipped results). Use when the nudge is not enough context. `pane` defaults to the pane the nudge was about.',
    inputSchema: {
      events: z.number().int().min(1).max(400).default(60),
      pane: z.string().optional(),
    },
  },
  async ({ events, pane }) => {
    try {
      const id = pane ?? TARGET ?? (await myPanes())[0]?.paneId;
      if (!id) return fail(new Error('no pane'));
      const t = await getJson(`/api/agent/${encodeURIComponent(id)}/transcript`);
      const evs = (t.events ?? []).slice(-events);
      return text(`[pane ${id}]\n${budget(compactEvents(evs), 20_000) || '(empty transcript)'}`);
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  'panes',
  { description: `The panes you watch (${WS ? `workspace ${WS}` : `pane ${TARGET}`}): id, agent kind, status, title, cwd.`, inputSchema: {} },
  async () => {
    try {
      const ps = await myPanes();
      return text(JSON.stringify(ps.map((a) => ({ pane: a.paneId, agent: a.agent, status: a.status, label: a.label, title: a.title, cwd: a.cwd })), null, 1));
    } catch (e) {
      return fail(e);
    }
  },
);

if (NOTES_FILE) {
  server.registerTool(
    'notes_read',
    { description: 'Your notes from previous turns — your only memory of this story.', inputSchema: {} },
    async () => text((await fsp.readFile(NOTES_FILE, 'utf8').catch(() => '')) || '(no notes yet)'),
  );
  server.registerTool(
    'notes_write',
    {
      description: `REPLACE your notes with a rewritten version (≤ ${NOTES_MAX_LINES} lines). This is your only memory across turns: what the story is, what is on stage and why, what to watch for, what you already decided not to show. Rewrite, don't append.`,
      inputSchema: { notes: z.string().max(6000) },
    },
    async ({ notes }) => {
      const lines = notes.split('\n');
      if (lines.length > NOTES_MAX_LINES) {
        return fail(new Error(`${lines.length} lines; the cap is ${NOTES_MAX_LINES}. Condense — this is memory, not a log.`));
      }
      await fsp.mkdir(path.dirname(NOTES_FILE), { recursive: true });
      await fsp.writeFile(NOTES_FILE, notes.trimEnd() + '\n');
      return text(`notes saved (${lines.length} lines)`);
    },
  );
}

if (KNOWLEDGE_FILE) {
  server.registerTool(
    'knowledge_append',
    {
      description:
        'Append ONE durable fact about this machine to the shared knowledge file (loaded into every future turn, every workspace): a command that works and its output shape, a unit name, where a log lives, how long something takes. Not for story state — that goes in notes_write.',
      inputSchema: { fact: z.string().min(8).max(400) },
    },
    async ({ fact }) => {
      const cur = await fsp.readFile(KNOWLEDGE_FILE, 'utf8').catch(() => '');
      if (cur.length > KNOWLEDGE_MAX_BYTES) return fail(new Error('knowledge file is full; ask Armen to prune it'));
      const line = `- ${fact.replace(/\s+/g, ' ').trim()} _(${new Date().toISOString().slice(0, 10)})_\n`;
      if (cur.includes(line.slice(2, 60))) return text('already known');
      await fsp.appendFile(KNOWLEDGE_FILE, line);
      return text('learned');
    },
  );
}

await server.connect(new StdioServerTransport());
