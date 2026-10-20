// herdr-web daemon: phone-first web UI over herdr agent sessions.
// Zero deps, node >= 22.  Usage: node server.js [--port 7683] [--host 0.0.0.0]
import http from 'node:http';
import fsp from 'node:fs/promises';
import fs, { constants as fsConstants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rpc, subscribe, isPromptable } from './lib/herdr.js';
import { adapterFor, lastTurnAt, readEvents, listSessions, classifyBlocked } from './lib/adapters.js';
import { trimEvents, windowEvents } from './lib/transcript-window.js';
import {
  parseMenuScreen, parseMenuFor, codexComposerText, piComposerText, isGrokProjectPicker, isGrokModalOverlay,
  isGrokPlanApproval, parseGrokPlanApproval, parseRewindScreen,
  composerText, typedComposerText, parseMode, MODES, trimSalvage,
} from './lib/screen.js';
import { PushStore, Coordinator } from './lib/notify.js';
import { loadPrefs, savePrefs } from './lib/prefs.js';

// A stray rejection (e.g. a background refresh path that missed a catch) must
// not kill a daemon whose whole job is staying up — log loudly and carry on.
process.on('unhandledRejection', (err) => {
  console.error('[herdr-web] unhandled rejection:', err);
});

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
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

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

let roster = { agents: [], workspaces: [], tabs: [], herdrDown: false, updatedAt: 0 };
const rosterClients = new Set(); // SSE responses

// paneId -> {status, at}: when this server last saw the pane's status flip.
// `at` is 0 for the status a pane had when first seen — boot isn't activity.
const statusSince = new Map();

// file -> {mtimeMs, desc}: adapter.describe() re-reads head+tail, so only
// redo it when the transcript actually moved.
const describeCache = new Map();

// What the session is about and when it last moved, from its transcript.
async function sessionMeta(adapter, file) {
  let st;
  try { st = await fsp.stat(file); } catch { return { mtimeMs: 0, desc: null, turnAt: null }; }
  const hit = describeCache.get(file);
  if (hit && hit.mtimeMs === st.mtimeMs) return hit;
  let desc = null;
  try { desc = adapter?.describe ? await adapter.describe(file) : null; } catch {}
  let turnAt = null;
  try { turnAt = await lastTurnAt(adapter, file); } catch {}
  const entry = { mtimeMs: st.mtimeMs, desc, turnAt };
  describeCache.set(file, entry);
  return entry;
}

// Coalesce concurrent callers (interval + event debounce) — overlapping runs
// could double-fire coordinator.onTransition for the same status change.
let refreshInFlight = null;
function refreshRoster() {
  refreshInFlight ??= doRefreshRoster().finally(() => { refreshInFlight = null; });
  return refreshInFlight;
}

async function doRefreshRoster() {
  try {
    // One RPC for the whole tree: agents + workspaces + tabs (agent entries
    // here are the same AgentInfo shape agent.list returns).
    const snap = (await rpc('session.snapshot')).snapshot ?? {};
    const snapAgents = (snap.agents ?? []).filter((a) => a.agent);
    reportedSessions.clear();
    for (const a of snapAgents) {
      // codex (session id) and pi (session file path) only: claude's pid
      // registry already follows /clear exactly
      const rep = a.agent_session;
      if (rep?.value && ((a.agent === 'codex' && rep.kind === 'id') || (a.agent === 'pi' && rep.kind === 'path'))) {
        reportedSessions.set(a.pane_id, rep.value);
      }
    }
    const sessions = await allocateSessions(snapAgents);
    const agents = await Promise.all(snapAgents.map(async (a) => {
      const session = sessions.get(a.pane_id) ?? null;
      const repoRoot = await gitRootOf(a.cwd);
      // grok's plan-approval overlay keeps herdr at "working" (exit_plan_mode
      // stays Pending). Surface it as blocked so the card/push/key-pad fire.
      let status = a.agent_status;
      if (a.agent === 'grok' && status === 'working' && session) {
        const title = a.terminal_title_stripped ?? a.terminal_title ?? '';
        if (await grokPlanWaiting(session) || /Plan:\s*Exit/i.test(title)) {
          status = 'blocked';
        }
      }
      const since = statusSince.get(a.pane_id);
      if (!since) statusSince.set(a.pane_id, { status, at: 0 });
      else if (since.status !== status) statusSince.set(a.pane_id, { status, at: Date.now() });
      const meta = session?.file
        ? await sessionMeta(adapterFor(a.agent), session.file)
        : { mtimeMs: 0, desc: null, turnAt: null };
      // last real turn, not file mtime (bookkeeping writes) or status flips
      // (done→idle fires when you merely look at the pane). Status time is
      // only the fallback for panes with no transcript turn yet.
      const lastActiveAt = meta.turnAt ?? (statusSince.get(a.pane_id).at || null);
      return {
        paneId: a.pane_id,
        workspaceId: a.workspace_id,
        tabId: a.tab_id,
        agent: a.agent,
        displayAgent: a.display_agent ?? null,
        label: a.name ?? null,
        title: a.terminal_title_stripped ?? a.terminal_title ?? '',
        status,
        cwd: a.cwd,
        repoRoot,
        focused: !!a.focused,
        launchPending: !!a.launch_pending,
        stateLabels: a.state_labels ?? {},
        revision: a.revision,
        hasTranscript: !!session,
        sessionId: session?.sessionId ?? null,
        sessionTitle: meta.desc?.title ?? null,
        firstPrompt: meta.desc?.firstPrompt ?? null,
        lastActiveAt,
      };
    }));
    const workspaces = (snap.workspaces ?? []).map((w) => ({
      workspaceId: w.workspace_id,
      number: w.number,
      label: w.label,
      focused: !!w.focused,
      status: w.agent_status ?? 'unknown',
      worktree: w.worktree
        ? {
            repoName: w.worktree.repo_name ?? null,
            repoRoot: w.worktree.repo_root ?? null,
            isLinked: !!w.worktree.is_linked_worktree,
            checkoutPath: w.worktree.checkout_path ?? null,
          }
        : null,
    }));
    const tabs = (snap.tabs ?? []).map((t) => ({
      tabId: t.tab_id,
      workspaceId: t.workspace_id,
      number: t.number,
      label: t.label,
      focused: !!t.focused,
      paneCount: t.pane_count,
      status: t.agent_status,
    }));
    // status-transition detection for push (herdr-down blips must not read as
    // "everything resolved", so removals are only derived from a good refresh)
    if (!roster.herdrDown) {
      const prev = new Map(roster.agents.map((a) => [a.paneId, a.status]));
      for (const a of agents) {
        if (prev.get(a.paneId) !== a.status) coordinator.onTransition(a, a.status);
        prev.delete(a.paneId);
      }
      for (const paneId of prev.keys()) {
        coordinator.onRemove(paneId);
        paneProcCache.delete(paneId);
        pinnedSessions.delete(paneId);
        paneBindings.delete(paneId);
        statusSince.delete(paneId);
      }
      // /clear and pane churn leave dead transcript entries; a cold re-read
      // of a dozen heads/tails is cheap, so just drop the lot when it bloats
      if (describeCache.size > 4 * (agents.length + 8)) describeCache.clear();
    }
    roster = { agents, workspaces, tabs, herdrDown: false, updatedAt: Date.now(), build: BUILD, bootedAt: BOOTED_AT };
  } catch (e) {
    roster = { agents: [], workspaces: [], tabs: [], herdrDown: true, error: String(e.message ?? e), updatedAt: Date.now(), build: BUILD, bootedAt: BOOTED_AT };
  }
  const payload = `event: roster\ndata: ${JSON.stringify(roster)}\n\n`;
  for (const res of rosterClients) {
    // A write throwing on a torn-down response would reject this promise,
    // which no caller (setInterval, event debounce) catches.
    try { res.write(payload); } catch { rosterClients.delete(res); }
  }
}

let refreshTimer = null;
function scheduleRefresh() { // debounce bursts of herdr events
  if (refreshTimer) return;
  refreshTimer = setTimeout(() => { refreshTimer = null; refreshRoster(); }, 250);
}

function watchHerdr() {
  subscribe(
    [{ type: 'pane.created' }, { type: 'pane.closed' }, { type: 'pane.updated' },
     { type: 'pane.exited' }, { type: 'pane.agent_detected' },
     { type: 'tab.created' }, { type: 'tab.closed' }, { type: 'tab.renamed' },
     { type: 'tab.moved' }, { type: 'tab.focused' },
     { type: 'workspace.created' }, { type: 'workspace.closed' },
     { type: 'workspace.renamed' }, { type: 'workspace.moved' },
     { type: 'workspace.focused' }],
    () => scheduleRefresh(),
    () => setTimeout(watchHerdr, 2000),
  );
}
watchHerdr();
setInterval(refreshRoster, 5000); // belt & suspenders under the event stream
refreshRoster();

// ---------- transcript resolution ----------

// When did this pane's agent process start? Linux: /proc/<pid>/stat field 22
// (clock ticks since boot, USER_HZ=100) plus btime from /proc/stat. On
// platforms without /proc (mac) this returns null and session correlation
// falls back to title/newest-mtime.
let btimeMs = undefined;
async function bootTimeMs() {
  if (btimeMs !== undefined) return btimeMs;
  try {
    const m = (await fsp.readFile('/proc/stat', 'utf8')).match(/^btime (\d+)$/m);
    btimeMs = m ? Number(m[1]) * 1000 : null;
  } catch {
    btimeMs = null;
  }
  return btimeMs;
}

// The pane's agent process: pid (grok correlates sessions by it — exact match
// against active_sessions.json) and start time (claude's created-since filter).
const paneProcCache = new Map(); // paneId -> {at, pid, startedAt}
async function paneProcess(paneId, kind) {
  const hit = paneProcCache.get(paneId);
  if (hit && Date.now() - hit.at < 30_000) return hit;
  const info = { at: Date.now(), pid: null, startedAt: null };
  try {
    const r = await rpc('pane.process_info', { pane_id: paneId });
    const procs = r.process_info?.foreground_processes ?? [];
    info.pid = (procs.find((p) => p.name === kind) ?? procs[0])?.pid ?? null;
    const btime = await bootTimeMs();
    if (info.pid && btime) {
      const stat = await fsp.readFile(`/proc/${info.pid}/stat`, 'utf8');
      // fields after the parenthesized comm; starttime is field 22 overall
      const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      const ticks = Number(fields[19]);
      if (Number.isFinite(ticks)) info.startedAt = btime + (ticks / 100) * 1000;
    }
  } catch {}
  paneProcCache.set(paneId, info);
  return info;
}

// Panes spawned with an explicit --resume know their session id up front —
// no need to guess the binding from titles/mtimes. paneId -> sessionId,
// cleared when the pane leaves the roster.
const pinnedSessions = new Map();

// What each pane resolved to last time anyone looked: paneId -> {agent,
// cwd, sessionId|null}. Siblings sharing an agent+cwd are correlated as a
// set (allocateSessions), and a single-pane lookup (transcript GET, stream
// re-resolve) excludes whatever its siblings hold, so the two paths can't
// disagree. Before this, two title-less claude panes in one cwd both
// resolved to whichever file was written last — prompt in A, and B's
// stream reset onto A's transcript.
const paneBindings = new Map();

// The session id an agent's herdr integration hook reported for its pane
// (snapshot agent_session) — exact where present. Refreshed with the roster.
const reportedSessions = new Map(); // paneId -> session id

function claimedBySiblings(paneId, agent, cwd) {
  const claimed = new Set();
  for (const [id, b] of paneBindings) {
    if (id !== paneId && b.agent === agent && b.cwd === cwd && b.sessionId) claimed.add(b.sessionId);
  }
  return claimed;
}

// Shared by the roster refresh and the API routes so every caller correlates
// pane → session file the same way. `exclude` is the joint-allocation hook;
// without it the pane's siblings' current bindings are excluded.
async function findSessionFor({ paneId, agent, cwd, title }, { exclude } = {}) {
  const adapter = adapterFor(agent);
  if (!adapter || !cwd) return null;
  const hints = {
    title: title ?? '',
    sessionId: pinnedSessions.get(paneId),
    agentSessionId: reportedSessions.get(paneId),
    exclude: exclude ?? claimedBySiblings(paneId, agent, cwd),
  };
  const p = await paneProcess(paneId, agent);
  // claude: exact pid binding via ~/.claude/sessions/<pid>.json, else the
  // created-since filter. grok: pid against active_sessions.json. codex:
  // herdr's reported session id, else the rollout the pid holds open, else
  // the created-since filter. pi: herdr's reported session file, else the
  // created-since filter.
  hints.pid = p.pid;
  if (agent === 'claude' || agent === 'codex' || agent === 'pi') hints.startedAfter = p.startedAt;
  if (agent === 'grok') hints.startedAt = p.startedAt;
  let session = null;
  try {
    session = await adapter.find(cwd, hints);
  } catch {
    session = null;
  }
  paneBindings.set(paneId, { agent, cwd, sessionId: session?.sessionId ?? null });
  return session;
}

// Correlate a roster's panes together. Panes sharing an agent+cwd go
// youngest process first — its "created since I started" window is the
// narrowest, while the oldest pane's window swallows every younger
// sibling's file — and each pick claims its session so the heuristic tiers
// can't hand the same transcript to two panes. Groups run in parallel.
async function allocateSessions(snapAgents) {
  const out = new Map();
  const groups = new Map();
  for (const a of snapAgents) {
    const key = `${a.agent}\0${a.cwd ?? ''}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(a);
  }
  await Promise.all([...groups.values()].map(async (group) => {
    const procs = await Promise.all(group.map((a) => paneProcess(a.pane_id, a.agent)));
    const order = group
      .map((a, i) => ({ a, started: procs[i].startedAt ?? 0 }))
      .sort((x, y) => y.started - x.started);
    const claimed = new Set();
    for (const { a } of order) {
      const session = await findSessionFor({
        paneId: a.pane_id,
        agent: a.agent,
        cwd: a.cwd,
        title: a.terminal_title_stripped ?? '',
      }, { exclude: claimed });
      if (session) claimed.add(session.sessionId);
      out.set(a.pane_id, session);
    }
  }));
  return out;
}

async function resolveAgent(paneId, { optional = false } = {}) {
  const a = roster.agents.find((x) => x.paneId === paneId);
  if (!a) throw httpErr(404, `no agent in pane ${paneId}`);
  const adapter = adapterFor(a.agent);
  if (!adapter) throw httpErr(422, `no adapter for agent "${a.agent}"`);
  const session = await findSessionFor(a);
  if (!session && !optional) throw httpErr(404, `no session file found for ${a.agent} in ${a.cwd}`);
  return { agent: a, adapter, session };
}

async function readScreen(paneId) {
  const r = await rpc('agent.read', { target: paneId, source: 'visible', format: 'text' });
  return r.read?.text ?? '';
}

// ANSI capture — for checks that need styling to tell user-typed text from
// the TUI's own painted hints (claude's ghost/predictive suggestions).
async function readScreenAnsi(paneId) {
  const r = await rpc('agent.read', { target: paneId, source: 'visible', format: 'ansi' });
  return r.read?.text ?? '';
}

// (classifyBlocked lives in lib/adapters.js; the screen grammars — claude ❯
// menus, grok radio menus, rewind panel, mode footer — live in lib/screen.js.)

// Answer a menu by arrowing the cursor onto the target row and pressing Enter,
// verified against the live screen between steps. Digits are unsafe on claude
// menus with a free-text row (the plan prompt): once ❯ sits in the text field,
// every digit TYPES instead of selecting — that's how a user's taps once
// became "4443" in the feedback box. `feedback` types into the free-text row
// and submits (reject-with-feedback). Returns true, or null when the screen no
// longer holds a matching menu — the caller 409s.
const INPUT_PLACEHOLDER = /^(Tell Claude what to change|Type something\.?)$/;
async function answerByNav(paneId, { option, feedback, kind }) {
  if (kind === 'grok') {
    if (isGrokPlanApproval(await readScreen(paneId))) {
      return answerGrokPlan(paneId, { option, feedback });
    }
    return answerGrokMenu(paneId, { option });
  }
  const read = async () => parseMenuFor(kind, await readScreen(paneId));
  const settle = () => new Promise((r) => setTimeout(r, 300));
  const send = (keys) => agentRpc('agent.send_keys', { target: paneId, keys });
  let menu = await read();
  if (!menu) return null;
  const inputOpt = menu.options.find((o) => o.input);
  const targetN = option ?? inputOpt?.n;
  if (!menu.options.some((o) => o.n === targetN)) return null;
  const keys = [];
  // typed text keeps focus in the input row — clear it or Enter commits junk.
  // Size the clear from the observed row content, not a fixed cap.
  if (inputOpt?.selected) {
    const n = Math.max(100, [...(inputOpt.label ?? '')].length + 20);
    for (let i = 0; i < n; i += 1) keys.push('Backspace');
  }
  const sel = (menu.options.find((o) => o.selected) ?? menu.options[0]).n;
  for (let i = 0; i < Math.abs(targetN - sel); i += 1) keys.push(targetN > sel ? 'Down' : 'Up');
  if (keys.length) {
    await send(keys);
    await settle();
    menu = await read();
    if (!menu?.options.find((o) => o.n === targetN)?.selected) return null;
  }
  if (feedback != null) {
    // spread, not split(''): split would break astral chars into lone surrogates
    const chars = [...feedback.replace(/\s+/g, ' ').trim()]
      .map((c) => (c === ' ' ? 'space' : c));
    if (chars.length) {
      await send(chars);
      await settle();
      // keystrokes can race the row-focus and get dropped wholesale — an
      // untouched placeholder means nothing landed, so don't Enter on it
      const row = (await read())?.options.find((o) => o.n === targetN);
      if (!row || INPUT_PLACEHOLDER.test(row.label)) return null;
    }
  }
  await send(['Enter']);
  return true;
}

// Grok radio menus: a bare digit selects the row, and on permission prompts
// ("1/3:select") submits it outright; ask/picker menus want an Enter after.
// Press the digit, then Enter only if the menu is still up with the target
// selected — covers both without double-answering. Free-text feedback isn't
// wired for grok yet; callers get a 409 and fall back to typing a prompt.
async function answerGrokMenu(paneId, { option }) {
  const read = async () => parseMenuFor('grok', await readScreen(paneId));
  const settle = () => new Promise((r) => setTimeout(r, 300));
  let menu = await read();
  if (!menu || option == null) return null;
  if (!menu.options.some((o) => o.n === option && !o.input)) return null;
  await agentRpc('agent.send_keys', { target: paneId, keys: [String(option)] });
  await settle();
  menu = await read();
  if (menu?.options.find((o) => o.n === option)?.selected) {
    await agentRpc('agent.send_keys', { target: paneId, keys: ['Enter'] });
  }
  return true;
}

// Grok plan.md preview: letter keys, not digits. Esc parks focus on the
// preview (from the prompt or an in-progress comment) — it does not quit.
// 1 → a (approve), 3 → q (quit); feedback types into the prompt via s.
const GROK_PLAN_KEYS = { 1: 'a', 3: 'q' };
async function answerGrokPlan(paneId, { option, feedback }) {
  const settle = () => new Promise((r) => setTimeout(r, 300));
  const send = (keys) => agentRpc('agent.send_keys', { target: paneId, keys });
  const stillUp = async () => isGrokPlanApproval(await readScreen(paneId));
  if (!(await stillUp())) return null;
  await send(['Escape']);
  await settle();
  if (!(await stillUp())) return null;
  if (feedback != null) {
    await send(['s']);
    await settle();
    if (!(await stillUp())) return null;
    const chars = [...feedback.replace(/\s+/g, ' ').trim()]
      .map((c) => (c === ' ' ? 'space' : c));
    if (chars.length) {
      await send(chars);
      await settle();
    }
    await send(['Enter']);
    return true;
  }
  const key = GROK_PLAN_KEYS[option];
  if (!key) return null;
  await send([key]);
  return true;
}

// ---------- rewind (claude) ----------

async function rewindOp(paneId, { op, index, option }) {
  const read = async () => parseRewindScreen(await readScreen(paneId));
  const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));
  if (op === 'open') {
    let state = await read(); // maybe already open (e.g. opened in the TUI)
    if (!state) {
      const live = await rpc('agent.get', { target: paneId });
      const st = live.agent?.agent_status;
      if (st === 'working' || st === 'blocked') {
        throw httpErr(409, `agent is ${st} — rewind needs an idle session`);
      }
      // /rewind must land on an empty composer or it concatenates with the
      // draft. Style-aware: claude paints its predictive/ghost suggestions in
      // gray — only USER-typed (unstyled) text blocks the open.
      const draft = typedComposerText(await readScreenAnsi(paneId));
      if (draft) {
        throw httpErr(409, `text is sitting on the TUI composer — clear it first ("${draft.slice(0, 60)}")`);
      }
      await agentRpc('agent.prompt', { target: paneId, text: '/rewind' });
      for (let i = 0; i < 12 && !state; i += 1) {
        await settle();
        state = await read();
      }
    }
    if (!state) throw httpErr(502, 'rewind panel never appeared');
    if (state.step === 'empty') {
      // don't leave the useless panel stranded on the TUI
      await agentRpc('agent.send_keys', { target: paneId, keys: ['Escape'] });
      throw httpErr(409, 'nothing to rewind to yet');
    }
    return state;
  }
  if (op === 'select') {
    if (!Number.isInteger(index)) throw httpErr(400, 'index: integer');
    let state = await read();
    if (state?.step !== 'list') throw httpErr(409, 'no rewind list on screen');
    const target = state.checkpoints[index];
    if (!target) throw httpErr(409, 'no such checkpoint');
    const from = state.checkpoints.findIndex((c) => c.selected);
    if (index !== from) {
      const keys = Array.from({ length: Math.abs(index - from) }, () => (index > from ? 'Down' : 'Up'));
      await agentRpc('agent.send_keys', { target: paneId, keys });
      await settle();
      state = await read();
      // verify by message text, not index — a scrolling list shifts the window
      const sel = state?.step === 'list' ? state.checkpoints.find((c) => c.selected) : null;
      if (!sel || sel.message !== target.message) throw httpErr(409, 'screen changed');
    }
    await agentRpc('agent.send_keys', { target: paneId, keys: ['Enter'] });
    for (let i = 0; i < 8; i += 1) {
      await settle();
      const next = await read();
      if (next?.step === 'confirm') return next;
    }
    throw httpErr(502, 'confirm step never appeared');
  }
  if (op === 'confirm') {
    if (!Number.isInteger(option)) throw httpErr(400, 'option: integer');
    const state = await read();
    if (state?.step !== 'confirm') throw httpErr(409, 'no rewind confirm on screen');
    if (!(await answerByNav(paneId, { option }))) throw httpErr(409, 'screen changed');
    // A conversation-restore prefills the TUI composer with the rewound
    // message; stranded there it would concatenate with the next web prompt.
    // Capture it, clear it, hand it back as a draft for the web composer.
    await settle(900);
    const draft = composerText(await readScreen(paneId));
    if (draft) {
      // clear count sized from the draft itself — a fixed cap strands the tail
      // of a long restored message in the TUI composer
      const n = Math.max(300, [...draft].length + 40);
      await agentRpc('agent.send_keys', {
        target: paneId,
        keys: Array.from({ length: n }, () => 'Backspace'),
      });
    }
    return { ok: true, draft: draft || null };
  }
  if (op === 'cancel') {
    if (await read()) await agentRpc('agent.send_keys', { target: paneId, keys: ['Escape'] });
    return { step: 'closed' };
  }
  throw httpErr(400, 'op: open|select|confirm|cancel');
}

// ---------- permission mode (claude) ----------
// herdr's "Shift+Tab" key name is accepted but claude never sees a backtab —
// send raw CSI Z instead. The three keys land in one send_keys rpc → one pty
// write → parsed as shift+tab. (Split across writes the bare Escape would
// interrupt the turn; verified stable across many presses, and the verify
// loop below catches a press that didn't take.) NOT valid for grok: its TUI
// types the raw `[Z` into the composer instead of decoding a backtab.
const SHIFT_TAB_KEYS = ['Escape', '[', 'Z'];

// Set the mode by verified shift+tab cycling: read footer → press → re-read,
// never more than a full ring. Refuses while blocked — shift+tab is
// overloaded on prompts (plan prompt: "approve with this feedback"; write
// prompts: "allow all edits this session"), so a press there answers the
// prompt instead of cycling. Same read-verify-act contract as answerByNav.
async function setMode(paneId, target) {
  const a = roster.agents.find((x) => x.paneId === paneId);
  if (a && a.agent !== 'claude') throw httpErr(422, `no permission modes for "${a.agent}"`);
  const live = await rpc('agent.get', { target: paneId });
  if (live.agent?.agent_status === 'blocked') {
    throw httpErr(409, 'agent is waiting on a prompt — answer it first');
  }
  let first = null;
  for (let i = 0; i < 6; i += 1) {
    const screen = await readScreen(paneId);
    if (parseMenuScreen(screen)) {
      throw httpErr(409, 'a menu is on screen — answer it first');
    }
    const cur = parseMode(screen);
    if (cur === target) return cur;
    if (cur === 'unknown') throw httpErr(409, "can't read the current mode off the screen");
    if (first === null) first = cur;
    else if (cur === first) break; // wrapped the ring without hitting target
    await agentRpc('agent.send_keys', { target: paneId, keys: SHIFT_TAB_KEYS });
    await new Promise((r) => setTimeout(r, 350));
  }
  const err = httpErr(409, `"${target}" isn't reachable in this session's mode cycle`);
  err.mode = parseMode(await readScreen(paneId));
  throw err;
}

// The plan prompt's footer names the saved plan file ("ctrl+g to edit in VS
// Code · ~/.claude/plans/….md") — the only place the plan markdown is
// readable while the prompt is up.
async function attachPlanFile(ctx, screen) {
  const m = screen.match(/[~/]\S*\/\.claude\/plans\/\S+\.md/);
  if (!m) return;
  try {
    const file = m[0].replace(/^~(?=\/)/, os.homedir());
    ctx.plan = (await fsp.readFile(file, 'utf8')).slice(0, 20_000);
    ctx.planFile = m[0];
  } catch {}
}

// grok writes the plan to the session dir, not a path advertised on screen.
async function attachGrokPlanFile(ctx, session) {
  if (ctx.plan || !session?.file) return;
  try {
    ctx.plan = (await fsp.readFile(path.join(path.dirname(session.file), 'plan.md'), 'utf8')).slice(0, 20_000);
  } catch {}
}

// ~/.grok/sessions/<cwd>/<id>/plan_mode.json — the cheap roster signal that
// grok is sitting on the approval overlay while herdr still says "working".
async function grokPlanWaiting(session) {
  if (!session?.file) return false;
  try {
    const j = JSON.parse(await fsp.readFile(path.join(path.dirname(session.file), 'plan_mode.json'), 'utf8'));
    return j.awaiting_plan_approval === true;
  } catch {
    return false;
  }
}

// What is the agent blocked ON? Session file first (pending tool_use), then
// the visible screen parsed for a numbered menu. Shared by the API route and
// the push coordinator (the notification body carries the question).
async function blockedContext(paneId) {
  const { agent, adapter, session } = await resolveAgent(paneId, { optional: true });
  // live status, not the roster cache — the cache can lag the event
  const live = await rpc('agent.get', { target: paneId });
  const herdrBlocked = live.agent?.agent_status === 'blocked';
  if (!herdrBlocked) {
    // grok plan approval: herdr stays working while the TUI waits on a/s/q
    if (agent.agent === 'grok' && live.agent?.agent_status === 'working') {
      try {
        const grokPlan = parseGrokPlanApproval(await readScreen(paneId));
        if (grokPlan) {
          await attachGrokPlanFile(grokPlan, session);
          return grokPlan;
        }
      } catch {}
    }
    return { kind: 'none' };
  }
  // no session file yet (fresh session) → straight to the screen parser
  const { events } = session ? await readEvents(adapter, session.file, 0) : { events: [] };
  let ctx = classifyBlocked(events);
  if (ctx.kind === 'unknown') {
    const screen = await readScreen(paneId);
    const grokPlan = agent.agent === 'grok' ? parseGrokPlanApproval(screen) : null;
    if (grokPlan) {
      ctx = grokPlan;
      await attachGrokPlanFile(ctx, session);
    } else {
      const menu = parseMenuFor(agent.agent, screen);
      // no pending tool_use to name the tool (claude flushes ExitPlanMode to the
      // session file only with its result), but a feedback row on a claude menu
      // can only be the plan-approval prompt (grok ask menus carry one too —
      // their pending tool_call classifies above, so they never reach here)
      if (agent.agent === 'claude' && menu?.form !== 'ask' && menu?.options.some((o) => o.input)) {
        ctx = { kind: 'plan', plan: '', question: menu.question, options: menu.options };
        await attachPlanFile(ctx, screen);
      } else {
        ctx = menu ?? { kind: 'unknown' };
      }
    }
  } else if (ctx.kind === 'permission' || ctx.kind === 'plan') {
    // permission prompts aren't uniform (Yes/No vs Yes/Yes-always/No…) — read
    // the real options off the screen so an answer can't hit the wrong number;
    // when nothing parses, callers must not guess digits. grok plan approval
    // is a letter-key overlay, not a radio menu.
    try {
      const screen = await readScreen(paneId);
      const grokPlan = agent.agent === 'grok' ? parseGrokPlanApproval(screen) : null;
      if (grokPlan) {
        ctx.options = grokPlan.options;
        ctx.question = grokPlan.question;
        ctx.dialect = 'grok';
        if (grokPlan.comments) ctx.comments = grokPlan.comments;
      } else {
        const menu = parseMenuFor(agent.agent, screen);
        if (menu) {
          ctx.options = menu.options;
          if (ctx.kind === 'plan') ctx.question = menu.question;
        }
      }
      if (ctx.kind === 'plan' && !ctx.plan) {
        await attachPlanFile(ctx, screen);
        await attachGrokPlanFile(ctx, session);
      }
    } catch {}
  }
  return ctx;
}


// ---------- projects ----------
// "Project" = a git repo (identified by its main checkout root) or, for
// non-repo panes, a bare directory. Sources: live roster cwds, workspace
// checkouts, and the dirs encoded in ~/.claude/projects — a free index of
// everywhere claude has ever run.

const gitRootCache = new Map(); // dir -> {at, root}
async function gitRootOf(dir) {
  if (!dir) return null;
  const hit = gitRootCache.get(dir);
  if (hit && Date.now() - hit.at < 60_000) return hit.root;
  let root = null;
  let cur = path.resolve(dir);
  for (;;) {
    try {
      await fsp.access(path.join(cur, '.git'));
      root = cur;
      break;
    } catch {}
    const up = path.dirname(cur);
    if (up === cur) break;
    cur = up;
  }
  gitRootCache.set(dir, { at: Date.now(), root });
  return root;
}

// ~/.claude/projects encodes /home/armen/src/herdr-web as
// -home-armen-src-herdr-web: every / AND every literal - become '-'. Decode by
// DFS over "next dash is a separator or part of the name", pruning on
// directory existence. Shorter components are tried first, so nesting wins
// over dashed names when both exist.
const decodeCache = new Map(); // encoded -> path|null
async function decodeClaudeProjectDir(encoded) {
  if (decodeCache.has(encoded)) return decodeCache.get(encoded);
  const parts = encoded.replace(/^-/, '').split('-');
  let found = null;
  async function walk(base, i) {
    if (found) return;
    if (i === parts.length) {
      found = base;
      return;
    }
    let comp = '';
    for (let j = i; j < parts.length && !found; j += 1) {
      // strict slice-join: a `--` run yields an empty part, and the old
      // `comp ? … : parts[j]` treated that as "not started yet", making a
      // component with a leading dash (-home-…) undecodable
      comp = j === i ? parts[j] : `${comp}-${parts[j]}`;
      if (!comp) continue; // no empty path components; '' only arises mid-accumulation
      const cand = path.join(base, comp);
      try {
        if ((await fsp.stat(cand)).isDirectory()) await walk(cand, j + 1);
      } catch {}
    }
  }
  if (encoded.startsWith('-')) await walk('/', 0);
  decodeCache.set(encoded, found);
  return found;
}

async function listProjects() {
  // dir -> {live, lastActive}
  const seen = new Map();
  const note = (dir, { live = 0, lastActive = 0 } = {}) => {
    if (!dir) return;
    const cur = seen.get(dir) ?? { live: 0, lastActive: 0 };
    cur.live += live;
    cur.lastActive = Math.max(cur.lastActive, lastActive);
    seen.set(dir, cur);
  };
  for (const a of roster.agents) note(a.cwd, { live: 1, lastActive: roster.updatedAt });
  for (const w of roster.workspaces ?? []) note(w.worktree?.checkoutPath);
  try {
    const base = path.join(os.homedir(), '.claude', 'projects');
    for (const ent of await fsp.readdir(base, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue;
      const dir = await decodeClaudeProjectDir(ent.name);
      if (!dir) continue;
      const st = await fsp.stat(path.join(base, ent.name)).catch(() => null);
      note(dir, { lastActive: st?.mtimeMs ?? 0 });
    }
  } catch {}
  // collapse to repo identity where the dir is inside a repo
  const projects = new Map(); // key -> project
  for (const [dir, info] of seen) {
    const root = await gitRootOf(dir);
    const key = root ?? dir;
    const p = projects.get(key) ?? {
      key,
      path: key,
      name: path.basename(key),
      repo: !!root,
      live: 0,
      lastActive: 0,
      dirs: [],
    };
    p.live += info.live;
    p.lastActive = Math.max(p.lastActive, info.lastActive);
    if (!p.dirs.includes(dir)) p.dirs.push(dir);
    projects.set(key, p);
  }
  return [...projects.values()].sort(
    (a, b) => b.live - a.live || b.lastActive - a.lastActive || a.name.localeCompare(b.name),
  );
}

// worktree.list is repo-anchored: it wants a cwd inside the repo.
async function listWorktrees(cwd) {
  const r = await rpc('worktree.list', { cwd });
  return {
    repoKey: r.source?.repo_key ?? null,
    repoName: r.source?.repo_name ?? null,
    repoRoot: r.source?.repo_root ?? null,
    worktrees: (r.worktrees ?? []).map((t) => ({
      path: t.path,
      branch: t.branch ?? null,
      label: t.label,
      openWorkspaceId: t.open_workspace_id ?? null,
      isLinked: !!t.is_linked_worktree,
    })),
  };
}

// ---------- new chats ----------

// Agent kinds come from herdr's detection manifests (all *supported* kinds);
// "installed" = the canonical executable (named after the kind) is findable,
// so the picker can dim what would fail to start. agent.start runs through
// the pane's login shell, not this daemon — under systemd our PATH is
// minimal — so also probe the usual install dirs.
async function listKinds() {
  const r = await rpc('server.agent_manifests');
  const dirs = [...new Set([
    ...(process.env.PATH ?? '').split(path.delimiter),
    path.join(os.homedir(), '.local', 'bin'),
    path.join(os.homedir(), 'bin'),
    '/usr/local/bin',
    '/opt/homebrew/bin',
    '/home/linuxbrew/.linuxbrew/bin',
  ])].filter(Boolean);
  return Promise.all((r.manifests ?? []).map(async (m) => {
    let installed = false;
    for (const d of dirs) {
      try {
        await fsp.access(path.join(d, m.agent), fsConstants.X_OK);
        installed = true;
        break;
      } catch {}
    }
    return { kind: m.agent, version: m.active_version ?? null, installed };
  }));
}

// herdr agent names must match ^[a-z][a-z0-9_-]{0,31}$ — fold whatever the
// user typed into that ("My cool chat" → "my-cool-chat"). Returns '' when
// nothing survives; callers fall back to a generated name. The pretty
// original still goes on the tab label, which herdr doesn't constrain.
function cleanAgentName(raw) {
  return (raw ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^[^a-z]+/, '')
    .replace(/-{2,}/g, '-')
    .replace(/-+$/, '')
    .slice(0, 32);
}

// tab.create (or workspace.create / worktree.create / worktree.open) →
// agent.start → wait until the agent is promptable. agent.start only means
// herdr *detected* the process (often still launch_pending); prompts are
// refused with "not an active named agent" until interactive_ready flips
// true a few seconds later. We hold the create response until then so the
// first message from the web UI doesn't race that window. On failure the
// pane we just made is closed again so misfires don't litter the TUI with
// empty shells.
//
// worktree: { repoCwd, branch?, base?, path? } — create (or open, when `path`
// names an existing checkout) a worktree-bound workspace and start there.
//
// resume: a session uuid — spawns with --resume (claude and grok both take
// it; codex spells it `codex resume <id>`, pi `--session <id>`) and pins the pane's transcript
// binding to that session, skipping the
// title/mtime guesswork (a resumed file is old, so the
// created-since-process-start filter in claudeFindSession would otherwise
// reject it until the ai-title lands).
async function createChat({ kind, name, cwd, workspaceId, label, args, worktree, resume } = {}) {
  if (!kind || typeof kind !== 'string') throw httpErr(400, 'kind required');
  if (resume !== undefined) {
    if (!['claude', 'grok', 'codex', 'pi'].includes(kind)) throw httpErr(400, `resume not supported for ${kind}`);
    if (typeof resume !== 'string' || !/^[\w-]+$/.test(resume)) throw httpErr(400, 'resume: session id');
    args = kind === 'codex' ? ['resume', resume, ...(args ?? [])]
      : [...(args ?? []), kind === 'pi' ? '--session' : '--resume', resume];
  }
  const untilde = (s) => (s ? s.replace(/^~(?=\/|$)/, os.homedir()) : null);
  const dir = untilde(cwd);
  const opts = { cwd: dir, label: label || null, focus: false };
  let ws = workspaceId || null;
  let pane = null;
  let tab = null;
  if (!ws && worktree) {
    if (!worktree.repoCwd) throw httpErr(400, 'worktree.repoCwd required');
    const params = { cwd: untilde(worktree.repoCwd), focus: false };
    let r;
    if (worktree.path) {
      r = await rpc('worktree.open', { ...params, path: untilde(worktree.path) });
      if (r.already_open) {
        // don't agent.start into the workspace's existing shell — add a tab,
        // cwd'd into the checkout
        ws = r.workspace?.workspace_id;
        opts.cwd = r.worktree?.path ?? untilde(worktree.path);
      }
    } else {
      if (!worktree.branch) throw httpErr(400, 'worktree.branch required');
      r = await rpc('worktree.create', {
        ...params,
        branch: worktree.branch,
        base: worktree.base ?? null,
      });
    }
    if (!ws) {
      ws = r.workspace?.workspace_id;
      pane = r.root_pane ?? null;
      tab = r.tab ?? null;
      opts.cwd = null; // the worktree checkout is the pane's cwd already
    }
  }
  if (!ws) {
    const r = await rpc('workspace.create', opts);
    ws = r.workspace?.workspace_id;
    pane = r.root_pane ?? null;
    tab = r.tab ?? null;
  }
  if (!pane) {
    const r = await rpc('tab.create', { ...opts, workspace_id: ws });
    pane = r.root_pane;
    tab = r.tab ?? null;
  }
  if (resume) pinnedSessions.set(pane.pane_id, resume);
  // pane ids can carry uppercase (w1:pC) — lowercase the generated fallback
  // or it fails herdr's name rule
  const agentName =
    cleanAgentName(name) || `${kind}-${pane.pane_id.replace(/\W+/g, '').toLowerCase()}`;
  // A fresh pane's shell takes a beat to come up; herdr rejects agent.start
  // with "not an available shell" until then, so retry that specific error.
  const startedAt = Date.now();
  for (;;) {
    try {
      await rpc(
        'agent.start',
        { name: agentName, kind, pane_id: pane.pane_id, args: args ?? [] },
        { timeoutMs: 45_000 },
      );
      break;
    } catch (e) {
      const msg = String(e.message ?? e);
      if (/not an available shell/i.test(msg) && Date.now() - startedAt < 10_000) {
        await new Promise((r) => setTimeout(r, 500));
        continue;
      }
      pinnedSessions.delete(pane.pane_id);
      try { await rpc('pane.close', { pane_id: pane.pane_id }); } catch {}
      throw httpErr(502, `couldn't start ${kind}: ${msg}`);
    }
  }
  try {
    await waitAgentPromptable(pane.pane_id);
    // A fresh grok in a directory it hasn't seen before opens a full-screen
    // "Run Grok Build in a project directory?" picker that swallows any
    // prompt sent under it. The caller already chose the directory — answer
    // option 1 (current dir) on their behalf. (option digit selects the radio
    // row; Enter submits.)
    if (kind === 'grok') {
      for (let i = 0; i < 8; i += 1) {
        if (!isGrokProjectPicker(await readScreen(pane.pane_id))) break;
        await agentRpc('agent.send_keys', { target: pane.pane_id, keys: ['1'] });
        await new Promise((r) => setTimeout(r, 400));
        await agentRpc('agent.send_keys', { target: pane.pane_id, keys: ['Enter'] });
        await new Promise((r) => setTimeout(r, 600));
      }
    }
  } catch (e) {
    console.error(`createChat ${kind} ${pane.pane_id}: ${e.message ?? e}`);
    pinnedSessions.delete(pane.pane_id);
    try { await rpc('pane.close', { pane_id: pane.pane_id }); } catch {}
    throw httpErr(502, `couldn't start ${kind}: ${e.message ?? e}`);
  }
  // The label param on tab/workspace.create is ignored and launch-time agent
  // names can be dropped once detection settles — rename explicitly instead.
  // Tab gets the user's text verbatim; the agent gets the cleaned form.
  if ((name ?? '').trim()) {
    if (tab) await rpc('tab.rename', { tab_id: tab.tab_id, label: name.trim() }).catch(() => {});
    if (cleanAgentName(name)) {
      await rpc('agent.rename', { target: pane.pane_id, name: cleanAgentName(name) }).catch(() => {});
    }
  }
  refreshRoster();
  return { paneId: pane.pane_id, tabId: tab?.tab_id ?? null, workspaceId: ws };
}

// agent.start returns before detection settles; agent.prompt fails with
// "not an active named agent" until the pane has an agent + a real status.
// (herdr 0.8+ no longer sets interactive_ready on a fresh idle launch — see
// isPromptable.) Poll agent.get so createChat doesn't hand back a pane the
// client can't talk to yet.
// Promptable by status isn't the whole story: agent.prompt is also refused
// while `launch_pending` is set, and a hook-authority agent (pi, codex) sits
// on idle+launch_pending until its own startup report lands, ~4-7s after
// agent.start. A client that sends its first message the moment create
// returns hit that window every time. Hold on for the flag too, but only
// for a while — a pane whose report got lost is still alive (see promptRaw).
async function waitAgentPromptable(paneId, { timeoutMs = 15_000, pendingMs = 10_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  let promptableAt = 0;
  while (Date.now() < deadline) {
    try {
      const r = await rpc('agent.get', { target: paneId });
      const a = r.agent ?? r;
      last = a;
      if (isPromptable(a)) {
        promptableAt ||= Date.now();
        if (!a.launch_pending || Date.now() - promptableAt > pendingMs) return a;
      }
    } catch (e) {
      last = e;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  const detail = last?.message ?? (last ? `status=${last.agent_status} ready=${last.interactive_ready}` : '');
  throw new Error(`agent never became promptable${detail ? ` (${detail})` : ''}`);
}

// Grok's fullscreen viewer overlays swallow injected prompts (see
// isGrokModalOverlay). Close one before typing. Escape goes ONLY when the
// footer signature is on screen, so a busy agent can never be interrupted by
// mistake; loops because a `/` we typed earlier may have opened the viewer's
// own search box, which takes the first Esc.
async function dismissOverlay(paneId, kind) {
  if (kind !== 'grok') return;
  try {
    for (let i = 0; i < 3; i += 1) {
      if (!isGrokModalOverlay(await readScreen(paneId))) return;
      console.warn(`fullscreen overlay owns ${paneId} — sending Escape`);
      await agentRpc('agent.send_keys', { target: paneId, keys: ['Escape'] });
      await new Promise((r) => setTimeout(r, 300));
    }
  } catch {}
}

// agent.prompt acking does not mean the text arrived. Three known failures:
// claude occasionally eats the trailing Enter (text stranded on the
// composer), grok drops the whole burst when the prompt races the TUI's
// input loop right after launch — interactive_ready is already true but the
// launch splash still owns the screen and the keys go nowhere — and grok's
// fullscreen viewer swallows the text entirely while it's open. Peek at the
// screen shortly after and heal all three: nudge Enter when stranded, retype
// when vanished, Escape the overlay first when one owns the pane. Screen grammar this relies on: grok's composer is boxed
// (`│ ❯ …`), its sent-message echo is a bare `❯ …`; claude's composer is a
// bare `❯ …` and its echo uses `>`. Retype ONLY while the pane still looks
// untouched (empty composer + agent not busy) so a slow-rendering send or a
// user typing in the TUI can never be double-sent.
async function verifyPromptLanded(paneId, text, attempt = 1) {
  await new Promise((r) => setTimeout(r, 800 * attempt));
  const head = text.trim().split('\n')[0].replace(/\s+/g, ' ').slice(0, 20).trim();
  if (!head) return;
  try {
    const screen = await readScreen(paneId);
    const lines = screen.split('\n');
    const textOf = (l) => l.replace(/^.*❯/, '').replace(/│\s*$/, '').replace(/\s+/g, ' ').trim();
    const boxed = (l) => /│\s*❯/.test(l);
    const norm = (s) => s.replace(/\s+/g, ' ');
    // stranded on a composer → the Enter got eaten; nudge. (If the text
    // cleared between read and nudge, Enter on an empty composer is a no-op.)
    const kind = roster.agents.find((x) => x.paneId === paneId)?.agent;
    // codex: the composer is the LAST ›-line (earlier ones are sent echoes).
    // Nudge a stranded prompt; no retype tier — an empty codex composer
    // shows placeholder text a plain capture can't tell from a user's draft.
    if (kind === 'codex') {
      if (norm(codexComposerText(screen) ?? '').startsWith(head)) {
        console.warn(`prompt stranded on input line of ${paneId} — nudging with Enter`);
        await agentRpc('agent.send_keys', { target: paneId, keys: ['Enter'] });
      }
      return;
    }
    // pi: no prompt glyph — the composer is the rows between the last two
    // ─ rules. Same nudge-only policy as codex.
    if (kind === 'pi') {
      if (norm(piComposerText(screen) ?? '').trim().startsWith(head)) {
        console.warn(`prompt stranded on input line of ${paneId} — nudging with Enter`);
        await agentRpc('agent.send_keys', { target: paneId, keys: ['Enter'] });
      }
      return;
    }
    const stranded = lines.some((l) => {
      if (!l.includes('❯') || !textOf(l).startsWith(head)) return false;
      return kind === 'grok' ? boxed(l) : true; // grok's bare ❯ is a sent echo
    });
    if (stranded) {
      console.warn(`prompt stranded on input line of ${paneId} — nudging with Enter`);
      await agentRpc('agent.send_keys', { target: paneId, keys: ['Enter'] });
      return;
    }
    // any other trace of the text on screen (sent echo, streaming turn) or a
    // busy agent means it landed — done.
    if (lines.some((l) => norm(l).includes(head))) return;
    // a dialog/menu owns the screen (startup picker, permission prompt whose
    // status hasn't flipped yet) — retyping would type into it; hands off
    if (parseMenuFor(kind, screen)) return;
    // grok's fullscreen viewer swallowed the keys — close it before the
    // retype below can feed it more hotkey characters
    if (kind === 'grok' && isGrokModalOverlay(screen)) await dismissOverlay(paneId, kind);
    const a = (await rpc('agent.get', { target: paneId }).catch(() => ({}))).agent ?? {};
    if (a.agent_status && !['idle', 'done', 'unknown'].includes(a.agent_status)) return;
    // composer holds other text (user typing in the TUI?) — hands off
    if (lines.some((l) => l.includes('❯') && textOf(l) && (kind !== 'grok' || boxed(l)))) return;
    if (attempt >= 3) {
      console.warn(`prompt to ${paneId} never landed — gave up after ${attempt} attempts`);
      return;
    }
    console.warn(`prompt to ${paneId} vanished — retyping (attempt ${attempt + 1})`);
    await agentRpc('agent.prompt', { target: paneId, text });
    await verifyPromptLanded(paneId, text, attempt + 1);
  } catch {}
}

// herdr transiently refuses agent-targeted input while launch_pending (and
// around later launch-record expiry) with "not an active named agent" for a
// live pane. Retry across the ~3s window rather than failing the first tap.
async function agentRpc(method, params) {
  const deadline = Date.now() + 5_000;
  for (;;) {
    try {
      return await rpc(method, params);
    } catch (e) {
      if (!isNotReady(e)) throw e;
      if (Date.now() >= deadline) throw e;
      await new Promise((r) => setTimeout(r, 300));
    }
  }
}

const isNotReady = (e) => /not an active named agent/i.test(String(e?.message ?? e));

// agent.prompt refused for a pane that is plainly alive. Agents whose
// integration holds "full lifecycle hook authority" (pi, codex: herdr skips
// screen detection for them) only leave launch_pending when a state report
// arrives FROM INSIDE THE PANE — outside pane.report_agent calls are
// accepted but don't clear it (measured 2026-10-19), and pi's extension
// sends its one startup report with a two-second budget and no retry. Lose
// that report and the pane is a healthy idle TUI herdr refuses prompts for
// until the launch record expires minutes later (seen live: a web-launched
// pi, every prompt 500). The raw channel is never gated, so paste the prompt
// straight into the composer: the turn it starts makes the extension report
// `working` from inside, which clears the flag for every later prompt.
async function promptRaw(paneId, text) {
  let a = null;
  try {
    const r = await rpc('agent.get', { target: paneId });
    a = r.agent ?? r;
  } catch {}
  if (!a?.launch_pending || !a.screen_detection_skipped || a.agent_status !== 'idle') return false;
  await rpc('pane.send_text', { pane_id: paneId, text: `\x1b[200~${text}\x1b[201~` });
  await new Promise((r) => setTimeout(r, 150));
  await rpc('pane.send_keys', { pane_id: paneId, keys: ['enter'] });
  console.error(`prompt pasted raw into ${paneId}: ${a.agent} still launch_pending`);
  return true;
}

// ---------- file viewer ----------
// Read-only peek at files on this machine for the web UI's file overlay.
// Same trust boundary as the rest of the API — the token already gates a UI
// that can ask an agent to read anything — so no path jail, just no writes.

const TEXT_MAX = 512 * 1024;
const IMG_MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.avif': 'image/avif',
  '.ico': 'image/x-icon', '.bmp': 'image/bmp',
};
const VIDEO_MIME = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
};
const AUDIO_MIME = {
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.wav': 'audio/wav',
  '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.flac': 'audio/flac', '.opus': 'audio/ogg',
};

function resolveUserPath(url) {
  const p = url.searchParams.get('path');
  if (!p) throw httpErr(400, 'path required');
  const home = os.homedir();
  const untilde = (s) => s.replace(/^~(?=\/|$)/, home);
  return path.resolve(untilde(url.searchParams.get('cwd') || home), untilde(p));
}

function fsErr(e) {
  if (e?.code === 'ENOENT' || e?.code === 'ENOTDIR') return httpErr(404, 'no such file');
  if (e?.code === 'EACCES' || e?.code === 'EPERM') return httpErr(403, 'permission denied');
  return e;
}

async function fileInfo(url) {
  const target = resolveUserPath(url);
  let st;
  try { st = await fsp.stat(target); } catch (e) { throw fsErr(e); }
  const base = { path: target, size: st.size, mtime: st.mtimeMs };
  if (st.isDirectory()) {
    let ents;
    try { ents = await fsp.readdir(target, { withFileTypes: true }); } catch (e) { throw fsErr(e); }
    const entries = ents
      .map((d) => ({ name: d.name, dir: d.isDirectory() }))
      .sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
    return { ...base, kind: 'dir', entries: entries.slice(0, 1000), clipped: ents.length > 1000 };
  }
  if (!st.isFile()) return { ...base, kind: 'special' };
  const ext = path.extname(target).toLowerCase();
  if (IMG_MIME[ext]) return { ...base, kind: 'image' };
  if (VIDEO_MIME[ext]) return { ...base, kind: 'video' };
  if (AUDIO_MIME[ext]) return { ...base, kind: 'audio' };
  let fh;
  try { fh = await fsp.open(target); } catch (e) { throw fsErr(e); }
  try {
    const buf = Buffer.alloc(Math.min(st.size, TEXT_MAX));
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    if (buf.subarray(0, Math.min(bytesRead, 8192)).includes(0)) return { ...base, kind: 'binary' };
    return {
      ...base,
      kind: 'text',
      content: buf.subarray(0, bytesRead).toString('utf8'),
      truncated: st.size > TEXT_MAX,
    };
  } finally {
    await fh.close();
  }
}

// Streams straight off disk and honours a single byte range: iOS Safari
// refuses to play a <video> whose server can't answer `Range: bytes=0-1`
// with a 206, and a Wan render can be well past anything worth buffering.
async function serveRawFile(req, url, res) {
  const target = resolveUserPath(url);
  let st;
  try {
    st = await fsp.stat(target);
    if (!st.isFile()) throw httpErr(422, 'not a regular file');
  } catch (e) {
    throw fsErr(e);
  }
  const ext = path.extname(target).toLowerCase();
  const headers = {
    'content-type': IMG_MIME[ext] ?? VIDEO_MIME[ext] ?? AUDIO_MIME[ext] ?? MIME[ext] ?? 'application/octet-stream',
    'cache-control': 'no-store',
    'accept-ranges': 'bytes',
    // a hostile file (e.g. an svg an agent downloaded) must not script our origin
    'content-security-policy': 'sandbox',
    'x-content-type-options': 'nosniff',
  };
  let start = 0;
  let end = st.size - 1;
  let status = 200;
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  if (m && (m[1] || m[2])) {
    if (m[1]) {
      start = Number(m[1]);
      if (m[2]) end = Math.min(Number(m[2]), end);
    } else {
      start = Math.max(0, st.size - Number(m[2])); // suffix: last N bytes
    }
    if (start > end || start >= st.size) {
      res.writeHead(416, { 'content-range': `bytes */${st.size}` });
      return res.end();
    }
    status = 206;
    headers['content-range'] = `bytes ${start}-${end}/${st.size}`;
  }
  headers['content-length'] = st.size ? end - start + 1 : 0;
  res.writeHead(status, headers);
  if (req.method === 'HEAD' || !st.size) return res.end();
  const stream = fs.createReadStream(target, { start, end });
  stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy());
  stream.pipe(res);
}

// ---------- uploads (pasted images) ----------

// Pasted/dropped images land here and the prompt references them by path —
// the agent views them with its own file tools. tmp is fine: pastes are
// ephemeral, and writing into the agent's cwd would dirty worktrees.
const UPLOAD_DIR = path.join(os.tmpdir(), 'herdr-web', 'uploads');
const UPLOAD_MAX = 20 * 1024 * 1024;
const UPLOAD_EXT = {
  'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif',
  'application/pdf': '.pdf',
  'text/plain': '.txt', 'text/markdown': '.md', 'text/x-markdown': '.md',
  'text/csv': '.csv', 'text/html': '.html', 'text/css': '.css',
  'application/json': '.json', 'application/javascript': '.js', 'text/javascript': '.js',
  'application/typescript': '.ts', 'text/typescript': '.ts',
  'application/xml': '.xml', 'text/xml': '.xml',
  'application/zip': '.zip', 'application/gzip': '.gz',
  'application/octet-stream': '.bin',
};

// Pastes are ephemeral but the files never were: without a sweep the dir
// grows without bound on a box that doesn't reboot. A day is plenty — the
// referencing prompt has long been consumed by then.
const UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;
async function sweepUploads() {
  let names;
  try { names = await fsp.readdir(UPLOAD_DIR); } catch { return; }
  const cutoff = Date.now() - UPLOAD_TTL_MS;
  for (const name of names) {
    const file = path.join(UPLOAD_DIR, name);
    try {
      if ((await fsp.stat(file)).mtimeMs < cutoff) await fsp.unlink(file);
    } catch { /* raced another sweep or vanished — fine */ }
  }
}
sweepUploads();

async function saveUpload(req) {
  sweepUploads(); // fire-and-forget; a paste is a rare enough trigger
  const ext = UPLOAD_EXT[(req.headers['content-type'] ?? '').split(';')[0].trim()];
  if (!ext) throw httpErr(415, `content-type must be one of: ${Object.keys(UPLOAD_EXT).join(', ')}`);
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > UPLOAD_MAX) throw httpErr(413, 'image too large (20MB max)');
    chunks.push(chunk);
  }
  if (!size) throw httpErr(400, 'empty body');
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const name = `paste-${stamp}-${randomBytes(4).toString('hex')}${ext}`;
  await fsp.mkdir(UPLOAD_DIR, { recursive: true });
  const target = path.join(UPLOAD_DIR, name);
  await fsp.writeFile(target, Buffer.concat(chunks));
  return { path: target };
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
  // Concat buffers before decoding: per-chunk toString() mangles a multi-byte
  // UTF-8 sequence that straddles a chunk boundary into U+FFFDs — and since
  // U+FFFD is legal JSON, the corruption sails through parse to the agent.
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) throw httpErr(413, 'body too large');
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks).toString('utf8');
  return body ? JSON.parse(body) : {};
}

function startSse(res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-store',
    'x-accel-buffering': 'no',
  });
  res.write('retry: 2000\n\n');
  // a REAL ping event, not an SSE comment: comments never reach EventSource
  // listeners, and proxies (vite dev, tailscale serve) can hold the client
  // side of a dead stream open forever — clients watchdog on this heartbeat
  // (10s keeps their zombie-detection window ~30s worst case)
  const ping = setInterval(() => res.write('event: ping\ndata: {}\n\n'), 10_000);
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

// The static app shell is served WITHOUT auth — it holds no data, and a
// cookie-less device has to be able to load it or the client-side TokenGate
// can never render (the old everything-gated behavior greeted new phones
// with a bare JSON 401). All data lives under /api, which enforces the
// token. A valid ?token= on ANY request upgrades to the year-long cookie —
// that one path serves both ?token=… links and the gate's probe fetch.
function checkAuth(req, res, url, { enforce = true } = {}) {
  if (!TOKEN) return true;
  const qtok = url.searchParams.get('token');
  const cookie = (req.headers.cookie ?? '').split(/;\s*/).find((c) => c.startsWith('hw_token='));
  if (tokenEq(qtok, TOKEN)) {
    res.setHeader('set-cookie', `hw_token=${TOKEN}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000`);
    return true;
  }
  if (tokenEq(cookie?.slice('hw_token='.length), TOKEN)) return true;
  if (enforce) sendJson(res, 401, { error: 'missing/bad token — open /?token=… or paste it into the gate' });
  return false;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  // failures only — enough to debug "my phone shows an error" without
  // access-log noise. UA + cookie-presence answer the usual questions
  // (which device, is it enrolled) without logging any secret.
  res.on('finish', () => {
    if (res.statusCode < 400) return;
    const ua = (req.headers['user-agent'] ?? '?').slice(0, 60);
    const cookie = (req.headers.cookie ?? '').includes('hw_token=') ? 'cookie' : 'no-cookie';
    console.warn(`${res.statusCode} ${req.method} ${url.pathname} [${cookie}] ${ua}`);
  });
  try {
    const seg = url.pathname.split('/').filter(Boolean); // ['api','agent','w1:p1','stream']

    if (seg[0] !== 'api') {
      checkAuth(req, res, url, { enforce: false }); // ?token= links still enroll the cookie
      return await serveStatic(url.pathname, res);
    }
    if (!checkAuth(req, res, url)) return;

    if (req.method === 'POST' && seg[1] === 'workspace' && seg[2] && seg[3]) {
      const workspaceId = decodeURIComponent(seg[2]);
      if (seg[3] === 'rename') {
        const { name } = await readBody(req);
        const label = String(name ?? '').trim();
        if (!label) throw httpErr(400, 'empty name');
        await rpc('workspace.rename', { workspace_id: workspaceId, label });
        refreshRoster();
        return sendJson(res, 200, { ok: true, label });
      }
      if (seg[3] === 'close') {
        for (const a of roster.agents) if (a.workspaceId === workspaceId) pinnedSessions.delete(a.paneId);
        await rpc('workspace.close', { workspace_id: workspaceId });
        refreshRoster();
        return sendJson(res, 200, { ok: true });
      }
    }

    if (req.method === 'GET' && seg[1] === 'roster' && !seg[2]) {
      return sendJson(res, 200, roster);
    }
    // pull-to-refresh: re-snapshot herdr now instead of serving the cache
    // (doRefreshRoster also pushes the result down every open stream)
    if (req.method === 'POST' && seg[1] === 'roster' && seg[2] === 'refresh') {
      await refreshRoster();
      return sendJson(res, 200, roster);
    }
    if (req.method === 'GET' && seg[1] === 'roster' && seg[2] === 'stream') {
      startSse(res);
      res.write(`event: roster\ndata: ${JSON.stringify(roster)}\n\n`);
      rosterClients.add(res);
      res.on('close', () => rosterClients.delete(res));
      return;
    }

    if (req.method === 'GET' && seg[1] === 'file' && !seg[2]) {
      return sendJson(res, 200, await fileInfo(url));
    }
    if ((req.method === 'GET' || req.method === 'HEAD') && seg[1] === 'file' && seg[2] === 'raw') {
      return await serveRawFile(req, url, res);
    }

    if (req.method === 'POST' && seg[1] === 'upload' && !seg[2]) {
      return sendJson(res, 200, await saveUpload(req));
    }

    if (seg[1] === 'prefs' && !seg[2]) {
      if (req.method === 'GET') return sendJson(res, 200, { prefs: await loadPrefs() });
      if (req.method === 'PUT') return sendJson(res, 200, { prefs: await savePrefs(await readBody(req)) });
    }

    if (req.method === 'GET' && seg[1] === 'kinds' && !seg[2]) {
      return sendJson(res, 200, { kinds: await listKinds() });
    }
    if (req.method === 'GET' && seg[1] === 'projects' && !seg[2]) {
      return sendJson(res, 200, { projects: await listProjects() });
    }
    if (req.method === 'GET' && seg[1] === 'sessions' && !seg[2]) {
      const cwd = url.searchParams.get('cwd');
      if (!cwd) throw httpErr(400, 'cwd required');
      const kind = url.searchParams.get('kind') ?? 'claude';
      const sessions = await listSessions(kind, cwd.replace(/^~(?=\/|$)/, os.homedir()));
      // a session already bound to a live pane must not be resumed twice —
      // hand the client the pane instead so "resume" becomes "jump to it"
      for (const s of sessions) {
        s.livePaneId = roster.agents.find((a) => a.sessionId === s.sessionId)?.paneId ?? null;
      }
      return sendJson(res, 200, { sessions });
    }
    if (req.method === 'GET' && seg[1] === 'worktrees' && !seg[2]) {
      const cwd = url.searchParams.get('cwd');
      if (!cwd) throw httpErr(400, 'cwd required');
      try {
        return sendJson(res, 200, await listWorktrees(cwd.replace(/^~(?=\/|$)/, os.homedir())));
      } catch (e) {
        throw httpErr(422, String(e.message ?? e));
      }
    }
    if (req.method === 'POST' && seg[1] === 'chats' && !seg[2]) {
      const body = await readBody(req);
      if (body.args !== undefined
        && !(Array.isArray(body.args) && body.args.every((s) => typeof s === 'string'))) {
        throw httpErr(400, 'args: string[]');
      }
      return sendJson(res, 200, await createChat(body));
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
        const { adapter, session } = await resolveAgent(paneId, { optional: true });
        if (!session) {
          // fresh session: no jsonl until the first message — not an error
          return sendJson(res, 200, { events: [], offset: 0, pending: true, sessionId: null });
        }
        const { events: all, offset } = await readEvents(adapter, session.file, 0);
        // ?tail=N → the newest N (turn-aligned); ?end=I pages further back.
        // `start` tells the client how many older events it can still ask for.
        const tail = Number(url.searchParams.get('tail') ?? 0);
        const end = Number(url.searchParams.get('end') ?? 0);
        const { events, start, total } = windowEvents(trimEvents(all), tail, end);
        return sendJson(res, 200, { events, offset, start, total, file: session.file, sessionId: session.sessionId });
      }

      if (req.method === 'GET' && action === 'stream') {
        const { adapter, session } = await resolveAgent(paneId, { optional: true });
        let offset = Number(url.searchParams.get('offset') ?? 0);
        let ticks = 0;
        let resetSent = false; // the client reloads on reset — say it once
        // what herdr said this pane was running when we opened. pi/codex /new
        // moves that to a file that won't exist until its first message —
        // re-resolving can't see the switch, so watch the report itself.
        // (vs. the value at open, not the resolved file: can't reset-loop)
        const reportedAtOpen = reportedSessions.get(paneId);
        startSse(res);
        const tick = async () => {
          if (resetSent) return;
          if (reportedSessions.get(paneId) !== reportedAtOpen) {
            resetSent = true;
            res.write('event: reset\ndata: {}\n\n');
            return;
          }
          // A fresh agent's session file may not exist (or not win
          // correlation) until it has content — re-resolve periodically and
          // tell the client to reload if the binding changed. When we started
          // with no session at all, check every tick so the first message
          // brings the transcript up promptly.
          if (!session || ticks++ % 5 === 4) {
            const now = await resolveAgent(paneId, { optional: true }).catch(() => null);
            if (now?.session && now.session.file !== session?.file) {
              resetSent = true;
              res.write('event: reset\ndata: {}\n\n');
              return;
            }
          }
          if (session) {
            const r = await readEvents(adapter, session.file, offset);
            if (r.reset) {
              // the file shrank (rewind/compaction rewrote it) — replaying
              // from 0 would duplicate the whole transcript; reload instead
              resetSent = true;
              res.write('event: reset\ndata: {}\n\n');
              return;
            }
            offset = r.offset;
            if (r.events.length) {
              res.write(`event: events\ndata: ${JSON.stringify(trimEvents(r.events))}\n\n`);
            }
          }
        };
        // don't let a slow read overlap the next tick — two concurrent reads
        // from the same offset would emit every event twice
        let running = false;
        const timer = setInterval(() => {
          if (running) return;
          running = true;
          tick().catch(() => {}).finally(() => { running = false; });
        }, 700);
        res.on('close', () => clearInterval(timer));
        return;
      }

      if (req.method === 'GET' && action === 'screen') {
        // mode piggybacks so LiveTail's poll keeps the chip live for free
        const text = await readScreen(paneId);
        return sendJson(res, 200, { text, mode: parseMode(text) });
      }

      if (action === 'mode') {
        const a = roster.agents.find((x) => x.paneId === paneId);
        if (a && a.agent !== 'claude') throw httpErr(422, `no permission modes for "${a.agent}"`);
        if (req.method === 'GET') {
          return sendJson(res, 200, { mode: parseMode(await readScreen(paneId)) });
        }
        if (req.method === 'POST') {
          const { mode } = await readBody(req);
          if (!MODES.includes(mode)) throw httpErr(400, `mode: one of ${MODES.join(', ')}`);
          try {
            return sendJson(res, 200, { ok: true, mode: await setMode(paneId, mode) });
          } catch (e) {
            if (e.status === 409) {
              return sendJson(res, 409, { error: String(e.message ?? e), mode: e.mode ?? null });
            }
            throw e;
          }
        }
      }

      if (action === 'rewind') {
        const a = roster.agents.find((x) => x.paneId === paneId);
        if (a && a.agent !== 'claude') throw httpErr(422, `no rewind for "${a.agent}"`);
        if (req.method === 'GET') {
          return sendJson(res, 200, parseRewindScreen(await readScreen(paneId)) ?? { step: 'closed' });
        }
        if (req.method === 'POST') {
          const { op, index, option } = await readBody(req);
          try {
            return sendJson(res, 200, await rewindOp(paneId, { op, index, option }));
          } catch (e) {
            if (e.status === 409) return sendJson(res, 409, { error: String(e.message ?? e) });
            throw e;
          }
        }
      }

      if (req.method === 'GET' && action === 'blocked-context') {
        return sendJson(res, 200, await blockedContext(paneId));
      }

      // Answer a menu with keystrokes, but only after verifying the screen
      // still shows what the client thinks it's answering. `option`/`feedback`
      // answer by cursor navigation instead of digits — required for menus
      // with a free-text row (the plan prompt), safe for any ❯ menu.
      if (req.method === 'POST' && action === 'answer') {
        const { keys, expect, option, feedback } = await readBody(req);
        if (option != null || feedback != null) {
          if (option != null && !Number.isInteger(option)) throw httpErr(400, 'option: integer');
          if (feedback != null && typeof feedback !== 'string') throw httpErr(400, 'feedback: string');
          const kind = roster.agents.find((x) => x.paneId === paneId)?.agent;
          const ok = await answerByNav(paneId, { option, feedback, kind });
          if (!ok) return sendJson(res, 409, { error: 'screen changed', screen: await readScreen(paneId) });
          return sendJson(res, 200, { ok: true });
        }
        if (!Array.isArray(keys) || !keys.length) throw httpErr(400, 'keys: string[]');
        if (expect) {
          const screen = await readScreen(paneId);
          if (!screen.includes(expect)) {
            return sendJson(res, 409, { error: 'screen changed', screen });
          }
        }
        // unnumbered cursor menus (claude's folder-trust prompt) ignore digits
        // — a client build that predates menu.nav still sends one; steer it
        // through cursor nav instead of dropping the tap on the floor
        if (keys.length === 1 && /^[1-9]$/.test(keys[0])
          && parseMenuScreen(await readScreen(paneId))?.nav) {
          const ok = await answerByNav(paneId, { option: +keys[0] });
          if (!ok) return sendJson(res, 409, { error: 'screen changed', screen: await readScreen(paneId) });
          return sendJson(res, 200, { ok: true });
        }
        await agentRpc('agent.send_keys', { target: paneId, keys });
        return sendJson(res, 200, { ok: true });
      }

      // Management verbs the TUI has and the clients lacked (2026-10-20).
      // Rename mirrors what spawn does: the tab gets the text verbatim, the
      // agent the cleaned form — chipName() prefers the agent's label.
      if (req.method === 'POST' && action === 'rename') {
        const { name } = await readBody(req);
        const label = String(name ?? '').trim();
        if (!label) throw httpErr(400, 'empty name');
        const a = roster.agents.find((x) => x.paneId === paneId);
        if (a?.tabId) await rpc('tab.rename', { tab_id: a.tabId, label });
        await rpc('agent.rename', { target: paneId, name: cleanAgentName(label) || null });
        refreshRoster();
        return sendJson(res, 200, { ok: true, label });
      }
      if (req.method === 'POST' && action === 'close') {
        pinnedSessions.delete(paneId);
        await rpc('pane.close', { pane_id: paneId });
        refreshRoster();
        return sendJson(res, 200, { ok: true });
      }

      if (req.method === 'POST' && action === 'prompt') {
        const { text } = await readBody(req);
        if (!text?.trim()) throw httpErr(400, 'empty prompt');
        // a fullscreen viewer left open on the pane would eat the prompt
        await dismissOverlay(paneId, roster.agents.find((x) => x.paneId === paneId)?.agent);
        try {
          await agentRpc('agent.prompt', { target: paneId, text });
          verifyPromptLanded(paneId, text); // fire-and-forget — don't hold the response
        } catch (e) {
          if (!isNotReady(e) || !(await promptRaw(paneId, text))) throw e;
        }
        // a session switch is only visible in herdr's report — pick it up now
        // so open streams reset in ~1s instead of at the next roster poll
        if (/^\/(new|clear)$/.test(text.trim())) {
          for (const ms of [600, 1500, 3000]) setTimeout(() => refreshRoster(), ms);
        }
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
        await agentRpc('agent.send_keys', { target: paneId, keys: ['Escape'] });
        // Esc-time on this machine's clock — the same clock that stamps the
        // session file, so the client can sort the cut marker among events
        return sendJson(res, 200, { ok: true, salvage, at: Date.now() });
      }

      if (req.method === 'POST' && action === 'keys') {
        const { keys } = await readBody(req);
        if (!Array.isArray(keys) || !keys.length) throw httpErr(400, 'keys: string[]');
        await agentRpc('agent.send_keys', { target: paneId, keys });
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
  if (!TOKEN) {
    console.warn(
      'WARNING: HERDR_WEB_TOKEN unset — anyone who can reach this port can drive your agents and start new ones (including with --dangerously-skip-permissions).',
    );
  }
});
