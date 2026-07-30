// Per-agent session-file adapters. Each adapter maps a herdr agent
// (agent name + cwd) to a transcript file on disk and translates its
// jsonl lines into normalized events:
//   { kind: 'user'|'assistant'|'thought'|'tool_use'|'tool_result'|'note',
//     text, name?, ts? }
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const HOME = os.homedir();

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

// ---------- grok ----------
// ~/.grok/sessions/<encodeURIComponent(cwd)>/<session_id>/chat_history.jsonl
// ~/.grok/active_sessions.json maps session_id -> {pid, cwd, opened_at}

async function grokFindSession(cwd) {
  let active;
  try {
    active = JSON.parse(await fsp.readFile(path.join(HOME, '.grok', 'active_sessions.json'), 'utf8'));
  } catch { return null; }
  const live = active
    .filter((s) => s.cwd === cwd && pidAlive(s.pid))
    .sort((a, b) => (a.opened_at < b.opened_at ? 1 : -1));
  const sess = live[0];
  if (!sess) return null;
  const file = path.join(
    HOME, '.grok', 'sessions', encodeURIComponent(cwd), sess.session_id, 'chat_history.jsonl',
  );
  return fs.existsSync(file) ? { file, sessionId: sess.session_id } : null;
}

function grokTranslate(obj) {
  switch (obj.type) {
    case 'user': {
      let text = (Array.isArray(obj.content) ? obj.content : [])
        .filter((b) => b.type === 'text').map((b) => b.text).join('\n');
      // grok injects <user_info>/env blocks as user turns; hide them
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
    try { files.push({ p, mtime: (await fsp.stat(p)).mtimeMs }); } catch {}
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
  return files[0] ? { file: files[0].p, sessionId: path.basename(files[0].p, '.jsonl') } : null;
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
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      if (!lines[i].includes('"ai-title"')) continue;
      try {
        const o = JSON.parse(lines[i]);
        if (o.type === 'ai-title' && o.aiTitle) return o.aiTitle;
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
    if (typeof c === 'string') {
      return isMetaText(c) ? [] : [{ kind: 'user', text: c, ts }];
    }
    const out = [];
    for (const b of c ?? []) {
      if (b.type === 'text' && !isMetaText(b.text)) out.push({ kind: 'user', text: b.text, ts });
      if (b.type === 'tool_result') {
        out.push({ kind: 'tool_result', text: str(b.content), ts, id: b.tool_use_id });
      }
    }
    return out;
  }
  if (obj.type === 'assistant') {
    if (obj.isSidechain) return [];
    const out = [];
    for (const b of obj.message?.content ?? []) {
      if (b.type === 'text' && b.text.trim()) out.push({ kind: 'assistant', text: b.text, ts });
      else if (b.type === 'thinking' && b.thinking?.trim()) out.push({ kind: 'thought', text: b.thinking, ts });
      else if (b.type === 'tool_use') {
        out.push({ kind: 'tool_use', name: b.name, text: prettyArgs(b.input), ts, id: b.id, input: b.input });
      }
    }
    return out;
  }
  return []; // mode, attachment, file-history-snapshot, summary, ...
}

function isMetaText(t) {
  const s = (t ?? '').trim();
  return s.startsWith('<system-reminder>') || s.startsWith('<command-name>')
    || s.startsWith('<local-command-stdout>') || s === '';
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

// Read a transcript file from byte `offset`; returns translated events plus
// the new offset (only counting complete lines, so callers can resume).
export async function readEvents(adapter, file, offset = 0) {
  let fh;
  try { fh = await fsp.open(file, 'r'); } catch { return { events: [], offset }; }
  try {
    const size = (await fh.stat()).size;
    if (size < offset) offset = 0; // truncated/rotated
    if (size === offset) return { events: [], offset };
    const buf = Buffer.alloc(size - offset);
    await fh.read(buf, 0, buf.length, offset);
    const text = buf.toString('utf8');
    const lastNl = text.lastIndexOf('\n');
    if (lastNl === -1) return { events: [], offset };
    const events = [];
    for (const line of text.slice(0, lastNl).split('\n')) {
      if (!line.trim()) continue;
      try { events.push(...adapter.translate(JSON.parse(line))); } catch {}
    }
    return { events, offset: offset + Buffer.byteLength(text.slice(0, lastNl + 1)) };
  } finally {
    await fh.close();
  }
}
