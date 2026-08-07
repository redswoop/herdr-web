// claudeFindSession correlation ladder, against a fixture $HOME:
//   title match (ai-title / custom-title) > sessionId pin > birthtime filter
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
