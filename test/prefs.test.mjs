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
  });
  assert.deepEqual(p, { theme: 'cyber', colors: { cyber: { red: '#ff9a3c' } } });
});

test('cleanPrefs falls back to the stock theme', () => {
  assert.deepEqual(cleanPrefs({ theme: 'vaporwave' }), { theme: 'default', colors: {} });
  assert.deepEqual(cleanPrefs(null), { theme: 'default', colors: {} });
});
