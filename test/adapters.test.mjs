// Adapter translation + blocked classification + incremental reads.
// Grok fixtures mirror real ~/.grok session records (grok 4.5, 2026-08):
// updates.jsonl is the ACP session/update stream, chat_history.jsonl the
// legacy per-record log.
import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { adapterFor, classifyBlocked, grokScanSessions, readEvents } from '../lib/adapters.js';

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
