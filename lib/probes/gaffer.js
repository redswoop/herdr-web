// gaffer: the work board. Jobs a session kicked off (renders, bakes, digests)
// outlive the session; this is how they stay on the page. Polls /api/status
// and rides gaffer's own SSE so a change lands here within a second.
// Config: { url, tokenFile } — both default to ~/.config/gaffer/{config.toml,token}.
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fetchJson, fmtDur, untilde } from '../signals.js';
import { meaningOf } from '../meaning.js';
const run = promisify(execFile);

let conf = null;
async function gafferConf(cfg) {
  if (conf) return conf;
  let url = cfg.url ?? null;
  if (!url) {
    try {
      const toml = await fsp.readFile(path.join(os.homedir(), '.config', 'gaffer', 'config.toml'), 'utf8');
      url = (toml.match(/^\s*controller\s*=\s*"([^"]+)"/m) ?? [])[1] ?? null;
    } catch {}
  }
  let token = cfg.token ?? null;
  if (!token) {
    try { token = (await fsp.readFile(untilde(cfg.tokenFile ?? '~/.config/gaffer/token'), 'utf8')).trim(); } catch {}
  }
  conf = { url: url?.replace(/\/$/, '') ?? null, token };
  return conf;
}
const headers = (c) => (c.token ? { authorization: `Bearer ${c.token}` } : {});

const ACTIVE = new Set(['queued', 'running', 'yielded', 'paused', 'stopping', 'needs-you', 'held']);

function stateOf(it) {
  if (it.state === 'needs-you') return 'needs-you';
  if (it.state === 'failed') return it.acked ? 'ok' : 'alarm';
  if (it.state === 'running') return it.stalled ? 'warn' : 'busy';
  if (it.state === 'done') return 'ok';
  if (it.state === 'canceled') return 'idle';
  return 'idle'; // queued, yielded, paused, held
}
function actionsOf(it) {
  return [...verbsOf(it), ...(it.started ? ['log'] : [])];
}
function verbsOf(it) {
  switch (it.state) {
    case 'needs-you': return ['ack'];
    case 'failed': return it.acked ? [] : ['retry', 'ack'];
    case 'running': return ['pause', 'cancel'];
    case 'paused': case 'yielded': case 'held': return ['resume', 'cancel'];
    case 'queued': return ['top', 'cancel'];
    default: return [];
  }
}

/** what each verb does — shown to the human before they press it */
const VERB_HELP = {
  ack: 'clears it from the board; the log and record stay',
  retry: 'runs it again, same spec and host',
  pause: 'stops it after the current step; resume continues',
  resume: 'continues from where it paused',
  cancel: 'stops it for good',
  top: 'moves it to the front of the queue',
  log: 'the last 8 KB of its output',
};

// once per failure: what the log says went wrong, and how far the repo has
// moved since. Both are facts about a finished thing, so they cache by id+finished.
const facts = new Map(); // id -> { finished, meaning, commitsSince, at }
async function failureFacts(c, it) {
  const hit = facts.get(it.id);
  if (hit && hit.finished === it.finished && Date.now() - hit.at < 5 * 60_000) return hit;
  const f = { finished: it.finished, meaning: hit?.meaning ?? null, commitsSince: null, at: Date.now() };
  if (!f.meaning) {
    try { f.meaning = meaningOf((await logTail(c, it.id, 6144)).text, it.reason).text; } catch { f.meaning = meaningOf('', it.reason).text; }
  }
  if (it.spec?.cwd && it.finished) {
    try {
      const { stdout } = await run('git', ['-C', it.spec.cwd, 'rev-list', '--count', 'HEAD', `--since=@${Math.floor(it.finished / 1000)}`], { timeout: 3000 });
      f.commitsSince = Number(stdout.trim()) || 0;
    } catch {}
  }
  facts.set(it.id, f);
  if (facts.size > 200) for (const k of [...facts.keys()].slice(0, 50)) facts.delete(k);
  return f;
}

let es = { ac: null, timer: null };
async function follow(url, token, kick, log) {
  // gaffer's /api/stream is "event: change" whenever anything moved
  es.ac = new AbortController();
  try {
    const r = await fetch(`${url}/api/stream`, { headers: { authorization: `Bearer ${token}` }, signal: es.ac.signal });
    if (!r.ok || !r.body) throw new Error(`stream ${r.status}`);
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (dec.decode(value, { stream: true }).includes('event: change')) kick();
    }
  } catch (e) {
    if (es.ac?.signal.aborted) return;
    log.warn(`signals: gaffer stream: ${e.message}`);
  }
  if (es.ac?.signal.aborted) return;
  es.timer = setTimeout(() => follow(url, token, kick, log), 5000);
}

/** the last `bytes` of a job's log: { text, size, offset } (gaffer serves from an offset) */
async function logTail(c, id, bytes = 8192) {
  const head = await fetch(`${c.url}/api/items/${id}/log?offset=999999999999`, { headers: headers(c) });
  const size = Number(head.headers.get('x-log-size') ?? 0);
  const offset = Math.max(0, size - bytes);
  const r = await fetch(`${c.url}/api/items/${id}/log?offset=${offset}`, { headers: headers(c) });
  let text = await r.text();
  if (offset > 0) text = text.slice(text.indexOf('\n') + 1); // start on a whole line
  return { text, size, offset };
}

export default {
  id: 'gaffer',
  title: 'gaffer',
  every: 10_000,
  async start(ctx, kick) {
    const c = await gafferConf(ctx.config);
    if (c.url && c.token) follow(c.url, c.token, kick, ctx.log);
  },
  stop() {
    es.ac?.abort();
    if (es.timer) clearTimeout(es.timer);
  },
  async run(ctx) {
    const c = await gafferConf(ctx.config);
    if (!c.url) return [];
    const st = await fetchJson(`${c.url}/api/status`, { headers: headers(c), timeoutMs: 4000 });
    const now = st.now ?? Date.now();
    const out = [];
    const items = st.items ?? [];
    const active = items.filter((it) => ACTIVE.has(it.state) || (it.state === 'failed' && !it.acked));
    for (const it of active) {
      const p = it.progress;
      const pct = p?.total ? Math.min(100, Math.round((p.done / p.total) * 100)) : null;
      const bits = [];
      if (p?.phase) bits.push(p.phase);
      if (p?.msg) bits.push(p.msg);
      if (it.state === 'running' && (it.eta || p?.eta)) bits.push(`~${fmtDur(it.eta || p.eta)} left`);
      if (it.state === 'yielded') bits.push(`yielded to ${it.yield_to ?? '?'}`);
      if (it.state === 'failed') bits.push(it.reason ?? 'failed');
      if (it.state === 'needs-you') bits.push(it.attention === 'review' ? 'wants review' : it.reason ?? 'needs you');
      if (it.state === 'queued') bits.push(`queued${it.spec?.needs ? ` for ${it.spec.needs}` : ''}`);
      if (it.stalled) bits.push('stalled');
      const ff = it.state === 'failed' ? await failureFacts(c, it) : null;
      out.push({
        meaning: ff?.meaning ?? (it.state === 'needs-you' ? (it.attention === 'review' ? 'finished; wants you to look at the result' : it.reason ?? null) : null),
        commitsSince: ff?.commitsSince ?? null,
        actionHelp: VERB_HELP,
        key: `gaffer:item:${it.id}`,
        kind: 'job',
        title: it.title,
        sub: `#${it.id} ${it.kind}`,
        host: it.host ?? '',
        state: stateOf(it),
        jobState: it.state,
        needs: it.spec?.needs ?? 'cpu',
        done: p?.done ?? null,
        total: p?.total ?? null,
        unit: p?.unit ?? null,
        pct,
        value: pct,
        eta: it.eta || p?.eta || null,
        rate: it.rate ?? null,
        startedAt: it.started || null,
        finishedAt: it.finished || null,
        runMs: it.run_ms ?? (it.started && it.finished ? it.finished - it.started : null),
        detail: bits.join(' · '),
        attach: it.spec?.cwd ? { cwd: it.spec.cwd } : undefined,
        actions: actionsOf(it),
      });
    }
    // what finished lately — the "oh right, that ran" glance
    const done = items
      .filter((it) => (it.state === 'done' || (it.state === 'failed' && it.acked)) && it.finished && now - it.finished < 24 * 3600_000)
      .sort((a, b) => b.finished - a.finished)
      .slice(0, 8);
    const needs = active.filter((it) => it.state === 'needs-you').length;
    const failed = active.filter((it) => it.state === 'failed').length;
    const running = active.filter((it) => it.state === 'running').length;
    const queued = active.filter((it) => it.state === 'queued' || it.state === 'yielded').length;
    const summary = [];
    if (needs) summary.push(`${needs} need${needs === 1 ? 's' : ''} you`);
    if (failed) summary.push(`${failed} failed`);
    if (running) summary.push(`${running} running`);
    if (queued) summary.push(`${queued} waiting`);
    summary.push(`${done.length} done today`);
    out.push({
      key: 'gaffer:board',
      kind: 'list',
      title: 'board',
      state: needs ? 'needs-you' : failed ? 'alarm' : running ? 'busy' : 'idle',
      detail: summary.join(' · '),
      items: done.map((it) => ({
        id: String(it.id),
        label: it.title,
        sub: `#${it.id} ${it.kind} · ${it.host} · ${fmtDur((now - it.finished) / 1000)} ago`,
        state: it.state === 'failed' ? 'warn' : 'ok',
      })),
    });
    for (const h of st.hosts ?? []) {
      const gpu = h.resources?.gpu;
      const holders = gpu?.holders ?? [];
      const pct = gpu?.total ? Math.round((gpu.used / gpu.total) * 100) : null;
      out.push({
        key: `gaffer:host:${h.host}`,
        kind: 'gauge',
        title: h.host,
        host: h.host,
        state: !h.online ? 'down' : h.held ? 'warn' : 'ok',
        value: pct,
        unit: '%',
        pct,
        mem: gpu ? { used: gpu.used, total: gpu.total } : null,
        detail: !h.online
          ? `offline · last seen ${fmtDur((now - h.seen) / 1000)} ago`
          : `${h.held ? 'held · ' : ''}cpu ${h.used?.cpu ?? 0}/${h.slots?.cpu ?? '?'} gpu ${h.used?.gpu ?? 0}/${h.slots?.gpu ?? '?'}${gpu ? ` · ${(gpu.used / 1024).toFixed(1)}/${(gpu.total / 1024).toFixed(0)} GB` : ''}${holders.length ? ` · ${holders.slice(0, 2).join(', ')}` : ''}`,
        items: holders.map((s, i) => ({ id: String(i), label: s, state: 'ok' })),
        self: h.host === ctx.hostname,
      });
    }
    return out;
  },
  async act(ctx, sig, action) {
    const c = await gafferConf(ctx.config);
    const id = sig.key.split(':')[2];
    if (action === 'log') return logTail(c, id);
    return fetchJson(`${c.url}/api/items/${id}/${action}`, { method: 'POST', headers: { ...headers(c), 'content-type': 'application/json' }, body: '{}' });
  },
};
