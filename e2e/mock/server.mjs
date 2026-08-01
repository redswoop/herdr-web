/**
 * Deterministic herdr-web API mock for Playwright e2e.
 * No herdr socket. Control plane: POST /__mock/*
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(__dirname, '../fixtures');
const PORT = Number(process.env.MOCK_PORT || 7684);
const TOKEN = process.env.MOCK_TOKEN ?? null; // null = auth off

const readJson = (name) => JSON.parse(fs.readFileSync(path.join(FIX, name), 'utf8'));
const readText = (name) => fs.readFileSync(path.join(FIX, name), 'utf8');

function clone(x) {
  return JSON.parse(JSON.stringify(x));
}

/** @type {import('../../shared/src/types.ts').Roster} */
let roster = clone(readJson('roster.json'));
/** @type {Record<string, object[]>} */
const transcripts = {
  'w1:p1': clone(readJson('transcript-w1p1.json')),
  'w1:p2': clone(readJson('transcript-w1p2.json')),
  'w2:p1': clone(readJson('transcript-w2p1.json')),
  'w3:p1': [],
};
/** @type {Record<string, string>} */
const screens = {
  'w1:p1': 'idle screen\n',
  'w1:p2': readText('screen-working.txt'),
  'w2:p1': 'Bash(rm -rf /tmp/staging-db)\nDo you want to proceed?\n❯ 1. Yes\n  2. No\n',
  'w3:p1': 'starting…\n',
};
/** @type {Record<string, object>} */
const blocked = {
  'w1:p1': { kind: 'none' },
  'w1:p2': { kind: 'none' },
  'w2:p1': clone(readJson('blocked-permission.json')),
  'w3:p1': { kind: 'none' },
};
const kinds = readJson('kinds.json');
const projects = readJson('projects.json');
const worktrees = readJson('worktrees.json');
const fileReadme = readJson('file-readme.json');

/** @type {Set<http.ServerResponse>} */
const rosterClients = new Set();
/** @type {Map<string, Set<http.ServerResponse>>} */
const agentClients = new Map();

const log = {
  prompts: /** @type {object[]} */ ([]),
  answers: /** @type {object[]} */ ([]),
  keys: /** @type {object[]} */ ([]),
  chats: /** @type {object[]} */ ([]),
  uploads: /** @type {object[]} */ ([]),
  push: /** @type {object[]} */ ([]),
};

let chatSeq = 0;
let pushSubscribed = false;

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-credentials': 'true',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
  });
  res.end(body);
}

function tokenEq(a, b) {
  if (a == null || b == null) return false;
  return a === b;
}

function checkAuth(req, res, url, { enforce = true } = {}) {
  if (!TOKEN) return true;
  const qtok = url.searchParams.get('token');
  const cookie = (req.headers.cookie ?? '').split(/;\s*/).find((c) => c.startsWith('hw_token='));
  if (tokenEq(qtok, TOKEN)) {
    res.setHeader(
      'set-cookie',
      `hw_token=${TOKEN}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000`,
    );
    return true;
  }
  if (tokenEq(cookie?.slice('hw_token='.length), TOKEN)) return true;
  if (enforce) sendJson(res, 401, { error: 'missing/bad token — open /?token=… or paste it into the gate' });
  return false;
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks);
  if (!raw.length) return {};
  const ct = req.headers['content-type'] ?? '';
  if (ct.includes('application/json')) return JSON.parse(raw.toString('utf8'));
  return { raw, type: ct };
}

function startSse(res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-store',
    'x-accel-buffering': 'no',
    'access-control-allow-origin': '*',
  });
  res.write('retry: 2000\n\n');
  const ping = setInterval(() => res.write('event: ping\ndata: {}\n\n'), 10_000);
  res.on('close', () => clearInterval(ping));
}

function broadcastRoster() {
  const payload = `event: roster\ndata: ${JSON.stringify(roster)}\n\n`;
  for (const c of rosterClients) {
    try {
      c.write(payload);
    } catch {
      /* closed */
    }
  }
}

function broadcastAgent(paneId, event, data) {
  const set = agentClients.get(paneId);
  if (!set) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of set) {
    try {
      c.write(payload);
    } catch {
      /* closed */
    }
  }
}

function setAgentStatus(paneId, status) {
  const a = roster.agents.find((x) => x.paneId === paneId);
  if (!a) return;
  a.status = status;
  a.revision = (a.revision ?? 0) + 1;
  roster.updatedAt = Date.now();
  broadcastRoster();
  broadcastAgent(paneId, 'status', { status });
}

function appendEvents(paneId, events) {
  if (!transcripts[paneId]) transcripts[paneId] = [];
  transcripts[paneId].push(...events);
  broadcastAgent(paneId, 'events', events);
}

function resetState() {
  roster = clone(readJson('roster.json'));
  transcripts['w1:p1'] = clone(readJson('transcript-w1p1.json'));
  transcripts['w1:p2'] = clone(readJson('transcript-w1p2.json'));
  transcripts['w2:p1'] = clone(readJson('transcript-w2p1.json'));
  transcripts['w3:p1'] = [];
  screens['w1:p1'] = 'idle screen\n';
  screens['w1:p2'] = readText('screen-working.txt');
  screens['w2:p1'] =
    'Bash(rm -rf /tmp/staging-db)\nDo you want to proceed?\n❯ 1. Yes\n  2. No\n';
  screens['w3:p1'] = 'starting…\n';
  blocked['w1:p1'] = { kind: 'none' };
  blocked['w1:p2'] = { kind: 'none' };
  blocked['w2:p1'] = clone(readJson('blocked-permission.json'));
  blocked['w3:p1'] = { kind: 'none' };
  log.prompts.length = 0;
  log.answers.length = 0;
  log.keys.length = 0;
  log.chats.length = 0;
  log.uploads.length = 0;
  log.push.length = 0;
  chatSeq = 0;
  pushSubscribed = false;
  broadcastRoster();
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);
  const seg = url.pathname.split('/').filter(Boolean);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-credentials': 'true',
      'access-control-allow-headers': 'content-type',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
    });
    return res.end();
  }

  // ── control plane ──────────────────────────────────────────────
  if (seg[0] === '__mock') {
    if (req.method === 'POST' && seg[1] === 'reset') {
      resetState();
      return sendJson(res, 200, { ok: true });
    }
    if (req.method === 'POST' && seg[1] === 'state') {
      const body = await readBody(req);
      if (body.roster) {
        roster = { ...roster, ...body.roster, updatedAt: Date.now() };
        broadcastRoster();
      }
      if (body.agentStatus) {
        for (const [paneId, status] of Object.entries(body.agentStatus)) {
          setAgentStatus(paneId, status);
        }
      }
      if (body.blocked) {
        for (const [paneId, ctx] of Object.entries(body.blocked)) blocked[paneId] = ctx;
      }
      if (body.screens) {
        for (const [paneId, text] of Object.entries(body.screens)) screens[paneId] = text;
      }
      if (body.appendEvents) {
        for (const [paneId, evs] of Object.entries(body.appendEvents)) {
          appendEvents(paneId, evs);
        }
      }
      if (body.herdrDown != null) {
        roster.herdrDown = body.herdrDown;
        roster.updatedAt = Date.now();
        broadcastRoster();
      }
      if (body.disconnectRoster) {
        for (const c of [...rosterClients]) {
          try {
            c.end();
          } catch {
            /* */
          }
        }
        rosterClients.clear();
      }
      return sendJson(res, 200, { ok: true });
    }
    if (req.method === 'GET' && seg[1] === 'log') {
      return sendJson(res, 200, log);
    }
    return sendJson(res, 404, { error: 'unknown mock control' });
  }

  if (seg[0] !== 'api') {
    return sendJson(res, 404, { error: 'mock serves /api and /__mock only' });
  }

  if (!checkAuth(req, res, url)) return;

  // roster
  if (req.method === 'GET' && seg[1] === 'roster' && !seg[2]) {
    return sendJson(res, 200, roster);
  }
  if (req.method === 'GET' && seg[1] === 'roster' && seg[2] === 'stream') {
    startSse(res);
    rosterClients.add(res);
    res.write(`event: roster\ndata: ${JSON.stringify(roster)}\n\n`);
    res.on('close', () => rosterClients.delete(res));
    return;
  }

  if (req.method === 'GET' && seg[1] === 'kinds') return sendJson(res, 200, kinds);
  if (req.method === 'GET' && seg[1] === 'projects') return sendJson(res, 200, projects);
  if (req.method === 'GET' && seg[1] === 'worktrees') return sendJson(res, 200, worktrees);

  if (req.method === 'POST' && seg[1] === 'chats') {
    const body = await readBody(req);
    log.chats.push(body);
    chatSeq += 1;
    const paneId = `w-new:p${chatSeq}`;
    const agent = {
      paneId,
      workspaceId: body.workspaceId || `w-new`,
      tabId: `w-new:t1`,
      agent: body.kind,
      displayAgent: body.kind === 'claude' ? 'Claude Code' : body.kind,
      label: body.label || body.name || null,
      title: body.name || body.label || 'new',
      status: 'unknown',
      cwd: body.cwd || body.worktree?.path || '/tmp',
      repoRoot: null,
      focused: false,
      launchPending: true,
      stateLabels: {},
      revision: 0,
      hasTranscript: false,
      sessionId: null,
    };
    roster.agents.push(agent);
    roster.updatedAt = Date.now();
    transcripts[paneId] = [];
    screens[paneId] = 'new session\n';
    blocked[paneId] = { kind: 'none' };
    broadcastRoster();
    return sendJson(res, 200, { paneId });
  }

  if (req.method === 'POST' && seg[1] === 'upload') {
    const body = await readBody(req);
    const pathOut = `/tmp/herdr-upload-${Date.now()}.png`;
    log.uploads.push({ type: body.type || req.headers['content-type'], path: pathOut });
    return sendJson(res, 200, { path: pathOut });
  }

  if (req.method === 'GET' && seg[1] === 'file' && seg[2] === 'raw') {
    res.writeHead(200, { 'content-type': 'image/png', 'access-control-allow-origin': '*' });
    // 1x1 png
    res.end(
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64',
      ),
    );
    return;
  }

  if (req.method === 'GET' && seg[1] === 'file' && !seg[2]) {
    const p = url.searchParams.get('path') || '';
    if (p.endsWith('README.md') || p.includes('README')) {
      return sendJson(res, 200, { ...fileReadme, path: p || fileReadme.path });
    }
    if (p.endsWith('/') || !path.extname(p)) {
      return sendJson(res, 200, {
        path: p || '/home/armen/src/app',
        size: 0,
        mtime: Date.now(),
        kind: 'dir',
        entries: [
          { name: 'README.md', dir: false },
          { name: 'src', dir: true },
        ],
      });
    }
    return sendJson(res, 200, {
      path: p,
      size: 20,
      mtime: Date.now(),
      kind: 'text',
      content: `// mock file ${p}\n`,
      truncated: false,
    });
  }

  // push
  if (seg[1] === 'push') {
    if (req.method === 'GET' && seg[2] === 'pubkey') {
      return sendJson(res, 200, { key: Buffer.alloc(65, 1).toString('base64url') });
    }
    if (req.method === 'POST' && seg[2] === 'subscribe') {
      const body = await readBody(req);
      log.push.push({ op: 'subscribe', body });
      pushSubscribed = true;
      return sendJson(res, 200, { ok: true });
    }
    if (req.method === 'POST' && seg[2] === 'unsubscribe') {
      const body = await readBody(req);
      log.push.push({ op: 'unsubscribe', body });
      pushSubscribed = false;
      return sendJson(res, 200, { ok: true });
    }
    if (req.method === 'POST' && seg[2] === 'test') {
      log.push.push({ op: 'test' });
      return sendJson(res, 200, { ok: true, subscribed: pushSubscribed });
    }
  }

  // agent/*
  if (seg[1] === 'agent' && seg[2]) {
    const paneId = decodeURIComponent(seg[2]);
    const action = seg[3];

    if (req.method === 'GET' && action === 'transcript') {
      const events = transcripts[paneId] ?? [];
      return sendJson(res, 200, {
        events,
        offset: events.length,
        pending: events.length === 0,
        sessionId: events.length ? `sess-${paneId}` : null,
      });
    }

    if (req.method === 'GET' && action === 'stream') {
      startSse(res);
      if (!agentClients.has(paneId)) agentClients.set(paneId, new Set());
      agentClients.get(paneId).add(res);
      res.on('close', () => agentClients.get(paneId)?.delete(res));
      return;
    }

    if (req.method === 'GET' && action === 'screen') {
      return sendJson(res, 200, { text: screens[paneId] ?? '' });
    }

    if (req.method === 'GET' && action === 'blocked-context') {
      return sendJson(res, 200, blocked[paneId] ?? { kind: 'none' });
    }

    if (req.method === 'POST' && action === 'prompt') {
      const body = await readBody(req);
      log.prompts.push({ paneId, ...body });
      const text = body.text ?? '';
      // slash commands: don't auto-complete; leave working so mirror tests can run
      if (text.trim().startsWith('/')) {
        setAgentStatus(paneId, 'working');
        // land command event after a short delay so dialog arm can observe
        setTimeout(() => {
          appendEvents(paneId, [
            { kind: 'command', name: text.trim().split(/\s+/)[0], text: text.trim().slice(text.trim().split(/\s+/)[0].length).trim() },
          ]);
          setAgentStatus(paneId, 'idle');
        }, 1500);
        return sendJson(res, 200, { ok: true });
      }
      setAgentStatus(paneId, 'working');
      // confirm as session-file user event shortly after
      setTimeout(() => {
        appendEvents(paneId, [
          { kind: 'user', text, ts: new Date().toISOString(), msgId: `u-${Date.now()}` },
        ]);
      }, 50);
      setTimeout(() => {
        appendEvents(paneId, [
          {
            kind: 'assistant',
            text: `mock reply to: ${text.slice(0, 80)}`,
            ts: new Date().toISOString(),
            msgId: `a-${Date.now()}`,
            usage: { out: 10, ctx: 1000 },
          },
        ]);
        setAgentStatus(paneId, 'idle');
      }, 200);
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'POST' && action === 'answer') {
      const body = await readBody(req);
      log.answers.push({ paneId, ...body });
      if (body.expect && !(screens[paneId] ?? '').includes(body.expect)) {
        return sendJson(res, 409, { error: 'screen changed', screen: screens[paneId] });
      }
      blocked[paneId] = { kind: 'none' };
      setAgentStatus(paneId, 'working');
      setTimeout(() => setAgentStatus(paneId, 'idle'), 100);
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'POST' && action === 'keys') {
      const body = await readBody(req);
      log.keys.push({ paneId, ...body });
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'POST' && action === 'interrupt') {
      log.prompts.push({ paneId, interrupt: true });
      const salvage = screens[paneId] ?? '';
      setAgentStatus(paneId, 'idle');
      return sendJson(res, 200, { ok: true, salvage });
    }

    return sendJson(res, 404, { error: `unknown agent action ${action}` });
  }

  sendJson(res, 404, { error: `no route ${url.pathname}` });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`herdr e2e mock on http://127.0.0.1:${PORT}${TOKEN ? ' (token auth on)' : ''}`);
});
