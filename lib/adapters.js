// Per-agent session-file adapters. Each adapter maps a herdr agent
// (agent name + cwd) to a transcript file on disk and translates its
// jsonl lines into normalized events:
//   { kind: 'user'|'assistant'|'thought'|'tool_use'|'tool_result'|'note'
//         |'command'|'command_out'|'usage',
//     text, name?, ts?, id?, input?, msgId?, usage? }
// 'usage' is a zero-render event: per-turn token accounting the client folds
// into the turn footer (claude ships usage inline on message events; grok
// ships it once per turn).
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const HOME = os.homedir();

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

// ---------- grok ----------
// ~/.grok/sessions/<encodeURIComponent(cwd)>/<session_id>/ holds several
// jsonl files. We read updates.jsonl — an ACP session/update stream written
// LIVE during the turn (chat_history.jsonl lacks timestamps and usage) — and
// fall back to chat_history.jsonl for sessions from older grok versions.
// ~/.grok/active_sessions.json maps session_id -> {pid, cwd, opened_at}.

const grokDir = (cwd) => path.join(HOME, '.grok', 'sessions', encodeURIComponent(cwd));

// Pick the transcript file for a session dir: updates.jsonl when it has
// content (current grok), else chat_history.jsonl (pre-ACP sessions).
function grokSessionFile(dir) {
  const updates = path.join(dir, 'updates.jsonl');
  try {
    if (fs.statSync(updates).size > 0) return updates;
  } catch {}
  const chat = path.join(dir, 'chat_history.jsonl');
  return fs.existsSync(chat) ? chat : null;
}

async function grokActiveSessions() {
  try {
    return JSON.parse(await fsp.readFile(path.join(HOME, '.grok', 'active_sessions.json'), 'utf8'));
  } catch {
    return [];
  }
}

// Filesystem fallback when active_sessions.json has no entry for a pane:
// scan the cwd's session dirs, skipping ones claimed by other LIVE
// registered processes. With the pane's process start time, only a session
// created near it (±5 min) may bind — never an old session; without it,
// best effort: the most recently written transcript.
const GROK_SCAN_WINDOW_MS = 5 * 60_000;
export async function grokScanSessions(base, { claimed = new Set(), startedAt = null } = {}) {
  let names;
  try { names = await fsp.readdir(base); } catch { return null; }
  const rows = [];
  for (const n of names) {
    if (claimed.has(n)) continue;
    const dir = path.join(base, n);
    const file = grokSessionFile(dir);
    if (!file) continue;
    let createdAt = 0;
    try {
      const s = JSON.parse(await fsp.readFile(path.join(dir, 'summary.json'), 'utf8'));
      createdAt = Date.parse(s.created_at ?? '') || 0;
    } catch { continue; }
    let mtimeMs = 0;
    try { mtimeMs = (await fsp.stat(file)).mtimeMs; } catch {}
    rows.push({ sessionId: n, file, createdAt, mtimeMs });
  }
  if (!rows.length) return null;
  if (startedAt) {
    const near = rows.filter((r) => Math.abs(r.createdAt - startedAt) < GROK_SCAN_WINDOW_MS);
    near.sort((a, b) => Math.abs(a.createdAt - startedAt) - Math.abs(b.createdAt - startedAt));
    if (near[0]) return near[0];
    // Window miss ≠ no session: a /clear >5min into the process creates a
    // fresh dir far from process start. Anything created AFTER the process
    // started is fair game (newest activity wins); anything older is a stale
    // session that must never masquerade as this pane.
    const later = rows.filter((r) => r.createdAt > startedAt);
    later.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return later[0] ?? null;
  }
  rows.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return rows[0];
}

// hints: { pid?, startedAt?, sessionId? }. Correlation strength, strongest first:
//   1. pid — the pane's actual grok process in active_sessions.json. Exact,
//      and follows a /clear (new session id, same process) automatically.
//   2. sessionId — a pane spawned with --resume is pinned to that session.
//   3. cwd + live pid + newest opened_at — only when the pane's pid is
//      UNKNOWN (/proc unavailable). When we know the pid and it isn't
//      registered, every active entry belongs to some other process.
//   4. filesystem scan — active_sessions.json is rewritten wholesale on each
//      grok launch, so a concurrent session's entry vanishes while its
//      process lives on. A missing entry proves nothing; the session dirs
//      on disk are the durable record.
async function grokFindSession(cwd, hints = {}) {
  const active = await grokActiveSessions();
  let sess = null;
  if (hints.pid) sess = active.find((s) => s.pid === hints.pid) ?? null;
  if (!sess && hints.sessionId) {
    const dir = path.join(grokDir(cwd), hints.sessionId);
    const file = grokSessionFile(dir);
    if (file) return { file, sessionId: hints.sessionId };
  }
  if (!sess && !hints.pid) {
    sess = active
      .filter((s) => s.cwd === cwd && pidAlive(s.pid))
      .sort((a, b) => (a.opened_at < b.opened_at ? 1 : -1))[0] ?? null;
  }
  if (!sess) {
    const claimed = new Set(active.filter((s) => pidAlive(s.pid)).map((s) => s.session_id));
    const hit = await grokScanSessions(grokDir(cwd), { claimed, startedAt: hints.startedAt ?? null });
    return hit ? { file: hit.file, sessionId: hit.sessionId } : null;
  }
  // trust the active entry's own cwd — it survives --cwd and in-session cd
  const dir = path.join(grokDir(sess.cwd ?? cwd), sess.session_id);
  const file = grokSessionFile(dir);
  return file ? { file, sessionId: sess.session_id } : null;
}

// Resumable-session inventory for a cwd, newest first — grok's summary.json
// carries everything a picker row needs. Sessions that were never prompted
// (no updates.jsonl content) are noise and skipped.
export async function listGrokSessions(cwd, { limit = 20 } = {}) {
  const base = grokDir(cwd);
  let names;
  try { names = await fsp.readdir(base); } catch { return []; }
  const rows = [];
  for (const n of names) {
    const dir = path.join(base, n);
    let summary;
    try {
      summary = JSON.parse(await fsp.readFile(path.join(dir, 'summary.json'), 'utf8'));
    } catch { continue; }
    const file = path.join(dir, 'updates.jsonl');
    let st;
    try { st = await fsp.stat(file); } catch { continue; }
    if (!st.size) continue;
    rows.push({
      sessionId: n,
      mtime: Date.parse(summary.last_active_at ?? summary.updated_at ?? '') || st.mtimeMs,
      size: st.size,
      title: summary.generated_title ?? summary.session_summary ?? null,
      file,
    });
  }
  rows.sort((a, b) => b.mtime - a.mtime);
  return Promise.all(rows.slice(0, limit).map(async (r) => ({
    sessionId: r.sessionId,
    mtime: r.mtime,
    size: r.size,
    title: r.title,
    firstPrompt: await grokFirstPrompt(r.file),
  })));
}

// First user message in an updates.jsonl head chunk — the picker-row preview.
async function grokFirstPrompt(file) {
  let fh;
  try { fh = await fsp.open(file, 'r'); } catch { return null; }
  try {
    const len = Math.min((await fh.stat()).size, 65_536);
    const buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, 0);
    for (const line of buf.toString('utf8').split('\n')) {
      let obj;
      try { obj = JSON.parse(line); } catch { continue; }
      const u = obj.params?.update;
      if (u?.sessionUpdate === 'user_message_chunk' && u.content?.text?.trim()) {
        return u.content.text.trim().slice(0, 200);
      }
    }
    return null;
  } finally {
    await fh.close();
  }
}

// One translate for both grok file formats, discriminated per line by the
// PAYLOAD shape, not the method string: updates.jsonl mixes plain
// 'session/update' envelopes with namespaced '_x.ai/session/update' ones
// (turn_completed rides the latter). Legacy chat_history.jsonl lines are
// {type: ...}.
function grokTranslate(obj) {
  if (typeof obj.params?.update?.sessionUpdate === 'string') return grokTranslateUpdate(obj);
  return grokTranslateChat(obj);
}

const grokContentText = (content) => {
  // updates.jsonl content shapes: {type:'text',text}, or arrays of
  // {type:'content', content:{type:'text',text}} on tool updates
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => grokContentText(b?.content ?? b?.text ?? b))
      .filter(Boolean)
      .join('\n');
  }
  if (typeof content.text === 'string') return content.text;
  return '';
};

// Fallback for tool results that ship only rawOutput. Shapes verified against
// the live corpus:
//   {type, Content:{content}}                 file/dir tools
//   {type, Result:{output | message}}         task tools
//   {type, TodosUpdated:{summary_for_prompt}} todo tool
//   {type, MultiResult:{summary, results}}    batched task output
//   {action:{…}, id, status}                  backend search — stringified
function grokRawOutputText(raw) {
  if (raw == null) return '';
  if (typeof raw === 'string') return raw;
  const first = (...vals) => vals.find((v) => typeof v === 'string' && v.trim()) ?? '';
  const inner = raw.Content ?? raw.Result ?? raw.TodosUpdated ?? raw.MultiResult ?? null;
  const s = first(
    inner?.content, inner?.output, inner?.message, inner?.summary_for_prompt,
    inner?.summary, raw.output_for_prompt,
  );
  if (s) return s;
  try { return JSON.stringify(raw).slice(0, 4000); } catch { return ''; }
}

function grokTranslateUpdate(obj) {
  const u = obj.params?.update ?? {};
  const meta = obj.params?._meta ?? {};
  const ms = meta.agentTimestampMs ?? (obj.timestamp ? obj.timestamp * 1000 : null);
  const ts = ms ? new Date(ms).toISOString() : undefined;
  switch (u.sessionUpdate) {
    case 'user_message_chunk': {
      const text = grokContentText(u.content).trim();
      // harness-injected context (task notifications etc.) rides in as a
      // synthetic user turn — same filter the legacy chat path applies
      if (text.startsWith('<system-reminder>')) return [];
      return text ? [{ kind: 'user', text, ts }] : [];
    }
    case 'agent_message_chunk': {
      const text = grokContentText(u.content);
      return text.trim() ? [{ kind: 'assistant', text, ts }] : [];
    }
    case 'agent_thought_chunk': {
      const text = grokContentText(u.content);
      return text.trim() ? [{ kind: 'thought', text, ts }] : [];
    }
    case 'tool_call':
      return [{
        kind: 'tool_use',
        name: u.title ?? 'tool',
        text: prettyArgs(u.rawInput),
        ts,
        id: u.toolCallId,
        input: u.rawInput ?? null,
      }];
    case 'tool_call_update': {
      // pending → in_progress churn is noise; only terminal states become the
      // paired result (a pending call with no terminal update = blocked)
      if (u.status !== 'completed' && u.status !== 'failed') return [];
      // ~8% of completed updates carry no `content` at all, only rawOutput
      // (e.g. {"rawOutput":{"type":"ListDir","Content":{"content":"…"}}}) —
      // without the fallback those render as empty results
      const text = grokContentText(u.content) || grokRawOutputText(u.rawOutput);
      return [{ kind: 'tool_result', text, ts, id: u.toolCallId }];
    }
    case 'turn_completed': {
      const us = u.usage;
      if (!us || !us.outputTokens) return [];
      return [{ kind: 'usage', text: '', ts, usage: { out: us.outputTokens, ctx: us.inputTokens ?? 0 } }];
    }
    case 'plan': {
      const mark = { completed: '✔', in_progress: '▸', pending: '·' };
      const text = (u.entries ?? [])
        .map((e) => `${mark[e.status] ?? '·'} ${e.content}`)
        .join('\n');
      return text ? [{ kind: 'note', name: 'plan', text, ts }] : [];
    }
    case 'task_backgrounded':
      // resolve the pending tool call so it doesn't read as blocked
      return [{ kind: 'tool_result', text: '⏳ moved to background — still running', ts, id: u.tool_call_id }];
    case 'task_completed': {
      const cmd = (u.task_snapshot?.command ?? '').split('\n')[0].slice(0, 120);
      return [{ kind: 'note', name: 'task', text: `background task finished${cmd ? `: ${cmd}` : ''}`, ts }];
    }
    default:
      return []; // session_recap, current_mode_update, retry_state, subagent_*
  }
}

// Legacy chat_history.jsonl (no timestamps, flushed per record).
function grokTranslateChat(obj) {
  switch (obj.type) {
    case 'user': {
      // grok marks its injected context turns (system reminders, project
      // instructions, task notifications) with synthetic_reason
      if (obj.synthetic_reason) return [];
      let text = (Array.isArray(obj.content) ? obj.content : [])
        .filter((b) => b.type === 'text').map((b) => b.text).join('\n');
      if (/^<(user_info|system|env)/.test(text.trim())) return [];
      text = text.trim().replace(/^<user_query>\n?/, '').replace(/\n?<\/user_query>$/, '');
      return text ? [{ kind: 'user', text }] : [];
    }
    case 'assistant': {
      const out = [];
      if (typeof obj.content === 'string' && obj.content.trim()) {
        out.push({ kind: 'assistant', text: obj.content });
      }
      for (const tc of obj.tool_calls ?? []) {
        out.push({
          kind: 'tool_use', name: tc.name, text: prettyArgs(tc.arguments),
          id: tc.id, input: parseMaybe(tc.arguments),
        });
      }
      return out;
    }
    case 'reasoning': {
      const text = (obj.summary ?? [])
        .filter((b) => b.type === 'summary_text').map((b) => b.text).join('\n');
      return text ? [{ kind: 'thought', text }] : [];
    }
    case 'tool_result':
      return [{ kind: 'tool_result', text: str(obj.content), id: obj.tool_call_id }];
    case 'backend_tool_call': {
      const k = obj.kind ?? {};
      return [{ kind: 'tool_use', name: k.tool_type ?? 'backend', text: prettyArgs(k.action) }];
    }
    default:
      return []; // system prompt etc.
  }
}

// ---------- claude code ----------
// ~/.claude/projects/<slug(cwd)>/<session-uuid>.jsonl — newest mtime wins.

function claudeSlug(cwd) {
  return cwd.replace(/[/.]/g, '-');
}

async function claudeFindSession(cwd, hints = {}) {
  const dir = path.join(HOME, '.claude', 'projects', claudeSlug(cwd));
  let names;
  try { names = await fsp.readdir(dir); } catch { return null; }
  const files = [];
  for (const n of names) {
    if (!n.endsWith('.jsonl')) continue;
    const p = path.join(dir, n);
    try {
      const st = await fsp.stat(p);
      files.push({ p, mtime: st.mtimeMs, birth: st.birthtimeMs });
    } catch {}
  }
  files.sort((a, b) => b.mtime - a.mtime);
  // Multiple sessions can share a cwd (e.g. background claude jobs). Claude
  // mirrors its jsonl `ai-title` into the terminal title herdr reports, so a
  // title match beats newest-mtime.
  const wanted = (hints.title ?? '').trim();
  if (wanted) {
    for (const f of files.slice(0, 10)) {
      const t = await lastAiTitle(f.p);
      if (t && (t === wanted || wanted.endsWith(t) || wanted.startsWith(t))) {
        return { file: f.p, sessionId: path.basename(f.p, '.jsonl') };
      }
    }
  }
  // A session the caller resumed on purpose (web spawn with --resume) is
  // pinned: trust it while the file exists. The title match above still
  // outranks it so a /clear inside a resumed pane (new session id, new
  // ai-title) can rebind away from the stale pin.
  if (hints.sessionId) {
    const f = files.find((x) => path.basename(x.p, '.jsonl') === hints.sessionId);
    if (f) return { file: f.p, sessionId: hints.sessionId };
  }
  // No title match. When the caller knows when this pane's claude process
  // started, only accept files CREATED since then: claude doesn't write the
  // jsonl until the first message, and binding a fresh pane to a neighbor's
  // recently-active session (same cwd, newer mtime) is worse than showing
  // nothing. Caveat: `claude --resume` reuses a pre-existing file, but those
  // sessions carry an ai-title and are caught above.
  if (hints.startedAfter) {
    const cutoff = hints.startedAfter - 120_000; // clock/fs slack
    // only trust the filter where the fs actually reports creation times
    // (birthtime is 0 on some NFS/overlay mounts) — else newest-mtime below
    const dated = files.filter((f) => f.birth > 0);
    if (dated.length) {
      const own = dated.filter((f) => f.birth >= cutoff);
      return own[0] ? { file: own[0].p, sessionId: path.basename(own[0].p, '.jsonl') } : null;
    }
  }
  return files[0] ? { file: files[0].p, sessionId: path.basename(files[0].p, '.jsonl') } : null;
}

// Resumable-session inventory for a cwd: every jsonl in the project dir,
// newest first, with just enough metadata for a picker row. Title comes from
// the tail (`ai-title` lines accumulate; last wins), the first-prompt preview
// from the head — both bounded reads, session files reach tens of MB.
export async function listClaudeSessions(cwd, { limit = 20 } = {}) {
  const dir = path.join(HOME, '.claude', 'projects', claudeSlug(cwd));
  let names;
  try { names = await fsp.readdir(dir); } catch { return []; }
  const files = [];
  for (const n of names) {
    if (!n.endsWith('.jsonl')) continue;
    const p = path.join(dir, n);
    try {
      const st = await fsp.stat(p);
      if (st.size > 0) files.push({ p, mtime: st.mtimeMs, size: st.size });
    } catch {}
  }
  files.sort((a, b) => b.mtime - a.mtime);
  return Promise.all(files.slice(0, limit).map(async (f) => ({
    sessionId: path.basename(f.p, '.jsonl'),
    mtime: f.mtime,
    size: f.size,
    title: await lastAiTitle(f.p),
    firstPrompt: await firstUserPrompt(f.p),
  })));
}

// One entry point for the /api/sessions route.
export function listSessions(kind, cwd, opts) {
  if (kind === 'grok') return listGrokSessions(cwd, opts);
  return listClaudeSessions(cwd, opts);
}

// First real user message in a session file, truncated for preview rows.
// Sessions routinely open with /clear — a slash command is only the preview
// of last resort, when no typed prompt appears in the head chunk.
async function firstUserPrompt(file) {
  let fh;
  try { fh = await fsp.open(file, 'r'); } catch { return null; }
  try {
    const len = Math.min((await fh.stat()).size, 65_536);
    const buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, 0);
    let command = null;
    for (const line of buf.toString('utf8').split('\n')) {
      let obj;
      try { obj = JSON.parse(line); } catch { continue; }
      if (obj.type !== 'user') continue;
      for (const ev of claudeTranslate(obj)) {
        if (ev.kind === 'user' && ev.text.trim()) return ev.text.trim().slice(0, 200);
        if (ev.kind === 'command' && !command) {
          command = `/${ev.name.replace(/^\//, '')} ${ev.text}`.trim().slice(0, 200);
        }
      }
    }
    return command;
  } finally {
    await fh.close();
  }
}

async function lastAiTitle(file) {
  let fh;
  try { fh = await fsp.open(file, 'r'); } catch { return null; }
  try {
    const size = (await fh.stat()).size;
    const len = Math.min(size, 131_072);
    const buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, size - len);
    const lines = buf.toString('utf8').split('\n');
    // custom-title (user renamed the session) supersedes ai-title in the
    // terminal title claude reports — whichever appears LAST wins, so take
    // the first hit of either kind scanning from the tail
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      if (!lines[i].includes('"ai-title"') && !lines[i].includes('"custom-title"')) continue;
      try {
        const o = JSON.parse(lines[i]);
        if (o.type === 'ai-title' && o.aiTitle) return o.aiTitle;
        if (o.type === 'custom-title' && o.customTitle) return o.customTitle;
      } catch {}
    }
    return null;
  } finally {
    await fh.close();
  }
}

function claudeTranslate(obj) {
  const ts = obj.timestamp;
  if (obj.type === 'user') {
    if (obj.isSidechain) return [];
    const c = obj.message?.content;
    if (typeof c === 'string') return userText(c, ts);
    const out = [];
    for (const b of c ?? []) {
      if (b.type === 'text') out.push(...userText(b.text, ts));
      if (b.type === 'tool_result') {
        out.push({ kind: 'tool_result', text: str(b.content), ts, id: b.tool_use_id });
      }
    }
    return out;
  }
  if (obj.type === 'assistant') {
    if (obj.isSidechain) return [];
    // usage repeats on every content-block line of the same API message —
    // ship msgId alongside so the client can dedupe when summing per turn
    const u = obj.message?.usage;
    const meta = u && !obj.isApiErrorMessage && obj.message?.model !== '<synthetic>'
      ? {
          msgId: obj.message?.id,
          usage: {
            out: u.output_tokens ?? 0,
            ctx: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0)
              + (u.cache_creation_input_tokens ?? 0),
          },
        }
      : {};
    const out = [];
    for (const b of obj.message?.content ?? []) {
      if (b.type === 'text' && b.text.trim()) out.push({ kind: 'assistant', text: b.text, ts, ...meta });
      else if (b.type === 'thinking' && b.thinking?.trim()) out.push({ kind: 'thought', text: b.thinking, ts, ...meta });
      else if (b.type === 'tool_use') {
        out.push({ kind: 'tool_use', name: b.name, text: prettyArgs(b.input), ts, id: b.id, input: b.input, ...meta });
      }
    }
    return out;
  }
  return []; // mode, attachment, file-history-snapshot, summary, ...
}

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m/g;

// A slash command lands as three consecutive user records: a caveat notice,
// a <command-name> block, and the command's stdout. Surface the latter two
// as command/command_out events; drop the rest of the meta shapes.
function userText(t, ts) {
  const s = (t ?? '').trim();
  if (s === '' || s.startsWith('<system-reminder>')
    || s.startsWith('<local-command-caveat>')
    || s.startsWith('<task-notification>')
    // interrupt markers aren't things the user said — the web UI already
    // shows its own ⏹ marker on the stopped bubble
    || s.startsWith('[Request interrupted by user')) return [];
  if (s.startsWith('<command-name>')) {
    const name = s.match(/<command-name>([\s\S]*?)<\/command-name>/)?.[1]?.trim() ?? '';
    const args = s.match(/<command-args>([\s\S]*?)<\/command-args>/)?.[1]?.trim() ?? '';
    return name ? [{ kind: 'command', name, text: args, ts }] : [];
  }
  if (s.startsWith('<local-command-stdout>')) {
    const body = s
      .replace(/^<local-command-stdout>/, '').replace(/<\/local-command-stdout>$/, '')
      .replace(ANSI_RE, '').trim();
    return body ? [{ kind: 'command_out', text: body, ts }] : [];
  }
  return [{ kind: 'user', text: t, ts }];
}

// ---------- shared ----------

function str(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((b) => (b?.type === 'text' ? b.text : JSON.stringify(b))).join('\n');
  }
  return content == null ? '' : JSON.stringify(content, null, 1);
}

function parseMaybe(v) {
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch { return null; }
}

function prettyArgs(args) {
  if (args == null) return '';
  let v = args;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { return v; } }
  return JSON.stringify(v, null, 1);
}

const ADAPTERS = {
  grok: { find: grokFindSession, translate: grokTranslate },
  claude: { find: claudeFindSession, translate: claudeTranslate },
};

export function adapterFor(agentName) {
  return ADAPTERS[agentName] ?? null;
}

// Walk a normalized-event transcript backwards looking for a tool_use with no
// result — the file-tier of blocked classification, shared by claude (which
// flushes AskUserQuestion/ExitPlanMode before blocking) and grok (which
// streams the pending tool_call to updates.jsonl at permission time).
export function classifyBlocked(events) {
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
      if (bare === 'exitplanmode') {
        return { kind: 'plan', plan: typeof e.input?.plan === 'string' ? e.input.plan : '' };
      }
      return { kind: 'permission', tool: e.name ?? 'tool', detail: e.text ?? '' };
    }
    if (e.kind === 'assistant' || e.kind === 'user') return { kind: 'unknown' };
  }
  return { kind: 'unknown' };
}

// Read a transcript file from byte `offset`; returns translated events plus
// the new offset (only counting complete lines, so callers can resume).
// `reset: true` means the file shrank under us (rewind/compaction rewrote
// it) — the returned events restart from byte 0, so a tailing caller must
// reload rather than append them.
export async function readEvents(adapter, file, offset = 0) {
  let fh;
  try { fh = await fsp.open(file, 'r'); } catch { return { events: [], offset }; }
  let reset = false;
  try {
    const size = (await fh.stat()).size;
    if (size < offset) { offset = 0; reset = true; } // truncated/rotated
    if (size === offset) return { events: [], offset, reset };
    const buf = Buffer.alloc(size - offset);
    await fh.read(buf, 0, buf.length, offset);
    const text = buf.toString('utf8');
    const lastNl = text.lastIndexOf('\n');
    if (lastNl === -1) return { events: [], offset, reset };
    const events = [];
    for (const line of text.slice(0, lastNl).split('\n')) {
      if (!line.trim()) continue;
      try { events.push(...adapter.translate(JSON.parse(line))); } catch {}
    }
    return { events, offset: offset + Buffer.byteLength(text.slice(0, lastNl + 1)), reset };
  } finally {
    await fh.close();
  }
}
