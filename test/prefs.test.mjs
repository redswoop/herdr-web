import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanPrefs } from '../lib/prefs.js';

test('cleanPrefs keeps well-formed theme + hex colors only', () => {
  const p = cleanPrefs({
    theme: 'cyber',
    colors: {
      cyber: { red: '#FF9A3C', accent: 'url(evil)', 'bad key!': '#000000' },
      default: { accent: '#12345' },
      neon: { red: '#ffffff' },
    },
    palette: { cyber: 'custom', default: '<script>', neon: 'arasaka' },
    base: { cyber: 'arasaka' },
  });
  assert.deepEqual(p, {
    theme: 'cyber',
    colors: { cyber: { red: '#ff9a3c' } },
    palette: { cyber: 'custom' },
    base: { cyber: 'arasaka' },
  });
});

test('cleanPrefs falls back to the stock theme', () => {
  const empty = { theme: 'default', colors: {}, palette: {}, base: {} };
  assert.deepEqual(cleanPrefs({ theme: 'vaporwave' }), empty);
  assert.deepEqual(cleanPrefs(null), empty);
});
