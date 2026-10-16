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
//   1. pid — the pane's actual grok process in active_sessions.json. Exact.
//      /clear (or a new chat in-process) can leave MULTIPLE entries for the
//      same pid; always pick newest opened_at so we don't stick to the
//      pre-clear empty shell (Array.find would keep the stale first row).
//   2. sessionId — a pane spawned with --resume is pinned to that session.
//   3. cwd + live pid + newest opened_at — only when the pane's pid is
//      UNKNOWN (/proc unavailable). When we know the pid and it isn't
//      registered, every active entry belongs to some other process.
//   4. filesystem scan — active_sessions.json is rewritten wholesale on each
//      grok launch, so a concurrent session's entry vanishes while its
//      process lives on. A missing entry proves nothing; the session dirs
//      on disk are the durable record.
export function pickActiveByPid(active, pid) {
  return active
    .filter((s) => s.pid === pid)
    .sort((a, b) => (a.opened_at < b.opened_at ? 1 : -1))[0] ?? null;
}

async function grokFindSession(cwd, hints = {}) {
  const active = await grokActiveSessions();
  let sess = null;
  if (hints.pid) sess = pickActiveByPid(active, hints.pid);
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
// ~/.claude/projects/<slug(cwd)>/<session-uuid>.jsonl. Correlation ladder:
// pid registry > terminal title > resume pin > created-since-process-start
// > newest mtime. Only the first three are exact; the last two are guesses
// and honour `hints.exclude` (files already claimed by sibling panes).

const claudeProjectsDir = path.join(HOME, '.claude', 'projects');

function claudeSlug(cwd) {
  return cwd.replace(/[/.]/g, '-');
}

// /proc/<pid>/stat field 22 — process start in clock ticks since boot, the
// value claude records as `procStart`. null where /proc is absent (mac).
function procStartTicks(pid) {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19] ?? null;
  } catch {
    return null;
  }
}

// Claude Code ≥ 2.1.290 keeps a per-process registry at
// ~/.claude/sessions/<pid>.json — {pid, sessionId, cwd, procStart, …},
// rewritten in place on /clear. One file per pid, so unlike grok's
// active_sessions.json nothing clobbers it. With the pid herdr reports for
// the pane this is an exact binding. Returns null for a missing entry or
// one left behind by a dead process whose pid was reused (procStart guard).
export function claudeRegistryEntry(pid) {
  let reg;
  try {
    reg = JSON.parse(fs.readFileSync(path.join(HOME, '.claude', 'sessions', `${pid}.json`), 'utf8'));
  } catch {
    return null;
  }
  if (!reg?.sessionId || (reg.pid != null && Number(reg.pid) !== Number(pid))) return null;
  const ticks = procStartTicks(pid);
  if (ticks != null) {
    if (reg.procStart != null && String(reg.procStart) !== String(ticks)) return null;
  } else if (!pidAlive(pid)) {
    return null;
  }
  return reg;
}

// The jsonl for a known session id. It lives under the slug of the LAUNCH
// cwd; the registry's cwd is live and can move (worktree hand-off), so try
// the candidate cwds first and only then every project dir.
async function claudeSessionFile(sessionId, cwds) {
  const tried = new Set();
  for (const c of cwds) {
    if (!c) continue;
    const dir = path.join(claudeProjectsDir, claudeSlug(c));
    if (tried.has(dir)) continue;
    tried.add(dir);
    const p = path.join(dir, `${sessionId}.jsonl`);
    if (fs.existsSync(p)) return p;
  }
  let names;
  try { names = await fsp.readdir(claudeProjectsDir); } catch { return null; }
  for (const n of names) {
    const dir = path.join(claudeProjectsDir, n);
    if (tried.has(dir)) continue;
    const p = path.join(dir, `${sessionId}.jsonl`);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

async function claudeFindSession(cwd, hints = {}) {
  if (hints.pid) {
    const reg = claudeRegistryEntry(hints.pid);
    if (reg) {
      const file = await claudeSessionFile(reg.sessionId, [reg.cwd, cwd]);
      // Registered but no jsonl yet: a fresh session before its first
      // message. Say "nothing yet" — falling through to the guesses below
      // is exactly how a fresh pane used to show a sibling's transcript.
      return file ? { file, sessionId: reg.sessionId } : null;
    }
  }
  const exclude = hints.exclude ?? new Set();
  const dir = path.join(claudeProjectsDir, claudeSlug(cwd));
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
  // Guesses from here on: never hand a pane a file a sibling already owns.
  const free = files.filter((f) => !exclude.has(path.basename(f.p, '.jsonl')));
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
    const dated = free.filter((f) => f.birth > 0);
    if (dated.length) {
      const own = dated.filter((f) => f.birth >= cutoff);
      return own[0] ? { file: own[0].p, sessionId: path.basename(own[0].p, '.jsonl') } : null;
    }
  }
  return free[0] ? { file: free[0].p, sessionId: path.basename(free[0].p, '.jsonl') } : null;
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
  if (kind === 'codex') return listCodexSessions(cwd, opts);
  if (kind === 'pi') return listPiSessions(cwd, opts);
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
    // the post-compaction recap rides as a "user" record — it's claude's
    // own summary, not something the user said; the boundary note covers it
    if (obj.isSidechain || obj.isCompactSummary) return [];
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
  if (obj.type === 'system' && obj.subtype === 'compact_boundary') {
    return [{ kind: 'note', name: 'compact', text: 'context compacted', ts }];
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

// ---------- codex ----------
// ~/.codex/sessions/YYYY/MM/DD/rollout-<local-ts>-<session-uuid>.jsonl — one
// file per session, the uuid is the filename tail. Verified against codex
// 0.162 (2026-10). Every line is {timestamp, ordinal, type, payload}:
//   session_meta   payload.id + payload.cwd (line 1)
//   response_item  the model-visible history: message / reasoning /
//                  function_call(+_output) / custom_tool_call(+_output)
//   event_msg      UI events — item_completed DUPLICATES the response_items
//                  (skip), token_count carries per-response usage
// Correlation ladder, all but the last exact:
//   1. the session id herdr reports for the pane (its SessionStart hook —
//      `herdr integration install codex`)
//   2. the rollout the pane's codex process holds open (/proc/<pid>/fd)
//   3. resume pin
//   4. session_meta.cwd match, created since the process started

const codexSessionsDir = () =>
  path.join(process.env.CODEX_HOME || path.join(HOME, '.codex'), 'sessions');
const CODEX_ROLLOUT_RE = /^rollout-.*-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/;
const codexIdOf = (file) => path.basename(file).match(CODEX_ROLLOUT_RE)?.[1] ?? null;

// Rollout files newest first. The YYYY/MM/DD dirs and the timestamped names
// both sort lexically, so this walks back in time and can stop early.
async function* codexRollouts() {
  const desc = async (dir) => {
    try { return (await fsp.readdir(dir)).sort().reverse(); } catch { return []; }
  };
  const root = codexSessionsDir();
  for (const y of await desc(root)) {
    for (const m of await desc(path.join(root, y))) {
      for (const d of await desc(path.join(root, y, m))) {
        const dir = path.join(root, y, m, d);
        for (const n of await desc(dir)) {
          if (CODEX_ROLLOUT_RE.test(n)) yield path.join(dir, n);
        }
      }
    }
  }
}

const codexFileCache = new Map(); // sessionId -> rollout path
async function codexFileById(sessionId) {
  const hit = codexFileCache.get(sessionId);
  if (hit && fs.existsSync(hit)) return hit;
  for await (const file of codexRollouts()) {
    if (codexIdOf(file) === sessionId) {
      codexFileCache.set(sessionId, file);
      return file;
    }
  }
  return null;
}

// The rollout a live codex process is appending to — it keeps the file open
// for the life of the session, and swaps it on /new. Linux only.
function codexOpenRollout(pid) {
  const fdDir = `/proc/${pid}/fd`;
  let fds;
  try { fds = fs.readdirSync(fdDir); } catch { return null; }
  for (const fd of fds) {
    let target;
    try { target = fs.readlinkSync(path.join(fdDir, fd)); } catch { continue; }
    if (codexIdOf(target)) return target;
  }
  return null;
}

// session_meta is line 1, but it embeds the full base instructions (~20 KB).
async function codexMeta(file) {
  let fh;
  try { fh = await fsp.open(file, 'r'); } catch { return null; }
  try {
    const buf = Buffer.alloc(131_072);
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    const head = buf.toString('utf8', 0, bytesRead);
    const nl = head.indexOf('\n');
    if (nl === -1) return null;
    const obj = JSON.parse(head.slice(0, nl));
    return obj.type === 'session_meta' ? obj.payload ?? null : null;
  } catch {
    return null;
  } finally {
    await fh.close();
  }
}

// How far back the cwd scans look — a rollout past this many files is
// reachable by id (exact tiers, resume pin) but not by guessing.
const CODEX_SCAN_FILES = 300;

async function codexFindSession(cwd, hints = {}) {
  const byId = async (id) => {
    const file = id ? await codexFileById(id) : null;
    return file ? { file, sessionId: id } : null;
  };
  const reported = await byId(hints.agentSessionId);
  if (reported) return reported;
  if (hints.pid) {
    const file = codexOpenRollout(hints.pid);
    if (file) return { file, sessionId: codexIdOf(file) };
  }
  const pinned = await byId(hints.sessionId);
  if (pinned) return pinned;
  // Guess: never a file a sibling owns, and — when the process start is
  // known — only one created since (same reasoning as claudeFindSession).
  const exclude = hints.exclude ?? new Set();
  const cutoff = hints.startedAfter ? hints.startedAfter - 120_000 : null;
  let seen = 0;
  for await (const file of codexRollouts()) {
    if ((seen += 1) > CODEX_SCAN_FILES) break;
    const id = codexIdOf(file);
    if (exclude.has(id)) continue;
    const meta = await codexMeta(file);
    if (meta?.cwd !== cwd) continue;
    if (cutoff != null) {
      const created = Date.parse(meta.timestamp ?? '') || 0;
      if (created < cutoff) return null; // newest-first: everything after is older
    }
    return { file, sessionId: id };
  }
  return null;
}

// Resumable-session inventory for a cwd, newest first. Sub-agent threads and
// never-prompted sessions are noise and skipped.
export async function listCodexSessions(cwd, { limit = 20 } = {}) {
  const rows = [];
  let seen = 0;
  for await (const file of codexRollouts()) {
    if ((seen += 1) > CODEX_SCAN_FILES || rows.length >= limit) break;
    const meta = await codexMeta(file);
    if (meta?.cwd !== cwd) continue;
    if (meta.thread_source && meta.thread_source !== 'user') continue;
    const firstPrompt = await codexFirstPrompt(file);
    if (!firstPrompt) continue;
    let st;
    try { st = await fsp.stat(file); } catch { continue; }
    rows.push({ sessionId: codexIdOf(file), mtime: st.mtimeMs, size: st.size, title: null, firstPrompt });
  }
  rows.sort((a, b) => b.mtime - a.mtime);
  return rows;
}

async function codexFirstPrompt(file) {
  let fh;
  try { fh = await fsp.open(file, 'r'); } catch { return null; }
  try {
    const len = Math.min((await fh.stat()).size, 262_144);
    const buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, 0);
    for (const line of buf.toString('utf8').split('\n')) {
      if (!line.includes('"role":"user"')) continue;
      let obj;
      try { obj = JSON.parse(line); } catch { continue; }
      const ev = codexTranslate(obj).find((e) => e.kind === 'user' && e.text.trim());
      if (ev) return ev.text.trim().slice(0, 200);
    }
    return null;
  } finally {
    await fh.close();
  }
}

const codexText = (content) => (Array.isArray(content) ? content : [])
  .map((b) => (typeof b?.text === 'string' ? b.text : ''))
  .filter(Boolean)
  .join('\n');

// Tool output is a plain string on current codex; older builds wrapped it as
// a JSON string {"output": "...", "metadata": {...}} or a {content} object.
function codexOutputText(out) {
  if (out == null) return '';
  if (typeof out === 'string') {
    if (out.startsWith('{"output"')) {
      try { return String(JSON.parse(out).output ?? out); } catch {}
    }
    return out;
  }
  if (typeof out.content === 'string') return out.content;
  if (typeof out.output === 'string') return out.output;
  return str(out.content ?? out);
}

function codexTranslate(obj) {
  const ts = obj.timestamp;
  const p = obj.payload ?? {};
  if (obj.type === 'compacted') return [{ kind: 'note', name: 'compact', text: 'context compacted', ts }];
  if (obj.type === 'event_msg') {
    if (p.type === 'token_count') {
      const last = p.info?.last_token_usage;
      if (!last?.output_tokens) return [];
      // one per model response — a distinct msgId each so the turn footer sums them
      return [{
        kind: 'usage', text: '', ts,
        msgId: `tc${obj.ordinal ?? ts}`,
        usage: { out: last.output_tokens, ctx: last.input_tokens ?? 0 },
      }];
    }
    return []; // item_completed mirrors response_items; task_started/complete
  }
  if (obj.type !== 'response_item') return []; // session_meta, turn_context, world_state, …
  switch (p.type) {
    case 'message': {
      const text = codexText(p.content);
      if (!text.trim()) return [];
      if (p.role === 'assistant') return [{ kind: 'assistant', text, ts }];
      if (p.role !== 'user') return []; // developer = harness instructions
      // harness context (environment_context, AGENTS.md, abort markers) rides
      // in as user messages. Current codex tags each message's kind; older
      // rollouts only have the leading-XML-tag tell.
      const kinds = p.internal_chat_message_metadata_passthrough?.content_item_kinds;
      if (Array.isArray(kinds) ? !kinds.includes('user.text') : /^\s*<[a-z_]+>/.test(text)) return [];
      return [{ kind: 'user', text, ts }];
    }
    case 'reasoning': {
      // hosted models ship only encrypted_content plus an optional summary
      const text = (p.summary ?? []).map((b) => b?.text ?? '').filter(Boolean).join('\n\n');
      return text.trim() ? [{ kind: 'thought', text, ts }] : [];
    }
    case 'function_call':
      return [{
        kind: 'tool_use', name: p.name || 'tool', text: prettyArgs(p.arguments),
        ts, id: p.call_id, input: parseMaybe(p.arguments),
      }];
    case 'custom_tool_call': // apply_patch: `input` is the raw patch text
      return [{
        kind: 'tool_use', name: p.name || 'tool', text: typeof p.input === 'string' ? p.input : prettyArgs(p.input),
        ts, id: p.call_id, input: typeof p.input === 'string' ? { input: p.input } : p.input ?? null,
      }];
    case 'local_shell_call': {
      const cmd = p.action?.command;
      return [{
        kind: 'tool_use', name: 'shell', text: Array.isArray(cmd) ? cmd.join(' ') : str(cmd),
        ts, id: p.call_id, input: p.action ?? null,
      }];
    }
    case 'function_call_output':
    case 'custom_tool_call_output':
    case 'local_shell_call_output':
      return [{ kind: 'tool_result', text: codexOutputText(p.output), ts, id: p.call_id }];
    case 'web_search_call': {
      // server-side tool: no output record follows, so pair it here or it
      // reads as a pending (blocked) call forever
      const id = p.call_id ?? p.id ?? `ws${obj.ordinal ?? ts}`;
      const q = p.action?.query ?? p.action?.url ?? '';
      return [
        { kind: 'tool_use', name: 'web_search', text: q, ts, id, input: p.action ?? null },
        { kind: 'tool_result', text: '', ts, id },
      ];
    }
    default:
      return [];
  }
}

// ---------- pi ----------
// ~/.pi/agent/sessions/--<cwd with / → ->--/<iso-ts>_<session-id>.jsonl
// (PI_CODING_AGENT_DIR moves the agent dir). Verified against pi 1.3 (2026-10).
// Line 1 is the header {type:'session', id, cwd}; every later line is an
// entry {type, id, parentId, timestamp, …} — a tree, since /tree and fork
// navigation append a new branch onto an earlier entry. We render the file
// linearly (an abandoned branch stays visible above the new one). pi writes
// nothing until the first user message, then appends per entry.
// Correlation ladder, all but the last exact:
//   1. the session file herdr reports for the pane (its pi extension —
//      `herdr integration install pi`). Reported from launch, before the
//      file exists: missing file = "nothing yet", never a guess.
//   2. resume pin
//   3. cwd dir, created since the process started

const piAgentDir = () => process.env.PI_CODING_AGENT_DIR || path.join(HOME, '.pi', 'agent');
const piDir = (cwd) =>
  path.join(piAgentDir(), 'sessions', `--${cwd.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`);
const PI_FILE_RE = /^(.+)_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/;
const piIdOf = (file) => path.basename(file).match(PI_FILE_RE)?.[2] ?? null;
// the filename stamp is the creation time, ISO with ':' and '.' folded to '-'
const piCreatedAt = (file) => {
  const ts = path.basename(file).match(PI_FILE_RE)?.[1] ?? '';
  const m = ts.match(/^(\d{4}-\d\d-\d\dT\d\d)-(\d\d)-(\d\d)-(\d+)Z$/);
  return m ? Date.parse(`${m[1]}:${m[2]}:${m[3]}.${m[4]}Z`) || 0 : 0;
};

// Session files in a cwd's dir, newest first (the names sort by creation).
async function piFiles(cwd) {
  let names;
  try { names = await fsp.readdir(piDir(cwd)); } catch { return []; }
  return names.filter((n) => PI_FILE_RE.test(n)).sort().reverse().map((n) => path.join(piDir(cwd), n));
}

async function piFindSession(cwd, hints = {}) {
  const reported = hints.agentSessionId;
  if (typeof reported === 'string' && path.isAbsolute(reported)) {
    return fs.existsSync(reported) ? { file: reported, sessionId: piIdOf(reported) } : null;
  }
  const files = await piFiles(cwd);
  if (hints.sessionId) {
    const f = files.find((x) => piIdOf(x) === hints.sessionId);
    if (f) return { file: f, sessionId: hints.sessionId };
  }
  // Guess: among files created since the process started, the most recently
  // WRITTEN. Not the newest name — the stamp is when pi created the session
  // in memory, but the file only lands on the first message, so a headless
  // `pi -p` run in the same cwd can carry a newer stamp than the pane's own
  // session and would otherwise hold the binding forever.
  const exclude = hints.exclude ?? new Set();
  const cutoff = hints.startedAfter ? hints.startedAfter - 120_000 : null;
  let best = null;
  for (const f of files) {
    if (exclude.has(piIdOf(f))) continue;
    if (cutoff != null && piCreatedAt(f) < cutoff) break; // newest-first
    let mtime = 0;
    try { mtime = (await fsp.stat(f)).mtimeMs; } catch { continue; }
    if (!best || mtime > best.mtime) best = { file: f, mtime };
  }
  return best ? { file: best.file, sessionId: piIdOf(best.file) } : null;
}

// Resumable-session inventory for a cwd, newest first. Title is the
// /name-set display name (session_info entries; last wins).
export async function listPiSessions(cwd, { limit = 20 } = {}) {
  const rows = [];
  for (const file of await piFiles(cwd)) {
    if (rows.length >= limit) break;
    let st;
    try { st = await fsp.stat(file); } catch { continue; }
    const { firstPrompt, title } = await piHeadInfo(file);
    if (!firstPrompt) continue;
    rows.push({ sessionId: piIdOf(file), mtime: st.mtimeMs, size: st.size, title, firstPrompt });
  }
  rows.sort((a, b) => b.mtime - a.mtime);
  return rows;
}

async function piHeadInfo(file) {
  let fh;
  try { fh = await fsp.open(file, 'r'); } catch { return { firstPrompt: null, title: null }; }
  try {
    const size = (await fh.stat()).size;
    const read = async (pos, len) => {
      const buf = Buffer.alloc(len);
      await fh.read(buf, 0, len, pos);
      return buf.toString('utf8').split('\n');
    };
    let firstPrompt = null;
    for (const line of await read(0, Math.min(size, 131_072))) {
      if (!line.includes('"role":"user"')) continue;
      let obj;
      try { obj = JSON.parse(line); } catch { continue; }
      const ev = piTranslate(obj).find((e) => e.kind === 'user' && e.text.trim());
      if (ev) { firstPrompt = ev.text.trim().slice(0, 200); break; }
    }
    let title = null;
    const tailLen = Math.min(size, 131_072);
    const tail = await read(size - tailLen, tailLen);
    for (let i = tail.length - 1; i >= 0 && !title; i -= 1) {
      if (!tail[i].includes('"session_info"')) continue;
      try { title = JSON.parse(tail[i]).name ?? null; } catch {}
    }
    return { firstPrompt, title };
  } finally {
    await fh.close();
  }
}

const piText = (content) => (typeof content === 'string' ? content : (Array.isArray(content) ? content : [])
  .map((b) => (b?.type === 'text' ? b.text : b?.type === 'image' ? '[image]' : ''))
  .filter(Boolean)
  .join('\n'));

function piTranslate(obj) {
  const ts = obj.timestamp;
  switch (obj.type) {
    case 'compaction':
      return [{ kind: 'note', name: 'compact', text: 'context compacted', ts }];
    case 'branch_summary':
      return [{ kind: 'note', name: 'branch', text: obj.summary ? `branch summary: ${obj.summary}` : 'switched branch', ts }];
    case 'custom_message': {
      // extension-injected context; display:false is hidden in pi's TUI too
      const text = obj.display ? piText(obj.content) : '';
      return text.trim() ? [{ kind: 'note', name: obj.customType ?? 'extension', text, ts }] : [];
    }
    case 'message':
      break;
    default:
      return []; // session header, model/thinking changes, labels, custom state, …
  }
  const m = obj.message ?? {};
  switch (m.role) {
    case 'user': {
      const text = piText(m.content);
      return text.trim() ? [{ kind: 'user', text, ts }] : [];
    }
    case 'assistant': {
      const u = m.usage;
      const meta = u?.output
        ? { msgId: obj.id, usage: { out: u.output, ctx: (u.input ?? 0) + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0) } }
        : {};
      const out = [];
      for (const b of Array.isArray(m.content) ? m.content : []) {
        if (b.type === 'text' && b.text?.trim()) out.push({ kind: 'assistant', text: b.text, ts, ...meta });
        else if (b.type === 'thinking' && b.thinking?.trim()) out.push({ kind: 'thought', text: b.thinking, ts, ...meta });
        else if (b.type === 'toolCall') {
          out.push({ kind: 'tool_use', name: b.name || 'tool', text: prettyArgs(b.arguments), ts, id: b.id, input: b.arguments ?? null, ...meta });
        }
      }
      // aborted/errored turns end with no text — say why instead of going silent
      if (m.stopReason === 'aborted') out.push({ kind: 'note', name: 'aborted', text: 'turn interrupted', ts });
      else if (m.stopReason === 'error') out.push({ kind: 'note', name: 'error', text: m.errorMessage || 'model error', ts });
      if (!out.length && meta.usage) out.push({ kind: 'usage', text: '', ts, ...meta });
      return out;
    }
    case 'toolResult':
      return [{ kind: 'tool_result', text: piText(m.content), ts, id: m.toolCallId }];
    case 'bashExecution': {
      // the user's own `!cmd` from pi's composer — paired so it renders as a
      // finished tool call rather than a pending (blocked) one
      const id = `bash${obj.id}`;
      const status = m.cancelled ? '\n[cancelled]' : m.exitCode ? `\n[exit ${m.exitCode}]` : '';
      return [
        { kind: 'tool_use', name: 'bash', text: m.command ?? '', ts, id, input: { command: m.command } },
        { kind: 'tool_result', text: `${m.output ?? ''}${status}`, ts, id },
      ];
    }
    default:
      return []; // system prompt snapshot, custom, branch/compaction summaries
  }
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

// What a session is about, for the roster row: the harness's own title when
// it earned one, else the first prompt. Bounded head/tail reads only.
async function grokDescribe(file) {
  let title = null;
  try {
    const s = JSON.parse(await fsp.readFile(path.join(path.dirname(file), 'summary.json'), 'utf8'));
    title = s.generated_title ?? s.session_summary ?? null;
  } catch {}
  return { title, firstPrompt: await grokFirstPrompt(file) };
}

const ADAPTERS = {
  grok: { find: grokFindSession, translate: grokTranslate, describe: grokDescribe },
  claude: {
    find: claudeFindSession,
    translate: claudeTranslate,
    describe: async (file) => ({ title: await lastAiTitle(file), firstPrompt: await firstUserPrompt(file) }),
  },
  codex: {
    find: codexFindSession,
    translate: codexTranslate,
    describe: async (file) => ({ title: null, firstPrompt: await codexFirstPrompt(file) }),
  },
  pi: { find: piFindSession, translate: piTranslate, describe: piHeadInfo },
};

/** Epoch ms of the newest real conversation turn (you or the agent) in a
 *  transcript, scanning back from the tail. File mtime is NOT activity:
 *  claude appends untimestamped bookkeeping (bridge-session, atis-latch…)
 *  to idle transcripts, which used to float day-old chats to the top. */
export async function lastTurnAt(adapter, file) {
  if (!adapter?.translate) return null;
  let fh;
  try { fh = await fsp.open(file, 'r'); } catch { return null; }
  try {
    const size = (await fh.stat()).size;
    const len = Math.min(size, 262_144);
    const buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, size - len);
    const lines = buf.toString('utf8').split('\n');
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      let obj;
      try { obj = JSON.parse(lines[i]); } catch { continue; }
      let evs;
      try { evs = adapter.translate(obj); } catch { continue; }
      for (const ev of evs ?? []) {
        if ((ev.kind === 'user' || ev.kind === 'assistant' || ev.kind === 'command') && ev.ts) {
          const ms = Date.parse(ev.ts);
          if (ms) return ms;
        }
      }
    }
    return null;
  } finally {
    await fh.close();
  }
}

export function adapterFor(agentName) {
  return ADAPTERS[agentName] ?? null;
}

// Walk a normalized-event transcript backwards looking for a tool_use with no
// result — the file-tier of blocked classification, shared by claude (which
// flushes AskUserQuestion/ExitPlanMode before blocking), grok (which
// streams the pending tool_call to updates.jsonl at permission time) and
// codex (whose function_call lands in the rollout before its approval).
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
