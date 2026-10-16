import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { adapterFor, lastTurnAt } from '../lib/adapters.js';

const line = (o) => JSON.stringify(o) + '\n';

test('lastTurnAt skips untimestamped bookkeeping claude appends to idle transcripts', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-turn-'));
  const file = path.join(dir, 's.jsonl');
  fs.writeFileSync(file,
    line({ type: 'user', timestamp: '2026-10-15T03:06:00.000Z', message: { role: 'user', content: 'fix the cache' } }) +
    line({ type: 'assistant', timestamp: '2026-10-15T03:12:15.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] } }) +
    line({ type: 'system', subtype: 'away_summary', timestamp: '2026-10-15T03:15:17.000Z', content: 'recap' }) +
    line({ type: 'bridge-session' }) +
    line({ type: 'atis-latch' }));
  assert.equal(await lastTurnAt(adapterFor('claude'), file), Date.parse('2026-10-15T03:12:15.000Z'));
  fs.rmSync(dir, { recursive: true });
});

test('lastTurnAt is null for a transcript with no turns yet', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-turn-'));
  const file = path.join(dir, 's.jsonl');
  fs.writeFileSync(file, line({ type: 'bridge-session' }));
  assert.equal(await lastTurnAt(adapterFor('claude'), file), null);
  fs.rmSync(dir, { recursive: true });
});
