// claudeFindSession correlation ladder, against a fixture $HOME:
//   pid registry > title match (ai-title / custom-title) > sessionId pin > birthtime filter
//   (startedAfter) > newest mtime. This is the claude twin of the grok
//   clobber-scan logic — previously untested.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// HOME must be set before adapters.js captures os.homedir()
const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'herdr-claude-find-'));
process.env.HOME = home;
const { adapterFor } = await import('../lib/adapters.js');
const find = adapterFor('claude').find;

const CWD = '/work/proj';
const projDir = path.join(home, '.claude', 'projects', CWD.replace(/[/.]/g, '-'));

const line = (obj) => `${JSON.stringify(obj)}\n`;
const sid = (n) => `00000000-0000-0000-0000-00000000000${n}`;

async function mkSession(id, { title, customTitle, mtime } = {}) {
  await fsp.mkdir(projDir, { recursive: true });
  const p = path.join(projDir, `${id}.jsonl`);
  let body = line({ type: 'user', message: { content: 'hello' }, timestamp: '2026-08-06T00:00:00Z' });
  if (title) body += line({ type: 'ai-title', aiTitle: title });
  if (customTitle) body += line({ type: 'custom-title', customTitle, sessionId: id });
  await fsp.writeFile(p, body);
  if (mtime) await fsp.utimes(p, new Date(mtime), new Date(mtime));
  return p;
}

before(async () => {
  const now = Date.now();
  // newest mtime, no title — the mtime-tier default
  await mkSession(sid(1), { mtime: now });
  // older, but carries the ai-title the pane's terminal shows
  await mkSession(sid(2), { title: 'fix the flux pipeline', mtime: now - 60_000 });
  // renamed by the user: custom-title written AFTER an earlier ai-title
  await mkSession(sid(3), { title: 'old auto title', customTitle: 'my renamed session', mtime: now - 120_000 });
});

after(() => fsp.rm(home, { recursive: true, force: true }));

test('title match beats newest mtime', async () => {
  const hit = await find(CWD, { title: 'fix the flux pipeline' });
  assert.equal(hit?.sessionId, sid(2));
});

test('terminal titles with decoration still match (endsWith/startsWith)', async () => {
  const hit = await find(CWD, { title: '✳ fix the flux pipeline' });
  assert.equal(hit?.sessionId, sid(2));
});

test('custom-title (user rename) supersedes the earlier ai-title', async () => {
  const hit = await find(CWD, { title: 'my renamed session' });
  assert.equal(hit?.sessionId, sid(3), 'a renamed session must not defeat title correlation');
});

test('sessionId pin wins when no title matches', async () => {
  const hit = await find(CWD, { title: 'no such title anywhere', sessionId: sid(3) });
  assert.equal(hit?.sessionId, sid(3));
});

test('no hints → newest mtime', async () => {
  const hit = await find(CWD, {});
  assert.equal(hit?.sessionId, sid(1));
});

test('startedAfter refuses files created before the pane process', async () => {
  // every fixture file was created (birthtime) now; a pane whose process
  // starts an hour from now owns none of them
  const hit = await find(CWD, { startedAfter: Date.now() + 3_600_000 });
  assert.equal(hit, null, 'a fresh pane must not bind a neighbor\'s session');
});

test('startedAfter accepts files created after the process start', async () => {
  const hit = await find(CWD, { startedAfter: Date.now() - 5_000 });
  assert.equal(hit?.sessionId, sid(1), 'own-file filter should keep the newest qualifying file');
});

test('unknown project dir → null, not a throw', async () => {
  assert.equal(await find('/does/not/exist', {}), null);
});

// ---------- pid registry tier (claude ≥ 2.1.290) ----------
// ~/.claude/sessions/<pid>.json is an exact binding; the test process itself
// stands in for the pane's claude so /proc/<pid>/stat is live.

const regDir = path.join(home, '.claude', 'sessions');
// null where there's no /proc (mac): the adapter falls back to a liveness check
const HAS_PROC = await fsp.access('/proc/self/stat').then(() => true, () => false);
async function procStart(pid) {
  if (!HAS_PROC) return null;
  const stat = await fsp.readFile(`/proc/${pid}/stat`, 'utf8');
  return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19];
}
async function mkRegistry({ sessionId, cwd = CWD, procStart: ps, pid = process.pid, ...extra }) {
  await fsp.mkdir(regDir, { recursive: true });
  await fsp.writeFile(path.join(regDir, `${pid}.json`), JSON.stringify({
    pid, sessionId, cwd, startedAt: Date.now(), procStart: ps ?? await procStart(pid), version: '2.1.292', ...extra,
  }));
}

test('pid registry is an exact binding — beats title and mtime', async () => {
  await mkRegistry({ sessionId: sid(3) });
  const hit = await find(CWD, { pid: process.pid, title: 'fix the flux pipeline' });
  assert.equal(hit?.sessionId, sid(3));
});

test('pid registry: a live cwd that moved still finds the launch-cwd jsonl', async () => {
  await mkRegistry({ sessionId: sid(3), cwd: '/moved/into/a/worktree' });
  const hit = await find('/also/not/the/launch/cwd', { pid: process.pid });
  assert.equal(hit?.sessionId, sid(3), 'should scan every project dir for the registered id');
});

test('pid registry: registered but no jsonl yet → null, never a sibling\'s file', async () => {
  await mkRegistry({ sessionId: sid(9) });
  const hit = await find(CWD, { pid: process.pid, startedAfter: Date.now() - 5_000 });
  assert.equal(hit, null, 'a fresh registered session must read as pending');
});

// the procStart guard needs /proc; on mac a reused pid is indistinguishable
test('pid registry: an entry left by a dead process (pid reused) is ignored', { skip: !HAS_PROC && 'no /proc' }, async () => {
  await mkRegistry({ sessionId: sid(3), procStart: '1' });
  const hit = await find(CWD, { pid: process.pid });
  assert.equal(hit?.sessionId, sid(1), 'stale registry → fall through to the heuristic ladder');
});

test('pid registry: missing entry → heuristic ladder (older claude)', async () => {
  await fsp.rm(path.join(regDir, `${process.pid}.json`), { force: true });
  const hit = await find(CWD, { pid: process.pid, title: 'fix the flux pipeline' });
  assert.equal(hit?.sessionId, sid(2));
});

// ---------- exclude: joint allocation across sibling panes ----------

test('exclude keeps the mtime guess off a sibling\'s file', async () => {
  const hit = await find(CWD, { exclude: new Set([sid(1)]) });
  assert.equal(hit?.sessionId, sid(2));
});

test('exclude applies to the created-since tier too', async () => {
  const hit = await find(CWD, { startedAfter: Date.now() - 5_000, exclude: new Set([sid(1)]) });
  assert.equal(hit?.sessionId, sid(2));
});

test('exclude never overrides an exact tier (pin, title)', async () => {
  const pinned = await find(CWD, { sessionId: sid(1), exclude: new Set([sid(1)]) });
  assert.equal(pinned?.sessionId, sid(1));
  const titled = await find(CWD, { title: 'fix the flux pipeline', exclude: new Set([sid(2)]) });
  assert.equal(titled?.sessionId, sid(2));
});

// ---------- continued-in: parked conversations (claude ≥ 2.1.310) ----------
// Parking forks the history into a new jsonl and leaves
// {"type":"continued-in","continuedInSessionId"} at the old file's tail.
// Correlation must land on the file the replies are actually going to.

const continued = (from, to) => line({ type: 'continued-in', timestamp: '2026-10-24T14:28:34.330Z', sessionId: from, continuedInSessionId: to });

before(async () => {
  const old = Date.now() - 600_000; // older than every mtime-tier fixture
  await mkSession(sid(4), { mtime: old });
  await fsp.appendFile(path.join(projDir, `${sid(4)}.jsonl`), continued(sid(4), sid(5)));
  await mkSession(sid(5), { mtime: old });
  await fsp.appendFile(path.join(projDir, `${sid(5)}.jsonl`), continued(sid(5), sid(6)));
  await mkSession(sid(6), { title: 'Whisparr automatic download setup', mtime: old });
  // continued, then live again: a user turn after the pointer voids it
  await mkSession(sid(7), { mtime: old });
  await fsp.appendFile(path.join(projDir, `${sid(7)}.jsonl`),
    continued(sid(7), sid(6)) + line({ type: 'user', message: { role: 'user', content: 'back here' }, timestamp: '2026-10-24T15:00:00Z' }));
  // pointer to a worker that hasn't written its file yet
  await mkSession(sid(8), { mtime: old });
  await fsp.appendFile(path.join(projDir, `${sid(8)}.jsonl`), continued(sid(8), sid(9)));
  for (const n of [4, 5, 6, 7, 8]) await fsp.utimes(path.join(projDir, `${sid(n)}.jsonl`), new Date(old), new Date(old));
});

test('continued-in: the pid-registered session follows its pointer to the worker file', async () => {
  await mkRegistry({ sessionId: sid(5) });
  const hit = await find(CWD, { pid: process.pid });
  assert.equal(hit?.sessionId, sid(6));
  assert.ok(hit.file.endsWith(`${sid(6)}.jsonl`));
  assert.equal(hit.continuedFrom, sid(5), 'the id the pane is registered under rides along');
  await fsp.rm(path.join(regDir, `${process.pid}.json`), { force: true });
});

test('continued-in: chains hop more than once', async () => {
  const hit = await find(CWD, { sessionId: sid(4) });
  assert.equal(hit?.sessionId, sid(6));
  assert.equal(hit.continuedFrom, sid(4));
});

test('continued-in: a user/assistant record after the pointer means the file is live again', async () => {
  const hit = await find(CWD, { sessionId: sid(7) });
  assert.equal(hit?.sessionId, sid(7));
  assert.equal(hit.continuedFrom, undefined);
});

test('continued-in: a pointer to a file that does not exist yet keeps the current file', async () => {
  const hit = await find(CWD, { sessionId: sid(8) });
  assert.equal(hit?.sessionId, sid(8));
});

test('continued-in: an appended record re-evaluates the memoised tail', async () => {
  const p = path.join(projDir, `${sid(8)}.jsonl`);
  await mkSession(sid(9), { mtime: Date.now() - 600_000 });
  await fsp.appendFile(p, line({ type: 'file-history-snapshot', snapshot: {} }));
  const hit = await find(CWD, { sessionId: sid(8) });
  assert.equal(hit?.sessionId, sid(9), 'once the worker file appears the pointer resolves');
});

// Observed 2026-10-24 on homarr: /clear typed into a parked pane runs in the
// worker, which takes a fresh session id and writes NO continued-in anywhere.
// The chain dead-ends on the pre-clear file; the worker's own registry entry
// (jobId = the pane's parkedJobId) is the only thing that knows the new id.
test('parked: the worker registry (by jobId) beats a chain that dead-ends after a /clear', async () => {
  const cleared = '00000000-0000-0000-0000-0000000000c1';
  await mkSession(cleared, { mtime: Date.now() - 600_000 });
  await mkRegistry({ sessionId: sid(5), parkedJobId: 'deadbeef' }); // pane: chain → sid(6), stale
  await mkRegistry({ pid: process.ppid, sessionId: cleared, kind: 'bg', jobId: 'deadbeef' });
  const hit = await find(CWD, { pid: process.pid });
  assert.equal(hit?.sessionId, cleared, 'must follow the worker, not the pre-clear file');
  assert.equal(hit.continuedFrom, sid(5));
  // worker gone: the last-seen worker session still wins over the chain
  await fsp.rm(path.join(regDir, `${process.ppid}.json`), { force: true });
  await new Promise((r) => setTimeout(r, 1600));
  const after = await find(CWD, { pid: process.pid });
  assert.equal(after?.sessionId, cleared);
  await fsp.rm(path.join(regDir, `${process.pid}.json`), { force: true });
});
