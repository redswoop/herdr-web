// herdr-web daemon: phone-first web UI over herdr agent sessions.
// Zero deps, node >= 22.  Usage: node server.js [--port 7683] [--host 0.0.0.0]
import http from 'node:http';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rpc, subscribe } from './lib/herdr.js';
import { adapterFor, readEvents } from './lib/adapters.js';
import { PushStore, Coordinator } from './lib/notify.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const args = process.argv.slice(2);
const argOf = (name, dflt) => {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : dflt;
};
const PORT = Number(argOf('--port', process.env.PORT ?? 7683));
const HOST = argOf('--host', '0.0.0.0');
const TOKEN = process.env.HERDR_WEB_TOKEN ?? null;

// Build stamp: hash of the code THIS process loaded (public/ is read from disk
// per-request, so only server-side files count). Shown in the UI header.
import { createHash, timingSafeEqual } from 'node:crypto';

// constant-time compare; hashing first sidesteps the equal-length requirement
function tokenEq(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const h = (s) => createHash('sha256').update(s).digest();
  return timingSafeEqual(h(a), h(b));
}
const BUILD = await (async () => {
  const h = createHash('sha1');
  const files = ['server.js', ...(await fsp.readdir(path.join(ROOT, 'lib'))).sort().map((f) => `lib/${f}`)];
  for (const f of files) h.update(await fsp.readFile(path.join(ROOT, f)));
  return h.digest('hex').slice(0, 7);
})();
const BOOTED_AT = new Date().toISOString();

// ---------- push ----------
// (before the roster section: refreshRoster feeds the coordinator and runs at
// startup. blockedContext is declared below — function declarations hoist.)

const pushStore = await new PushStore().init();
const coordinator = new Coordinator(
  pushStore,
  (paneId) => blockedContext(paneId),
  Number(argOf('--notify-delay', 20_000)),
);

// ---------- roster ----------

let roster = { agents: [], herdrDown: false, updatedAt: 0 };
const rosterClients = new Set(); // SSE responses

// Coalesce concurrent callers (interval + event debounce) — overlapping runs
// could double-fire coordinator.onTransition for the same status change.
let refreshInFlight = null;
function refreshRoster() {
  refreshInFlight ??= doRefreshRoster().finally(() => { refreshInFlight = null; });
  return refreshInFlight;
}

async function doRefreshRoster() {
  try {
    const res = await rpc('agent.list');
    const agents = await Promise.all((res.agents ?? []).map(async (a) => {
      const adapter = adapterFor(a.agent);
      let session = null;
      if (adapter && a.cwd) {
        try { session = await adapter.find(a.cwd, { title: a.terminal_title_stripped ?? '' }); } catch {}
      }
      return {
        paneId: a.pane_id,
        workspaceId: a.workspace_id,
        agent: a.agent,
        title: a.terminal_title_stripped ?? a.terminal_title ?? '',
        status: a.agent_status,
        cwd: a.cwd,
        revision: a.revision,
        hasTranscript: !!session,
        sessionId: session?.sessionId ?? null,
      };
    }));
    // status-transition detection for push (herdr-down blips must not read as
    // "everything resolved", so removals are only derived from a good refresh)
    if (!roster.herdrDown) {
      const prev = new Map(roster.agents.map((a) => [a.paneId, a.status]));
      for (const a of agents) {
        if (prev.get(a.paneId) !== a.status) coordinator.onTransition(a, a.status);
        prev.delete(a.paneId);
      }
      for (const paneId of prev.keys()) coordinator.onRemove(paneId);
    }
    roster = { agents, herdrDown: false, updatedAt: Date.now(), build: BUILD, bootedAt: BOOTED_AT };
  } catch (e) {
    roster = { agents: [], herdrDown: true, error: String(e.message ?? e), updatedAt: Date.now(), build: BUILD, bootedAt: BOOTED_AT };
  }
  const payload = `event: roster\ndata: ${JSON.stringify(roster)}\n\n`;
  for (const res of rosterClients) res.write(payload);
}

let refreshTimer = null;
function scheduleRefresh() { // debounce bursts of herdr events
  if (refreshTimer) return;
  refreshTimer = setTimeout(() => { refreshTimer = null; refreshRoster(); }, 250);
}

function watchHerdr() {
  subscribe(
    [{ type: 'pane.created' }, { type: 'pane.closed' }, { type: 'pane.updated' },
     { type: 'pane.exited' }, { type: 'pane.agent_detected' }],
    () => scheduleRefresh(),
    () => setTimeout(watchHerdr, 2000),
  );
}
watchHerdr();
setInterval(refreshRoster, 5000); // belt & suspenders under the event stream
refreshRoster();

// ---------- transcript resolution ----------

async function resolveAgent(paneId) {
  const a = roster.agents.find((x) => x.paneId === paneId);
  if (!a) throw httpErr(404, `no agent in pane ${paneId}`);
  const adapter = adapterFor(a.agent);
  if (!adapter) throw httpErr(422, `no adapter for agent "${a.agent}"`);
  const session = a.cwd ? await adapter.find(a.cwd, { title: a.title }) : null;
  if (!session) throw httpErr(404, `no session file found for ${a.agent} in ${a.cwd}`);
  return { agent: a, adapter, session };
}

async function readScreen(paneId) {
  const r = await rpc('agent.read', { target: paneId, source: 'visible', format: 'text' });
  return r.read?.text ?? '';
}

// Walk the transcript backwards looking for a tool_use with no result.
function classifyBlocked(events) {
  const resultIds = new Set();
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const e = events[i];
    if (e.kind === 'tool_result') {
      if (e.id) resultIds.add(e.id);
      continue;
    }
    if (e.kind === 'tool_use') {
      if (e.id && resultIds.has(e.id)) return { kind: 'unknown' }; // last tool finished
      // claude: AskUserQuestion; grok: ask_user_question — same input shape
      const bare = (e.name ?? '').toLowerCase().replace(/[^a-z]/g, '');
      if (bare === 'askuserquestion' && Array.isArray(e.input?.questions)) {
        return { kind: 'ask', questions: e.input.questions };
      }
      return { kind: 'permission', tool: e.name ?? 'tool', detail: e.text ?? '' };
    }
    if (e.kind === 'assistant' || e.kind === 'user') return { kind: 'unknown' };
  }
  return { kind: 'unknown' };
}

// Parse a numbered TUI menu (claude AskUserQuestion / permission prompts,
// and anything else shaped like "❯ 1. Label" with indented descriptions).
function parseMenuScreen(text) {
  const lines = text.split('\n');
  const optRe = /^\s*(❯)?\s*(\d+)\.\s+(.+)$/;
  const opts = [];
  let firstIdx = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(optRe);
    if (m) {
      opts.push({ n: +m[2], label: m[3].trim(), description: '', selected: !!m[1] });
      if (firstIdx < 0) firstIdx = i;
    } else if (opts.length && /^\s{3,}\S/.test(lines[i]) && !/^[─═╌\s]+$/.test(lines[i])) {
      const o = opts[opts.length - 1];
      o.description += (o.description ? ' ' : '') + lines[i].trim();
    }
  }
  if (opts.length < 2 || opts[0].n !== 1) return null;
  for (let i = 1; i < opts.length; i += 1) {
    if (opts[i].n !== opts[i - 1].n + 1) return null; // not a real menu
  }
  // real menus have a ❯ cursor; numbered lists in prose don't
  if (!opts.some((o) => o.selected)) return null;
  let question = '';
  let header = '';
  let qIdx = -1;
  for (let i = firstIdx - 1; i >= 0; i -= 1) {
    const t = lines[i].trim();
    if (!t || /^[─═│╭╮╰╯╌|]+$/.test(t)) continue;
    const cb = t.match(/^[☐☒✔✓■□]\s*(.*)$/);
    if (cb) { header = cb[1]; continue; }
    question = t;
    qIdx = i;
    break;
  }
  // context above the question (e.g. the command a permission prompt is
  // about) up to the enclosing border
  const detail = [];
  for (let i = qIdx - 1; i >= 0 && qIdx > 0 && detail.length < 12; i -= 1) {
    const t = lines[i].trim();
    if (!t) continue; // menus space their sections with blank lines
    if (/^[─═│╭╮╰╯╌|]+$/.test(t)) break; // enclosing border = top of menu
    detail.unshift(t);
  }
  return { kind: 'menu', header, question, detail: detail.join('\n'), options: opts };
}

// Trim a raw pane capture down to the content worth salvaging: cut the
// composer/status chrome off the bottom and, when the stopped prompt's echo
// is findable, everything above it. Chrome patterns cover claude code
// (rules + ❯ + ⏵⏵ status, ✻ spinner) and grok (╭│╰ box + help line).
const CHROME_RES = [
  /^\s*$/,
  /^\s*[╭╰]─/, // box top/bottom
  /^\s*─{5,}\s*$/, // horizontal rule
  /^\s*│.*│\s*$/, // boxed input/status line
  /^\s*❯/, // bare input line
  /^\s*⏵/, // claude status line
  /^\s*[✻✳✶✢✽]\s/, // spinner / "Cogitated for 1m 6s"
  /esc to interrupt/,
  /shift\+tab/i,
  /shortcuts/i,
];
function trimSalvage(text, promptText) {
  const lines = text.split('\n');
  let end = lines.length;
  while (end > 0 && CHROME_RES.some((re) => re.test(lines[end - 1]))) end -= 1;
  let start = 0;
  const firstLine = (promptText ?? '').split('\n')[0].trim().slice(0, 40);
  if (firstLine) {
    for (let i = end - 1; i >= 0; i -= 1) {
      const m = lines[i].trim();
      if ((m.startsWith('>') || m.startsWith('❯')) && m.slice(1).trim().startsWith(firstLine)) {
        start = i + 1;
        break;
      }
    }
  }
  const out = lines
    .slice(start, end)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return out ? out.slice(-8000) : null;
}

// What is the agent blocked ON? Session file first (pending tool_use), then
// the visible screen parsed for a numbered menu. Shared by the API route and
// the push coordinator (the notification body carries the question).
async function blockedContext(paneId) {
  const { adapter, session } = await resolveAgent(paneId);
  // live status, not the roster cache — the cache can lag the event
  const live = await rpc('agent.get', { target: paneId });
  if (live.agent?.agent_status !== 'blocked') return { kind: 'none' };
  const { events } = await readEvents(adapter, session.file, 0);
  let ctx = classifyBlocked(events);
  if (ctx.kind === 'unknown') {
    const screen = await readScreen(paneId);
    ctx = parseMenuScreen(screen) ?? { kind: 'unknown' };
  } else if (ctx.kind === 'permission') {
    // permission prompts aren't uniform (Yes/No vs Yes/Yes-always/No…) — read
    // the real options off the screen so an answer can't hit the wrong number;
    // when nothing parses, callers must not guess digits
    try {
      const menu = parseMenuScreen(await readScreen(paneId));
      if (menu) ctx.options = menu.options;
    } catch {}
  }
  return ctx;
}


// ---------- http ----------

function httpErr(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(body);
}

async function readBody(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 1_000_000) throw httpErr(413, 'body too large');
  }
  return body ? JSON.parse(body) : {};
}

function startSse(res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-store',
    'x-accel-buffering': 'no',
  });
  res.write('retry: 2000\n\n');
  const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
  res.on('close', () => clearInterval(ping));
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};

function checkAuth(req, res, url) {
  if (!TOKEN) return true;
  const qtok = url.searchParams.get('token');
  const cookie = (req.headers.cookie ?? '').split(/;\s*/).find((c) => c.startsWith('hw_token='));
  if (tokenEq(qtok, TOKEN)) {
    res.setHeader('set-cookie', `hw_token=${TOKEN}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000`);
    return true;
  }
  if (tokenEq(cookie?.slice('hw_token='.length), TOKEN)) return true;
  sendJson(res, 401, { error: 'missing/bad token — open /?token=...' });
  return false;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (!checkAuth(req, res, url)) return;
    const seg = url.pathname.split('/').filter(Boolean); // ['api','agent','w1:p1','stream']

    if (seg[0] !== 'api') return await serveStatic(url.pathname, res);

    if (req.method === 'GET' && seg[1] === 'roster' && !seg[2]) {
      return sendJson(res, 200, roster);
    }
    if (req.method === 'GET' && seg[1] === 'roster' && seg[2] === 'stream') {
      startSse(res);
      res.write(`event: roster\ndata: ${JSON.stringify(roster)}\n\n`);
      rosterClients.add(res);
      res.on('close', () => rosterClients.delete(res));
      return;
    }

    if (seg[1] === 'push') {
      if (req.method === 'GET' && seg[2] === 'pubkey') {
        return sendJson(res, 200, { key: pushStore.vapid.publicKey });
      }
      if (req.method === 'POST' && seg[2] === 'subscribe') {
        const { subscription } = await readBody(req);
        if (!subscription?.endpoint || !subscription?.keys?.p256dh) {
          throw httpErr(400, 'subscription required');
        }
        await pushStore.add(subscription);
        return sendJson(res, 200, { ok: true, devices: pushStore.subs.size });
      }
      if (req.method === 'POST' && seg[2] === 'unsubscribe') {
        const { endpoint } = await readBody(req);
        if (!endpoint) throw httpErr(400, 'endpoint required');
        await pushStore.remove(endpoint);
        return sendJson(res, 200, { ok: true, devices: pushStore.subs.size });
      }
      if (req.method === 'POST' && seg[2] === 'test') {
        const when = new Date().toLocaleTimeString();
        const results = await pushStore.broadcast({
          type: 'test',
          force: true,
          title: 'herdr-web test',
          body: `push ok 🐑 ${when}`,
          tag: 'test',
          renotify: true,
        }, { topic: `test-${Date.now()}`, ttl: 300 });
        return sendJson(res, 200, { ok: true, devices: pushStore.subs.size, results });
      }
    }

    if (seg[1] === 'agent' && seg[2]) {
      const paneId = decodeURIComponent(seg[2]);
      const action = seg[3];

      if (req.method === 'GET' && action === 'transcript') {
        const { adapter, session } = await resolveAgent(paneId);
        const { events, offset } = await readEvents(adapter, session.file, 0);
        return sendJson(res, 200, { events, offset, file: session.file, sessionId: session.sessionId });
      }

      if (req.method === 'GET' && action === 'stream') {
        const { agent, adapter, session } = await resolveAgent(paneId);
        let offset = Number(url.searchParams.get('offset') ?? 0);
        let lastStatus = agent.status;
        let ticks = 0;
        startSse(res);
        const tick = async () => {
          // A fresh agent's session file may not exist (or not win
          // correlation) until it has content — re-resolve periodically and
          // tell the client to reload if the binding changed.
          if (ticks++ % 5 === 4) {
            const now = await resolveAgent(paneId).catch(() => null);
            if (now && now.session.file !== session.file) {
              res.write('event: reset\ndata: {}\n\n');
              return;
            }
          }
          const r = await readEvents(adapter, session.file, offset);
          if (r.events.length) {
            offset = r.offset;
            res.write(`event: events\ndata: ${JSON.stringify(r.events)}\n\n`);
          } else {
            offset = r.offset;
          }
          const cur = roster.agents.find((x) => x.paneId === paneId);
          if (cur && cur.status !== lastStatus) {
            lastStatus = cur.status;
            res.write(`event: status\ndata: ${JSON.stringify({ status: cur.status })}\n\n`);
          }
        };
        const timer = setInterval(() => tick().catch(() => {}), 700);
        res.on('close', () => clearInterval(timer));
        return;
      }

      if (req.method === 'GET' && action === 'screen') {
        return sendJson(res, 200, { text: await readScreen(paneId) });
      }

      if (req.method === 'GET' && action === 'blocked-context') {
        return sendJson(res, 200, await blockedContext(paneId));
      }

      // Answer a menu with keystrokes, but only after verifying the screen
      // still shows what the client thinks it's answering.
      if (req.method === 'POST' && action === 'answer') {
        const { keys, expect } = await readBody(req);
        if (!Array.isArray(keys) || !keys.length) throw httpErr(400, 'keys: string[]');
        if (expect) {
          const screen = await readScreen(paneId);
          if (!screen.includes(expect)) {
            return sendJson(res, 409, { error: 'screen changed', screen });
          }
        }
        await rpc('agent.send_keys', { target: paneId, keys });
        return sendJson(res, 200, { ok: true });
      }

      if (req.method === 'POST' && action === 'prompt') {
        const { text } = await readBody(req);
        if (!text?.trim()) throw httpErr(400, 'empty prompt');
        await rpc('agent.prompt', { target: paneId, text });
        return sendJson(res, 200, { ok: true });
      }

      // Interrupt the turn, photographing the pane first: claude never
      // persists the in-flight message to the session file on abort, so the
      // screen is the only place that text exists. Capture is best-effort —
      // the Esc goes regardless.
      if (req.method === 'POST' && action === 'interrupt') {
        const { prompt } = await readBody(req);
        let salvage = null;
        try {
          const r = await rpc('agent.read', {
            target: paneId, source: 'recent_unwrapped', lines: 400, format: 'text',
          });
          salvage = trimSalvage(r.read?.text ?? '', prompt);
        } catch {}
        await rpc('agent.send_keys', { target: paneId, keys: ['Escape'] });
        // Esc-time on this machine's clock — the same clock that stamps the
        // session file, so the client can sort the cut marker among events
        return sendJson(res, 200, { ok: true, salvage, at: Date.now() });
      }

      if (req.method === 'POST' && action === 'keys') {
        const { keys } = await readBody(req);
        if (!Array.isArray(keys) || !keys.length) throw httpErr(400, 'keys: string[]');
        await rpc('agent.send_keys', { target: paneId, keys });
        return sendJson(res, 200, { ok: true });
      }
    }

    throw httpErr(404, 'not found');
  } catch (e) {
    if (!res.headersSent) sendJson(res, e.status ?? 500, { error: String(e.message ?? e) });
    else res.end();
  }
});

async function serveStatic(pathname, res) {
  let rel = pathname === '/' ? 'index.html' : pathname.slice(1);
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep)) return sendJson(res, 404, { error: 'not found' });
  try {
    const body = await fsp.readFile(file);
    res.writeHead(200, {
      'content-type': MIME[path.extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    res.end(body);
  } catch {
    sendJson(res, 404, { error: 'not found' });
  }
}

server.listen(PORT, HOST, () => {
  console.log(`herdr-web listening on http://${HOST}:${PORT}${TOKEN ? ' (token auth on)' : ''}`);
});
