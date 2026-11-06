import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { toSignal, hmsCode, feedingTray } from '../lib/probes/bambu.js';

const load = (n) => JSON.parse(fs.readFileSync(new URL(`./fixtures/bambu-${n}.json`, import.meta.url), 'utf8')).print;
const live = { connected: true, seenAt: 1, startedAt: 0, finishedAt: null, error: null };

test('bambu: H2C mid-print → busy job with layer, temps, feeding tray from the extruder word', () => {
  const p = load('h2c');
  const s = toSignal('h2c', p, live);
  assert.equal(s.state, 'busy');
  assert.equal(s.pct, 56);
  assert.equal(s.eta, 49 * 60);
  assert.equal(s.sub, 'Card Shuffler V2');
  assert.deepEqual(s.layer, { n: 25, of: 206 });
  assert.equal(s.temps.nozzle, 220);
  // extruder 0: snow=256 → AMS 2 (id 1) slot 0 → purple PLA
  assert.deepEqual(feedingTray(p), { unit: 1, slot: 0, type: 'PLA', color: '#5E43B7', remain: 21 });
  assert.match(s.detail, /layer 25\/206 · 220°\/220 · bed 40° · PLA 21%/);
  assert.deepEqual(s.actions, ['pause']);
  // 8 loaded trays + external + 6 HMS, feeding one flagged
  const trays = s.items.filter((i) => i.id.startsWith('ams:'));
  assert.equal(trays.length, 7);
  assert.equal(trays.find((i) => i.state === 'busy').id, 'ams:1:0');
  assert.ok(s.items.some((i) => i.id === 'ext' && i.label === 'ext PLA-S'));
  assert.equal(s.items.filter((i) => i.id.startsWith('hms:')).length, 6);
});

test('bambu: P1S diff-style report → tray_now 128 is the AMS HT, chamber junk ignored', () => {
  const p = load('p1s');
  const s = toSignal('p1s', p, live);
  assert.equal(s.state, 'busy');
  assert.deepEqual(feedingTray(p), { unit: 128, slot: 0, type: 'PLA', color: '#000000', remain: 11 });
  assert.ok(s.items.some((i) => i.label === 'AMS HT·1 PLA' && i.state === 'busy'));
  assert.equal(s.temps.chamber, 5);
});

test('bambu: pause → needs-you with the stage as the detail; FINISH → ok; error → alarm; no link → down', () => {
  const p = load('p1s');
  let s = toSignal('p1s', { ...p, gcode_state: 'PAUSE', stg_cur: 6 }, live);
  assert.equal(s.state, 'needs-you');
  assert.equal(s.detail, 'paused: filament runout');
  assert.deepEqual(s.actions, ['resume']);
  s = toSignal('p1s', { ...p, gcode_state: 'FINISH' }, { ...live, finishedAt: 42 });
  assert.equal(s.state, 'ok');
  assert.equal(s.detail, 'done · Card Shuffler V2');
  assert.equal(s.finishedAt, 42);
  assert.equal(s.pct, null, 'no bar on a finished print');
  s = toSignal('p1s', { ...p, print_error: 0x0300400c }, live);
  assert.equal(s.state, 'alarm');
  assert.equal(s.detail, 'error 0300_400C');
  s = toSignal('p1s', p, { ...live, connected: false, error: 'ECONNREFUSED' });
  assert.equal(s.state, 'down');
  assert.equal(s.detail, 'mqtt: ECONNREFUSED');
});

test('bambu: HMS attr/code → wiki code + severity; only fatal bumps the row', () => {
  assert.deepEqual(hmsCode({ attr: 83887616, code: 131077 }), { code: '0500_0600_0002_0005', severity: 2 });
  const p = load('h2c');
  assert.equal(toSignal('h2c', p, live).state, 'busy', 'serious/common HMS do not alarm');
  const fatal = { ...p, hms: [{ attr: 83887616, code: 0x00010001 }] };
  assert.equal(toSignal('h2c', fatal, live).state, 'alarm');
  assert.equal(toSignal('h2c', fatal, live).detail, 'HMS 0500_0600_0001_0001');
});
