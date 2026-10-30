import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { cleanPins, tilde } from '../lib/places.js';

const H = os.homedir();

test('pins are stored ~/-relative, normalised and de-duplicated', () => {
  assert.deepEqual(cleanPins([`${H}/Sync/`, '~/Sync', '/mnt/data/renders', '~/a/../b', '~']), [
    '~/Sync',
    '/mnt/data/renders',
    '~/b',
    '~',
  ]);
});

test('pins drop relative paths, non-strings and overflow', () => {
  assert.deepEqual(cleanPins(['rel/path', 42, null, 'x'.repeat(2000)]), []);
  assert.deepEqual(cleanPins('not a list'), []);
  assert.equal(cleanPins(Array.from({ length: 30 }, (_, i) => `/p${i}`)).length, 20);
});

test('tilde leaves paths outside home alone', () => {
  assert.equal(tilde(`${H}x/y`), `${H}x/y`); // a sibling that shares the prefix
  assert.equal(tilde(H), '~');
});
