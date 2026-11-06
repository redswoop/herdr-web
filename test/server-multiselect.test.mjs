// The multi-select submit driver (claude v2.1.318+ AskUserQuestion) against
// the real server.js and a fake herdr whose `agent.read` is a tiny TUI model:
// a cursor over options 1..5 / Submit / rule / 6, boxes that Enter toggles,
// a scrolling viewport that hides the Submit row, the "Review your answers"
// confirm, and a knob that drops Enter so the driver's "still drawn" guard
// is exercised. Proves: a scrolled Submit row is walked into view, Enter on
// an option never passes for a commit, and the route says 409, not ok, when
// the Enter never landed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 18083 + (process.pid % 100);
const BASE = `http://127.0.0.1:${PORT}`;
const PANE = 'w1:pA';

// ---------- the TUI model ----------
// Shape verified live on a 12-row pane (claude 2.1.318, 2026-11-05): the
// options 1..5 scroll in a window of `viewport` rows; Submit, the rule and
// "6. Chat about this" are pinned under it. ↑/↓ share the cursor column, so
// the cursor row hides its own marker.

const LABELS = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Type something'];
const tui = {
  mode: 'multi', // multi | plain | idle
  rows: [], // row objects in cursor order
  cursor: 0,
  viewport: Infinity, // option rows visible at once
  top: 0,
  phase: 'menu', // menu | review | done
  dropEnter: false,
  keys: [],
};
function reset({ mode = 'multi', viewport = Infinity, cursor = 0, dropEnter = false } = {}) {
  tui.mode = mode;
  tui.viewport = viewport;
  tui.top = 0;
  tui.phase = 'menu';
  tui.dropEnter = dropEnter;
  tui.keys = [];
  tui.cursor = cursor;
  tui.rows = mode === 'multi'
    ? [...LABELS.map((label, i) => ({ kind: 'opt', n: i + 1, label, box: i === 1, desc: i < 4 ? `The option ${i + 1}.` : null })),
      { kind: 'submit' }, { kind: 'rule' }, { kind: 'opt', n: 6, label: 'Chat about this', plain: true }]
    : [{ kind: 'opt', n: 1, label: 'Yes', plain: true }, { kind: 'opt', n: 2, label: 'No', plain: true }];
  clampView();
}
const N_OPTS = 5; // rows 0..4 scroll; the rest is the pinned footer
const cursorable = (r) => r.kind !== 'rule';
function clampView() {
  if (tui.cursor >= N_OPTS) return; // the footer doesn't move the window
  if (tui.cursor < tui.top) tui.top = tui.cursor;
  if (tui.cursor >= tui.top + tui.viewport) tui.top = tui.cursor - tui.viewport + 1;
}
function press(key) {
  tui.keys.push(key);
  if (tui.phase === 'review') {
    if (key === 'Enter') tui.phase = 'done';
    return;
  }
  if (tui.phase !== 'menu') return;
  if (key === 'Down' || key === 'Up') {
    let c = tui.cursor;
    do { c += key === 'Down' ? 1 : -1; } while (tui.rows[c] && !cursorable(tui.rows[c]));
    if (tui.rows[c]) tui.cursor = c;
    clampView();
    return;
  }
  if (key === 'Enter') {
    const row = tui.rows[tui.cursor];
    if (tui.mode !== 'multi') { tui.phase = 'done'; return; }
    if (row.kind === 'submit') { if (!tui.dropEnter) tui.phase = 'review'; return; }
    if (row.kind === 'opt' && !row.plain) row.box = !row.box;
  }
}
function screen() {
  if (tui.mode === 'idle' || tui.phase === 'done') return 'idle screen\n';
  if (tui.phase === 'review') return 'Review your answers\n\n❯ 1. Submit answers\n  2. Cancel\n';
  const out = ['What exactly goes wrong in the last stretch?', ''];
  const optEnd = tui.mode === 'multi' ? N_OPTS : tui.rows.length;
  const last = Math.min(optEnd, tui.top + tui.viewport);
  const line = (i, r) => {
    const cur = i === tui.cursor;
    const mark = cur ? '❯' : i === tui.top && tui.top > 0 && i < optEnd ? '↑' : i === last - 1 && last < optEnd ? '↓' : ' ';
    if (r.kind === 'rule') return '────────────────────────────────────────';
    if (r.kind === 'submit') return `${mark}    Submit`;
    if (r.plain) return `${mark} ${r.n}. ${r.label}`;
    return `${mark} ${r.n}. [${r.box ? '✔' : ' '}] ${r.label}${r.desc ? `\n         ${r.desc}` : ''}`;
  };
  for (let i = tui.top; i < last; i += 1) out.push(line(i, tui.rows[i]));
  for (let i = optEnd; i < tui.rows.length; i += 1) out.push(line(i, tui.rows[i]));
  return `${out.join('\n')}\n`;
}

// ---------- fake herdr daemon ----------

function startDaemon(sock) {
  const srv = net.createServer((conn) => {
    let buf = '';
    conn.on('data', (d) => {
      buf += d;
      const nl = buf.indexOf('\n');
      if (nl === -1) return;
      let msg;
      try { msg = JSON.parse(buf.slice(0, nl)); } catch { conn.destroy(); return; }
      const reply = (result) => conn.write(`${JSON.stringify({ id: msg.id, result })}\n`);
      switch (msg.method) {
        case 'session.snapshot':
          reply({
            snapshot: {
              agents: [{ pane_id: PANE, workspace_id: 'w1', tab_id: 't1', agent: 'claude', agent_status: 'blocked', cwd: os.tmpdir(), terminal_title_stripped: '', revision: 1 }],
              workspaces: [{ workspace_id: 'w1', number: 1, label: 'w1' }],
              tabs: [{ tab_id: 't1', workspace_id: 'w1', number: 1, label: 't1', pane_count: 1 }],
            },
          });
          break;
        case 'pane.process_info':
          reply({ process_info: { foreground_processes: [] } });
          break;
        case 'agent.read':
          reply({ read: { text: screen() } });
          break;
        case 'agent.send_keys':
          for (const k of msg.params.keys) press(k);
          reply({ ok: true });
          break;
        case 'events.subscribe':
          conn.write(`${JSON.stringify({ id: msg.id, result: { ok: true } })}\n`);
          return;
        default:
          conn.write(`${JSON.stringify({ id: msg.id, error: { code: 'no_method', message: msg.method } })}\n`);
      }
      conn.end();
    });
  });
  return new Promise((res) => srv.listen(sock, () => res(srv)));
}

let home;
let daemon;
let server;

test.before(async () => {
  reset({ mode: 'idle' });
  home = await fsp.mkdtemp(path.join(os.tmpdir(), 'herdr-ms-home-'));
  const sock = path.join(home, 'herdr.sock');
  daemon = await startDaemon(sock);
  server = spawn(process.execPath, ['server.js', '--port', String(PORT), '--host', '127.0.0.1'], {
    cwd: ROOT,
    env: { ...process.env, HOME: home, HERDR_SOCK: sock, HERDR_WEB_TOKEN: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let bootLog = '';
  server.stdout.on('data', (d) => { bootLog += d; });
  server.stderr.on('data', (d) => { bootLog += d; });
  const deadline = Date.now() + 15_000;
  for (;;) {
    try {
      const r = await fetch(`${BASE}/api/roster`);
      if (r.status === 200) break;
    } catch {}
    if (Date.now() > deadline) throw new Error(`server never came up:\n${bootLog}`);
    await new Promise((r) => setTimeout(r, 200));
  }
});

test.after(async () => {
  server?.kill();
  daemon?.close();
  if (home) await fsp.rm(home, { recursive: true, force: true });
});

const answer = (body) => fetch(`${BASE}/api/agent/${encodeURIComponent(PANE)}/answer`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});
const boxes = () => tui.rows.filter((r) => r.kind === 'opt' && !r.plain).map((r) => r.box);

test('multi-select: Submit visible → cursor walks to it, Enter, confirm answered', async () => {
  reset();
  const before = boxes();
  const r = await answer({ submit: true });
  assert.equal(r.status, 200);
  assert.equal(tui.phase, 'done');
  assert.deepEqual(boxes(), before, 'no box was toggled on the way');
  assert.deepEqual(tui.keys, ['Down', 'Down', 'Down', 'Down', 'Down', 'Enter', 'Enter']);
});

test('multi-select, short pane: options scroll under the pinned Submit → stepped, then committed', async () => {
  reset({ viewport: 2 });
  assert.match(screen(), /↓ 2\. \[/, 'fixture: the window shows 1–2, Submit pinned below');
  const before = boxes();
  const r = await answer({ submit: true });
  assert.equal(r.status, 200);
  assert.equal(tui.phase, 'done');
  assert.deepEqual(boxes(), before, 'no box was toggled on the way');
  assert.deepEqual(tui.keys, ['Down', 'Down', 'Down', 'Down', 'Down', 'Enter', 'Enter']);
  // and from past it (cursor parked on "Chat about this") it walks back Up
  reset({ viewport: 2, cursor: 7 });
  assert.equal((await answer({ submit: true })).status, 200);
  assert.deepEqual(tui.keys, ['Up', 'Enter', 'Enter']);
});

test('multi-select: cursor parked on Submit from a failed try → nav answers count from it', async () => {
  reset({ cursor: 5 }); // the Submit row
  assert.match(screen(), /❯    Submit/);
  const r = await answer({ option: 3 });
  assert.equal(r.status, 200);
  assert.deepEqual(tui.keys, ['Up', 'Up', 'Up', 'Enter']);
  assert.equal(tui.rows[2].box, true, 'Enter on option 3 toggled its box');
});

test('multi-select: Enter dropped → 409 with the screen, never a fake ok', async () => {
  reset({ dropEnter: true });
  const r = await answer({ submit: true });
  assert.equal(r.status, 409);
  const body = await r.json();
  assert.match(body.screen, /Submit/);
  assert.equal(tui.phase, 'menu');
});

test('multi-select: a plain menu is not submittable (400), and submit must be true', async () => {
  reset({ mode: 'plain' });
  assert.equal((await answer({ submit: true })).status, 400);
  assert.equal(tui.phase, 'menu', 'no Enter was sent');
  reset();
  assert.equal((await answer({ submit: 'no' })).status, 400);
  assert.equal((await answer({ submit: 1 })).status, 400);
  assert.deepEqual(tui.keys, []);
});
