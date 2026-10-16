// Adapter translation + blocked classification + incremental reads.
// Grok fixtures mirror real ~/.grok session records (grok 4.5, 2026-08):
// updates.jsonl is the ACP session/update stream, chat_history.jsonl the
// legacy per-record log.
import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { adapterFor, classifyBlocked, grokScanSessions, pickActiveByPid, readEvents } from '../lib/adapters.js';

const grok = adapterFor('grok');
const claude = adapterFor('claude');

// grok mixes two envelope methods in one updates.jsonl: chat/tool updates use
// 'session/update', extension updates (turn_completed, tasks, recap) use
// '_x.ai/session/update' — the adapter must accept both.
const upd = (update, { ts = 1785588320, metaMs, method = 'session/update' } = {}) => ({
  timestamp: ts,
  method,
  params: {
    sessionId: 's',
    update,
    ...(metaMs ? { _meta: { agentTimestampMs: metaMs } } : {}),
  },
});

// ---------- grok ACP updates ----------

test('grok user/assistant/thought chunks translate with timestamps', () => {
  const [u] = grok.translate(upd({
    sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'hi friend' },
  }, { metaMs: 1785588320632 }));
  assert.equal(u.kind, 'user');
  assert.equal(u.text, 'hi friend');
  assert.equal(u.ts, new Date(1785588320632).toISOString());

  const [a] = grok.translate(upd({
    sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Hey.' },
  }));
  assert.equal(a.kind, 'assistant');
  assert.equal(a.ts, new Date(1785588320 * 1000).toISOString());

  const [t] = grok.translate(upd({
    sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'thinking…' },
  }));
  assert.equal(t.kind, 'thought');
});

test('grok tool_call → pending tool_use; terminal update → tool_result', () => {
  const [call] = grok.translate(upd({
    sessionUpdate: 'tool_call',
    toolCallId: 'call-1',
    title: 'run_terminal_command',
    rawInput: { command: 'touch x', description: 'touch' },
  }));
  assert.equal(call.kind, 'tool_use');
  assert.equal(call.name, 'run_terminal_command');
  assert.equal(call.id, 'call-1');
  assert.deepEqual(call.input, { command: 'touch x', description: 'touch' });

  // pending/in_progress churn is dropped
  assert.deepEqual(grok.translate(upd({
    sessionUpdate: 'tool_call_update', toolCallId: 'call-1', status: 'in_progress',
    content: [{ type: 'content', content: { type: 'text', text: '' } }],
  })), []);
  assert.deepEqual(grok.translate(upd({
    sessionUpdate: 'tool_call_update', toolCallId: 'call-1',
    kind: 'execute', title: 'Execute `touch x`',
  })), []);

  const [res] = grok.translate(upd({
    sessionUpdate: 'tool_call_update', toolCallId: 'call-1', status: 'completed',
    content: [{ type: 'content', content: { type: 'text', text: 'ok\n' } }],
  }));
  assert.equal(res.kind, 'tool_result');
  assert.equal(res.id, 'call-1');
  assert.equal(res.text, 'ok\n');

  const [fail] = grok.translate(upd({
    sessionUpdate: 'tool_call_update', toolCallId: 'call-2', status: 'failed',
    content: [{ type: 'content', content: { type: 'text', text: 'Error: no such file' } }],
  }));
  assert.equal(fail.kind, 'tool_result');
  assert.match(fail.text, /Error/);
});

test('grok turn_completed usage → usage event; cancelled turns → nothing', () => {
  // turn_completed arrives on the NAMESPACED envelope — regression for the
  // discriminator that once keyed on method === 'session/update' and lost
  // every usage record
  const [u] = grok.translate(upd({
    sessionUpdate: 'turn_completed',
    stop_reason: 'end_turn',
    usage: { inputTokens: 15617, outputTokens: 68, cachedReadTokens: 11264 },
  }, { method: '_x.ai/session/update' }));
  assert.equal(u.kind, 'usage');
  assert.deepEqual(u.usage, { out: 68, ctx: 15617 });

  assert.deepEqual(grok.translate(upd({
    sessionUpdate: 'turn_completed', stop_reason: 'cancelled',
  })), []);
});

test('grok plan / background-task updates', () => {
  const [plan] = grok.translate(upd({
    sessionUpdate: 'plan',
    entries: [
      { content: 'Add plugin', status: 'in_progress' },
      { content: 'Verify', status: 'pending' },
    ],
  }));
  assert.equal(plan.kind, 'note');
  assert.match(plan.text, /▸ Add plugin/);
  assert.match(plan.text, /· Verify/);

  const [bg] = grok.translate(upd({
    sessionUpdate: 'task_backgrounded', tool_call_id: 'call-9', task_id: 'call-9', command: 'sleep 99',
  }));
  assert.equal(bg.kind, 'tool_result');
  assert.equal(bg.id, 'call-9');

  const [done] = grok.translate(upd({
    sessionUpdate: 'task_completed', task_snapshot: { task_id: 'call-9', command: 'sleep 99' },
  }));
  assert.equal(done.kind, 'note');
});

test('grok noise updates translate to nothing', () => {
  for (const u of [
    { sessionUpdate: 'session_recap', summary: 'we did things', auto: true },
    { sessionUpdate: 'current_mode_update', currentModeId: 'plan' },
    { sessionUpdate: 'retry_state', type: 'retrying', attempt: 1 },
    { sessionUpdate: 'subagent_spawned', subagent_id: 'x' },
    { sessionUpdate: 'subagent_finished', subagent_id: 'x' },
  ]) {
    assert.deepEqual(grok.translate(upd(u)), []);
  }
});

// ---------- grok legacy chat_history ----------

test('grok legacy user records: synthetic turns dropped, user_query unwrapped', () => {
  assert.deepEqual(grok.translate({
    type: 'user',
    synthetic_reason: 'system_reminder',
    content: [{ type: 'text', text: '<system-reminder>skills…</system-reminder>' }],
  }), []);
  const [u] = grok.translate({
    type: 'user',
    content: [{ type: 'text', text: '<user_query>\nhello there\n</user_query>' }],
  });
  assert.equal(u.text, 'hello there');
});

test('grok legacy assistant with tool_calls', () => {
  const evs = grok.translate({
    type: 'assistant',
    content: 'Running it now.',
    tool_calls: [{ id: 'c1', name: 'run_terminal_command', arguments: '{"command":"ls"}' }],
  });
  assert.equal(evs.length, 2);
  assert.equal(evs[0].kind, 'assistant');
  assert.equal(evs[1].kind, 'tool_use');
  assert.deepEqual(evs[1].input, { command: 'ls' });
});

// ---------- claude ----------

test('claude assistant blocks carry usage + msgId; sidechains dropped', () => {
  const evs = claude.translate({
    type: 'assistant',
    timestamp: '2026-08-01T12:00:00Z',
    message: {
      id: 'msg_1',
      model: 'claude-fable-5',
      usage: { output_tokens: 10, input_tokens: 100, cache_read_input_tokens: 900 },
      content: [
        { type: 'text', text: 'hello' },
        { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } },
      ],
    },
  });
  assert.equal(evs.length, 2);
  assert.equal(evs[0].msgId, 'msg_1');
  assert.deepEqual(evs[0].usage, { out: 10, ctx: 1000 });
  assert.equal(evs[1].kind, 'tool_use');

  assert.deepEqual(claude.translate({ type: 'assistant', isSidechain: true, message: { content: [] } }), []);
});

test('claude slash command triple → command/command_out; meta shapes dropped', () => {
  const [cmd] = claude.translate({
    type: 'user',
    message: { content: '<command-name>/clear</command-name>\n<command-args></command-args>' },
  });
  assert.equal(cmd.kind, 'command');
  assert.equal(cmd.name, '/clear');
  const [out] = claude.translate({
    type: 'user',
    message: { content: '<local-command-stdout>done</local-command-stdout>' },
  });
  assert.equal(out.kind, 'command_out');
  assert.deepEqual(claude.translate({
    type: 'user', message: { content: '<system-reminder>x</system-reminder>' },
  }), []);
  assert.deepEqual(claude.translate({
    type: 'user', message: { content: '[Request interrupted by user]' },
  }), []);
});

// ---------- classifyBlocked ----------

test('classifyBlocked: pending tool → permission; resolved → unknown', () => {
  const pending = [
    { kind: 'user', text: 'do it' },
    { kind: 'tool_use', id: 'c1', name: 'run_terminal_command', text: '{"command":"rm x"}' },
  ];
  assert.deepEqual(classifyBlocked(pending), {
    kind: 'permission', tool: 'run_terminal_command', detail: '{"command":"rm x"}',
  });
  const resolved = [...pending, { kind: 'tool_result', id: 'c1', text: 'ok' }];
  assert.equal(classifyBlocked(resolved).kind, 'unknown');
});

test('classifyBlocked: ask_user_question (grok) and AskUserQuestion (claude)', () => {
  const qs = [{ question: 'which?', options: [{ label: 'a' }, { label: 'b' }] }];
  for (const name of ['ask_user_question', 'AskUserQuestion']) {
    const ctx = classifyBlocked([{ kind: 'tool_use', id: 'x', name, input: { questions: qs } }]);
    assert.equal(ctx.kind, 'ask');
    assert.deepEqual(ctx.questions, qs);
  }
});

test('classifyBlocked: exit_plan_mode variants → plan', () => {
  for (const name of ['ExitPlanMode', 'exit_plan_mode']) {
    const ctx = classifyBlocked([{ kind: 'tool_use', id: 'x', name, input: { plan: '# p' } }]);
    assert.equal(ctx.kind, 'plan');
  }
});

test('classifyBlocked: trailing thought/note/usage events do not mask the pending tool', () => {
  const ctx = classifyBlocked([
    { kind: 'tool_use', id: 'c1', name: 'write', text: '' },
    { kind: 'thought', text: 'hmm' },
    { kind: 'usage', text: '', usage: { out: 5, ctx: 100 } },
  ]);
  assert.equal(ctx.kind, 'permission');
});

// ---------- readEvents ----------

test('readEvents: incremental offsets, partial lines, truncation reset', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'herdr-adapters-'));
  const file = path.join(dir, 'log.jsonl');
  const echoAdapter = { translate: (o) => [{ kind: 'note', text: o.v }] };

  await fsp.writeFile(file, '{"v":"a"}\n{"v":"b"}\n');
  let r = await readEvents(echoAdapter, file, 0);
  assert.deepEqual(r.events.map((e) => e.text), ['a', 'b']);
  assert.equal(r.reset, false);

  // nothing new
  let r2 = await readEvents(echoAdapter, file, r.offset);
  assert.deepEqual(r2.events, []);
  assert.equal(r2.offset, r.offset);

  // a partial line is not consumed until its newline arrives
  await fsp.appendFile(file, '{"v":"c"');
  r2 = await readEvents(echoAdapter, file, r.offset);
  assert.deepEqual(r2.events, []);
  assert.equal(r2.offset, r.offset);
  await fsp.appendFile(file, '}\n');
  r2 = await readEvents(echoAdapter, file, r.offset);
  assert.deepEqual(r2.events.map((e) => e.text), ['c']);

  // multi-byte utf8 across the incremental boundary stays intact
  await fsp.appendFile(file, '{"v":"héllo — ✓"}\n');
  const r3 = await readEvents(echoAdapter, file, r2.offset);
  assert.deepEqual(r3.events.map((e) => e.text), ['héllo — ✓']);

  // truncation (rewind rewrote the file) → reset flag
  await fsp.writeFile(file, '{"v":"fresh"}\n');
  const r4 = await readEvents(echoAdapter, file, r3.offset);
  assert.equal(r4.reset, true);
  assert.deepEqual(r4.events.map((e) => e.text), ['fresh']);

  await fsp.rm(dir, { recursive: true, force: true });
});

test('readEvents: unparseable lines are skipped, not fatal', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'herdr-adapters-'));
  const file = path.join(dir, 'log.jsonl');
  const echoAdapter = { translate: (o) => [{ kind: 'note', text: o.v }] };
  await fsp.writeFile(file, '{"v":"a"}\nnot json at all\n{"v":"b"}\n');
  const r = await readEvents(echoAdapter, file, 0);
  assert.deepEqual(r.events.map((e) => e.text), ['a', 'b']);
  await fsp.rm(dir, { recursive: true, force: true });
});

// ---------- grok session correlation fallback ----------

test('grok user chunks: harness-injected <system-reminder> turns are dropped', () => {
  assert.deepEqual(grok.translate(upd({
    sessionUpdate: 'user_message_chunk',
    content: { type: 'text', text: '<system-reminder>\nBackground task "call-1" finished\n</system-reminder>' },
  })), []);
});

// Live failure 2026-08-12: same grok PID had both the pre-/clear empty shell
// (opened_at days earlier) and the real chat; Array.find stuck on the shell
// and the web UI showed "fresh session" over a full Emmy Yoga transcript.
test('pickActiveByPid: newest opened_at wins when /clear leaves multiple rows', () => {
  const active = [
    { session_id: 'stale', pid: 8214, cwd: '/x', opened_at: '2026-08-09T23:41:57Z' },
    { session_id: 'other', pid: 9999, cwd: '/x', opened_at: '2026-08-12T06:00:00Z' },
    { session_id: 'fresh', pid: 8214, cwd: '/x', opened_at: '2026-08-12T05:26:05Z' },
  ];
  assert.equal(pickActiveByPid(active, 8214)?.session_id, 'fresh');
  assert.equal(pickActiveByPid(active, 9999)?.session_id, 'other');
  assert.equal(pickActiveByPid(active, 1), null);
});


// Mirrors the real failure: grok rewrites active_sessions.json wholesale on
// every launch, so a concurrent session's entry vanishes while its process
// (and session dir) live on. The scan must bind the pane to its dir anyway.
const mkSession = async (base, id, { createdAt, updates = '', chat = '' } = {}) => {
  const dir = path.join(base, id);
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, 'summary.json'), JSON.stringify({
    info: { id }, created_at: new Date(createdAt).toISOString(),
  }));
  if (updates) await fsp.writeFile(path.join(dir, 'updates.jsonl'), updates);
  if (chat) await fsp.writeFile(path.join(dir, 'chat_history.jsonl'), chat);
  return dir;
};

test('grokScanSessions: binds the unclaimed dir created near process start', async () => {
  const base = await fsp.mkdtemp(path.join(os.tmpdir(), 'herdr-grok-scan-'));
  const t0 = Date.now();
  await mkSession(base, 'old-one', { createdAt: t0 - 86_400_000, updates: '{"x":1}\n' });
  await mkSession(base, 'claimed-one', { createdAt: t0 - 30_000, updates: '{"x":1}\n' });
  await mkSession(base, 'mine', { createdAt: t0 - 60_000, chat: '{"type":"system"}\n' });

  // near-start window: only 'mine' qualifies (claimed excluded, old-one far)
  const hit = await grokScanSessions(base, {
    claimed: new Set(['claimed-one']),
    startedAt: t0,
  });
  assert.equal(hit.sessionId, 'mine');
  assert.ok(hit.file.endsWith('chat_history.jsonl')); // fresh session, no updates yet

  // known start but nothing near it → refuse rather than bind an old session
  const miss = await grokScanSessions(base, {
    claimed: new Set(['claimed-one', 'mine']),
    startedAt: t0,
  });
  assert.equal(miss, null);

  // unknown start → best effort: most recently written transcript
  const best = await grokScanSessions(base, { claimed: new Set() });
  assert.ok(best.sessionId);

  // a dir without summary.json never binds
  await fsp.mkdir(path.join(base, 'no-summary'), { recursive: true });
  await fsp.writeFile(path.join(base, 'no-summary', 'updates.jsonl'), '{"x":1}\n');
  const scan = await grokScanSessions(base, { claimed: new Set(), startedAt: t0 + 86_400_000 });
  assert.equal(scan, null);

  await fsp.rm(base, { recursive: true, force: true });
});

test('grokScanSessions: /clear long after launch still binds (created-after-start fallback)', async () => {
  // The ±5min window around process start misses a session dir that /clear
  // created 20 minutes in — but a clobbered registry plus that /clear used to
  // re-blank the pane. Created-after-start is fair game; created-before is not.
  const base = await fsp.mkdtemp(path.join(os.tmpdir(), 'herdr-grok-scan2-'));
  const t0 = Date.now() - 30 * 60_000; // process started 30 min ago
  await mkSession(base, 'stale-yesterday', { createdAt: t0 - 86_400_000, updates: '{"x":1}\n' });
  await mkSession(base, 'cleared-into', { createdAt: t0 + 20 * 60_000, updates: '{"x":1}\n' });

  const hit = await grokScanSessions(base, { claimed: new Set(), startedAt: t0 });
  assert.equal(hit?.sessionId, 'cleared-into', 'must bind the post-launch session, not null');

  // with only the stale session on disk, still refuse
  const onlyStale = await grokScanSessions(base, {
    claimed: new Set(['cleared-into']), startedAt: t0,
  });
  assert.equal(onlyStale, null);

  await fsp.rm(base, { recursive: true, force: true });
});

// ---------- grok tool results that ship only rawOutput ----------

test('grok tool_call_update falls back to rawOutput when content is absent', () => {
  const done = (extra) => upd({
    sessionUpdate: 'tool_call_update', status: 'completed', toolCallId: 'c1', ...extra,
  });
  // file/dir tools: {type, Content:{content}}
  let [r] = grok.translate(done({
    rawOutput: { type: 'ListDir', Content: { content: '- /home/x/\n  - a.js\n' } },
  }));
  assert.equal(r.text, '- /home/x/\n  - a.js\n');
  // task tools: {type, Result:{output}}
  [r] = grok.translate(done({
    rawOutput: { type: 'TaskOutput', Result: { task_id: 't', output: 'build ok', exit_code: 0 } },
  }));
  assert.equal(r.text, 'build ok');
  // todo tool: {type, TodosUpdated:{summary_for_prompt}}
  [r] = grok.translate(done({
    rawOutput: { type: 'Todo', TodosUpdated: { summary_for_prompt: '- [pending] x', todos: [] } },
  }));
  assert.equal(r.text, '- [pending] x');
  // unknown shape: stringified, not blank
  [r] = grok.translate(done({
    rawOutput: { action: { type: 'search', query: 'q' }, id: 'a1', status: 'done' },
  }));
  assert.ok(r.text.includes('"search"'));
  // content present still wins
  [r] = grok.translate(done({
    content: [{ type: 'content', content: { type: 'text', text: 'from content' } }],
    rawOutput: { type: 'ListDir', Content: { content: 'from raw' } },
  }));
  assert.equal(r.text, 'from content');
});

// ---------- codex rollouts ----------
// Shapes mirror a real ~/.codex/sessions rollout (codex 0.162, 2026-10):
// {timestamp, ordinal, type, payload}.

const codex = adapterFor('codex');
const cx = (type, payload, ordinal = 1) => ({
  timestamp: '2026-10-13T17:14:42.840Z', ordinal, type, payload,
});
const cxMsg = (role, text, kinds) => cx('response_item', {
  type: 'message',
  role,
  content: [{ type: role === 'assistant' ? 'output_text' : 'input_text', text }],
  ...(kinds ? { internal_chat_message_metadata_passthrough: { content_item_kinds: kinds } } : {}),
});

test('codex messages: typed prompts and replies pass, harness context is dropped', () => {
  const [u] = codex.translate(cxMsg('user', 'fix the bug', ['user.text']));
  assert.deepEqual(u, { kind: 'user', text: 'fix the bug', ts: '2026-10-13T17:14:42.840Z' });
  assert.equal(codex.translate(cxMsg('assistant', 'done'))[0].kind, 'assistant');
  // environment_context rides in as a user message, tagged by kind …
  assert.deepEqual(codex.translate(
    cxMsg('user', '<environment_context>\n <cwd>/x</cwd>', ['environments.environment_context']),
  ), []);
  // … and on rollouts without the tag, by its leading XML element
  assert.deepEqual(codex.translate(cxMsg('user', '<environment_context>\n <cwd>/x</cwd>')), []);
  assert.equal(codex.translate(cxMsg('user', 'why is <div> here'))[0].text, 'why is <div> here');
  assert.deepEqual(codex.translate(cxMsg('developer', '<permissions instructions>')), []);
});

test('codex reasoning: summary text becomes a thought, encrypted-only is skipped', () => {
  const [t] = codex.translate(cx('response_item', {
    type: 'reasoning', summary: [{ type: 'summary_text', text: 'Checking the file.' }], encrypted_content: 'x',
  }));
  assert.equal(t.kind, 'thought');
  assert.equal(t.text, 'Checking the file.');
  assert.deepEqual(codex.translate(cx('response_item', {
    type: 'reasoning', summary: [], encrypted_content: 'gAAAA',
  })), []);
});

test('codex tool calls pair with their outputs by call_id', () => {
  const [use] = codex.translate(cx('response_item', {
    type: 'function_call', name: 'exec_command', arguments: '{"cmd":"cat note.txt"}', call_id: 'call_1',
  }));
  assert.equal(use.kind, 'tool_use');
  assert.equal(use.name, 'exec_command');
  assert.equal(use.id, 'call_1');
  assert.deepEqual(use.input, { cmd: 'cat note.txt' });
  const [res] = codex.translate(cx('response_item', {
    type: 'function_call_output', call_id: 'call_1', output: 'hello',
  }));
  assert.deepEqual(res, { kind: 'tool_result', text: 'hello', ts: use.ts, id: 'call_1' });
  // legacy JSON-string wrapper
  assert.equal(codex.translate(cx('response_item', {
    type: 'function_call_output', call_id: 'c', output: '{"output":"hi\\n","metadata":{"exit_code":0}}',
  }))[0].text, 'hi\n');
  // apply_patch: raw patch text, not JSON
  const [patch] = codex.translate(cx('response_item', {
    type: 'custom_tool_call', name: 'apply_patch', input: '*** Begin Patch\n*** End Patch', call_id: 'call_2',
  }));
  assert.equal(patch.name, 'apply_patch');
  assert.equal(patch.text, '*** Begin Patch\n*** End Patch');
  // a call still waiting on approval is the blocked signal
  assert.deepEqual(classifyBlocked([use]).kind, 'permission');
  assert.deepEqual(classifyBlocked([use, res]).kind, 'unknown');
  // web search has no output record — must not read as pending
  const ws = codex.translate(cx('response_item', { type: 'web_search_call', id: 'ws_1', action: { query: 'q' } }));
  assert.deepEqual(classifyBlocked(ws).kind, 'unknown');
});

test('codex usage: one summable event per model response; UI mirrors are dropped', () => {
  const tc = (ordinal, out) => cx('event_msg', {
    type: 'token_count',
    info: { last_token_usage: { input_tokens: 1846, output_tokens: out }, total_token_usage: {} },
  }, ordinal);
  const [a] = codex.translate(tc(13, 323));
  const [b] = codex.translate(tc(19, 100));
  assert.deepEqual(a.usage, { out: 323, ctx: 1846 });
  assert.notEqual(a.msgId, b.msgId);
  assert.deepEqual(codex.translate(cx('event_msg', { type: 'token_count', info: null })), []);
  // item_completed duplicates the response_item stream
  assert.deepEqual(codex.translate(cx('event_msg', {
    type: 'item_completed', item: { type: 'AgentMessage', content: [{ type: 'Text', text: 'done' }] },
  })), []);
  assert.deepEqual(codex.translate(cx('session_meta', { id: 's', cwd: '/x' })), []);
});

test('codex find + list: by reported id, by resume pin, by cwd since process start', async (t) => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'codex-home-'));
  const prev = process.env.CODEX_HOME;
  process.env.CODEX_HOME = home;
  t.after(async () => {
    if (prev === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = prev;
    await fsp.rm(home, { recursive: true, force: true });
  });
  const write = async (day, stamp, id, cwd, created, prompt) => {
    const dir = path.join(home, 'sessions', '2026', '10', day);
    await fsp.mkdir(dir, { recursive: true });
    const lines = [cx('session_meta', { id, cwd, timestamp: created, thread_source: 'user' }, 0)];
    if (prompt) lines.push(cxMsg('user', prompt, ['user.text']));
    await fsp.writeFile(
      path.join(dir, `rollout-${stamp}-${id}.jsonl`),
      lines.map((l) => JSON.stringify(l)).join('\n') + '\n',
    );
  };
  const OLD = '01a13641-3d32-7dc0-a7ba-8e6dd75878b2';
  const NEW = '01a13644-fbd9-7840-8427-83e715af948e';
  const OTHER = '01a13650-0000-7000-8000-000000000000';
  await write('12', '2026-10-12T09-00-00', OLD, '/proj', '2026-10-12T13:00:00.000Z', 'old prompt');
  await write('13', '2026-10-13T13-17-33', NEW, '/proj', '2026-10-13T17:17:33.000Z', 'new prompt');
  await write('13', '2026-10-13T14-00-00', OTHER, '/elsewhere', '2026-10-13T18:00:00.000Z', 'x');

  assert.equal((await codex.find('/proj', { agentSessionId: OLD })).sessionId, OLD);
  assert.equal((await codex.find('/proj', { sessionId: OLD })).sessionId, OLD);
  assert.equal((await codex.find('/proj', {})).sessionId, NEW); // newest for the cwd
  assert.equal((await codex.find('/proj', { exclude: new Set([NEW]) })).sessionId, OLD);
  // a pane whose process started after every session owns none of them
  assert.equal(await codex.find('/proj', { startedAfter: Date.parse('2026-10-13T19:00:00Z') }), null);
  assert.equal(
    (await codex.find('/proj', { startedAfter: Date.parse('2026-10-13T17:17:00Z') })).sessionId, NEW,
  );
  assert.equal(await codex.find('/nowhere', {}), null);

  const { listSessions } = await import('../lib/adapters.js');
  const rows = await listSessions('codex', '/proj');
  assert.deepEqual(rows.map((r) => r.firstPrompt).sort(), ['new prompt', 'old prompt']);
});

// ---------- pi sessions ----------
// Shapes mirror a real ~/.pi/agent/sessions file (pi 1.3, 2026-10): a header
// line, then parentId-linked entries.
const pi = adapterFor('pi');
const piMsg = (id, message) => ({ type: 'message', id, parentId: null, timestamp: '2026-10-15T21:58:41.000Z', message });

test('pi messages: prompts, thinking, tool calls paired with results, usage per message', () => {
  assert.deepEqual(pi.translate({ type: 'session', version: 3, id: 's', cwd: '/x' }), []);
  assert.deepEqual(pi.translate(piMsg('a0', { role: 'system', content: '', sections: {} })), []);
  const [u] = pi.translate(piMsg('a1', { role: 'user', content: [{ type: 'text', text: 'read note.txt' }] }));
  assert.equal(u.kind, 'user');
  assert.equal(u.text, 'read note.txt');
  const evs = pi.translate(piMsg('a2', {
    role: 'assistant',
    content: [
      { type: 'thinking', thinking: 'reading it', thinkingSignature: 'reasoning_content' },
      { type: 'toolCall', id: 'tc1', name: 'read', arguments: { path: 'note.txt' } },
    ],
    usage: { input: 580, output: 99, cacheRead: 1057, cacheWrite: 0 },
    stopReason: 'toolUse',
  }));
  assert.deepEqual(evs.map((e) => e.kind), ['thought', 'tool_use']);
  assert.deepEqual(evs[1].input, { path: 'note.txt' });
  assert.deepEqual(evs[1].usage, { out: 99, ctx: 1637 });
  assert.equal(evs[0].msgId, evs[1].msgId);
  const [r] = pi.translate(piMsg('a3', {
    role: 'toolResult', toolCallId: 'tc1', toolName: 'read', content: [{ type: 'text', text: 'quokka\n' }], isError: false,
  }));
  assert.deepEqual([r.kind, r.id, r.text], ['tool_result', 'tc1', 'quokka\n']);
  assert.deepEqual(classifyBlocked([u, ...evs, r]), { kind: 'unknown' });
});

test('pi user !bash runs pair up; aborted turns and compaction leave notes', () => {
  const evs = pi.translate(piMsg('b1', {
    role: 'bashExecution', command: 'echo bang-ok', output: 'bang-ok\n', exitCode: 0, cancelled: false, truncated: false,
  }));
  assert.deepEqual(evs.map((e) => e.kind), ['tool_use', 'tool_result']);
  assert.equal(evs[0].id, evs[1].id);
  assert.deepEqual(classifyBlocked(evs), { kind: 'unknown' });
  const ab = pi.translate(piMsg('b2', { role: 'assistant', content: [], stopReason: 'aborted' }));
  assert.deepEqual(ab.map((e) => e.kind), ['note']);
  assert.equal(pi.translate({ type: 'compaction', id: 'c', summary: 's', tokensBefore: 9 })[0].name, 'compact');
  assert.deepEqual(pi.translate({ type: 'session_info', id: 'i', name: 'quokka hunt' }), []);
  assert.deepEqual(pi.translate({ type: 'custom_message', id: 'm', customType: 'x', content: 'hidden', display: false }), []);
});

test('pi find + list: reported path (missing = nothing yet), resume pin, cwd since process start', async (t) => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'pi-home-'));
  const prev = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = home;
  t.after(async () => {
    if (prev === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = prev;
    await fsp.rm(home, { recursive: true, force: true });
  });
  const dir = path.join(home, 'sessions', '--proj-app--');
  await fsp.mkdir(dir, { recursive: true });
  const write = async (created, id, prompt, name) => {
    const stamp = new Date(created).toISOString().replace(/[:.]/g, '-');
    const file = path.join(dir, `${stamp}_${id}.jsonl`);
    const lines = [{ type: 'session', version: 3, id, timestamp: new Date(created).toISOString(), cwd: '/proj/app' }];
    if (prompt) lines.push(piMsg('u', { role: 'user', content: [{ type: 'text', text: prompt }] }));
    if (name) lines.push({ type: 'session_info', id: 'n', parentId: 'u', timestamp: '', name });
    await fsp.writeFile(file, `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`);
    return file;
  };
  const OLD = '01a14188-a4a3-738b-a1c9-426e0583a6dc';
  const NEW = '01a14193-062f-70ad-9bb0-df655ca67ed0';
  const now = Date.now();
  const oldFile = await write(now - 3_600_000, OLD, 'old prompt');
  const newFile = await write(now - 1_000, NEW, 'new prompt', 'quokka hunt');

  assert.deepEqual(await pi.find('/proj/app', { agentSessionId: oldFile }), { file: oldFile, sessionId: OLD });
  // herdr reports the path at launch, before pi writes it — never guess past that
  assert.equal(await pi.find('/proj/app', { agentSessionId: path.join(dir, `x_${NEW.replace('0', '9')}.jsonl`) }), null);
  assert.deepEqual(await pi.find('/proj/app', { sessionId: OLD }), { file: oldFile, sessionId: OLD });
  assert.deepEqual(await pi.find('/proj/app', { startedAfter: now - 60_000 }), { file: newFile, sessionId: NEW });
  assert.equal(await pi.find('/proj/app', { startedAfter: now - 60_000, exclude: new Set([NEW]) }), null);
  assert.equal(await pi.find('/proj/other', {}), null);
  // the pane's own session (stamped at launch, written later) beats a
  // headless run stamped after it but idle since
  const OWN = '01a1418e-0531-76a5-ab59-d8d71ade9787';
  const ownFile = await write(now - 2_000, OWN, 'pane prompt');
  const past = new Date(now - 30_000);
  await fsp.utimes(newFile, past, past);
  assert.deepEqual(await pi.find('/proj/app', { startedAfter: now - 60_000 }), { file: ownFile, sessionId: OWN });
  await fsp.rm(ownFile);
  await fsp.utimes(newFile, new Date(), new Date());

  const { listSessions } = await import('../lib/adapters.js');
  const rows = await listSessions('pi', '/proj/app');
  assert.deepEqual(rows.map((r) => [r.sessionId, r.firstPrompt, r.title]), [
    [NEW, 'new prompt', 'quokka hunt'],
    [OLD, 'old prompt', null],
  ]);
});
