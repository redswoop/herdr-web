// Bambu printers: the print you walked away from, as a job row with a bar,
// an ETA, and a ✋ the moment it pauses. Each printer runs its own MQTT
// broker (TLS :8883, user bblp, password = LAN access code); we hold one
// client per printer, keep a merged shadow of its `print` report, and
// run() just serialises the shadow. H2-series send a full report every
// second; P1/A1 send diffs after the first pushall, so we pushall on a
// timer and merge.
//
// Config (signals.json → "bambu"): { printers: [{ name, host, serial, code }],
//   file (TOML with [name] host/ip/serial/code sections, default
//   ~/.config/gaffer/bambu.toml, used when `printers` is absent),
//   hmsAlarm (HMS severity ≤ this bumps the row to alarm; 1 = fatal only) }
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import mqtt from 'mqtt';

const PUSHALL_MS = 5 * 60_000;
const STALE_MS = 90_000; // no report for this long on a connected client = suspect

// stg_cur → what the printer is doing right now (Bambu's stage table)
const STAGES = {
  0: null, 1: 'bed leveling', 2: 'heating bed', 3: 'sweeping xy', 4: 'changing filament', 5: 'M400 pause',
  6: 'paused: filament runout', 7: 'heating hotend', 8: 'calibrating extrusion', 9: 'scanning bed', 10: 'inspecting first layer',
  11: 'identifying plate', 12: 'calibrating lidar', 13: 'homing', 14: 'cleaning nozzle', 15: 'checking extruder temp',
  16: 'paused by user', 17: 'paused: front cover', 18: 'calibrating lidar', 19: 'calibrating flow', 20: 'paused: nozzle temp',
  21: 'paused: bed temp', 22: 'unloading filament', 23: 'paused: skip step', 24: 'loading filament', 25: 'motor noise cal',
  26: 'paused: AMS lost', 27: 'paused: heatbreak fan', 28: 'paused: chamber temp', 29: 'cooling chamber', 30: 'paused: user gcode',
  31: 'motor noise showoff', 32: 'paused: nozzle covered', 33: 'paused: cutter error', 34: 'paused: first layer error', 35: 'paused: nozzle clog',
};

const hex4 = (n) => (n >>> 0).toString(16).toUpperCase().padStart(4, '0');
/** HMS {attr, code} → "0500_0600_0002_0005" + severity (1 fatal … 4 info) */
export function hmsCode({ attr = 0, code = 0 }) {
  return { code: `${hex4(attr >>> 16)}_${hex4(attr & 0xffff)}_${hex4(code >>> 16)}_${hex4(code & 0xffff)}`, severity: (code >>> 16) & 0xffff };
}
export const hmsHref = (code) => `https://wiki.bambulab.com/en/x1/troubleshooting/hmscode/${code}`;

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const col = (hex) => (hex && hex !== '00000000' ? `#${String(hex).slice(0, 6)}` : null);

/** the tray feeding the (active) extruder: H2 packs ams<<8|slot on device.extruder; others use ams.tray_now */
export function feedingTray(p) {
  const ams = p.ams?.ams ?? [];
  const ext = p.device?.extruder?.info;
  let unit = null, slot = null;
  if (Array.isArray(ext) && ext.length) {
    // H2: `temp` is target<<16 | current; the extruder whose current matches
    // nozzle_temper is the one printing. `snow` = ams<<8 | slot (0xFF = none).
    const nz = num(p.nozzle_temper);
    const slotOf = (e) => { const v = num(e?.snow); return v != null && (v & 0xff) !== 0xff ? v : null; };
    const active = ext.find((e) => nz != null && Math.abs((num(e.temp) & 0xffff) - nz) <= 1 && slotOf(e) != null)
      ?? ext.find((e) => slotOf(e) != null);
    const snow = slotOf(active);
    if (snow != null) { unit = snow >> 8; slot = snow & 0xff; }
  } else {
    const now = num(p.ams?.tray_now);
    if (now != null && now !== 255) {
      if (now >= 128) { unit = now; slot = 0; } else { unit = now >> 2; slot = now & 3; }
    }
  }
  if (unit == null) return null;
  const u = ams.find((a) => num(a.id) === unit) ?? ams[unit];
  const t = u?.tray?.find((x) => num(x.id) === slot);
  return t ? { unit: num(u.id), slot, type: t.tray_type, color: col(t.tray_color), remain: num(t.remain) } : null;
}

/** one report → the signal record (pure; the test drives this with captured JSON) */
export function toSignal(name, p, meta = {}, cfg = {}, now = Date.now()) {
  const gs = p.gcode_state ?? 'UNKNOWN';
  const stage = STAGES[num(p.stg_cur) ?? 0] ?? null;
  const pct = num(p.mc_percent);
  const remainMin = num(p.mc_remaining_time);
  const layer = num(p.layer_num), layers = num(p.total_layer_num);
  const nz = num(p.nozzle_temper), nzT = num(p.nozzle_target_temper);
  const bed = num(p.bed_temper), bedT = num(p.bed_target_temper);
  const printErr = num(p.print_error) || 0;
  const hms = (p.hms ?? []).map(hmsCode);
  const fatal = hms.filter((h) => h.severity > 0 && h.severity <= (cfg.hmsAlarm ?? 1));
  const feed = feedingTray(p);
  const task = p.subtask_name || (p.gcode_file ? path.basename(p.gcode_file).replace(/\.(gcode|3mf)$/i, '') : '') || '';

  let state;
  if (!meta.connected) state = 'down';
  else if (printErr || gs === 'FAILED' || fatal.length) state = 'alarm';
  else if (gs === 'PAUSE' || /^paused/.test(stage ?? '')) state = 'needs-you';
  else if (gs === 'RUNNING' || gs === 'PREPARE' || gs === 'SLICING') state = 'busy';
  else if (gs === 'FINISH') state = 'ok';
  else state = 'idle';

  const temp = nz != null ? `${Math.round(nz)}°${nzT ? `/${Math.round(nzT)}` : ''}` : '';
  const bedS = bed != null ? `bed ${Math.round(bed)}°` : '';
  const fil = feed ? `${feed.type ?? '?'}${feed.remain != null && feed.remain >= 0 ? ` ${feed.remain}%` : ''}` : '';
  let detail;
  if (!meta.connected) detail = meta.error ? `mqtt: ${meta.error}` : 'mqtt down';
  else if (state === 'alarm') detail = printErr ? `error ${hex4(printErr >>> 16)}_${hex4(printErr & 0xffff)}` : fatal.length ? `HMS ${fatal[0].code}` : 'failed';
  else if (state === 'needs-you') detail = stage ?? 'paused';
  else if (state === 'busy') detail = [stage, layer != null && layers ? `layer ${layer}/${layers}` : null, temp, bedS, fil].filter(Boolean).join(' · ');
  else if (gs === 'FINISH') detail = `done${task ? ` · ${task}` : ''}`;
  else detail = ['idle', temp ? `nozzle ${temp}` : null].filter(Boolean).join(' · ');

  const items = [];
  for (const u of p.ams?.ams ?? []) {
    const uid = num(u.id);
    const label = uid != null && uid >= 128 ? 'AMS HT' : `AMS ${(uid ?? 0) + 1}`;
    for (const t of u.tray ?? []) {
      if (!t.tray_type) continue;
      const sid = num(t.id);
      const here = feed && feed.unit === uid && feed.slot === sid;
      items.push({
        id: `ams:${uid}:${sid}`,
        label: `${label}·${(sid ?? 0) + 1} ${t.tray_type}`,
        sub: [t.tray_sub_brands || null, num(t.remain) != null && t.remain >= 0 ? `${t.remain}% left` : null, here ? 'feeding' : null].filter(Boolean).join(' · '),
        color: col(t.tray_color),
        state: here ? 'busy' : 'ok',
      });
    }
  }
  const vt = p.vt_tray ?? p.vir_slot?.[0];
  if (vt?.tray_type) items.push({ id: 'ext', label: `ext ${vt.tray_type}`, sub: vt.tray_sub_brands || '', color: col(vt.tray_color), state: 'ok' });
  for (const h of hms) {
    items.push({ id: `hms:${h.code}`, label: `HMS ${h.code}`, sub: ['fatal', 'serious', 'common', 'info'][h.severity - 1] ?? '', href: hmsHref(h.code), state: h.severity <= 1 ? 'alarm' : h.severity === 2 ? 'warn' : 'ok' });
  }

  const actions = gs === 'RUNNING' ? ['pause'] : gs === 'PAUSE' ? ['resume'] : [];
  return {
    key: `bambu:${name}`,
    kind: 'job',
    title: name,
    sub: task || null,
    host: '',
    state,
    value: pct,
    unit: '%',
    pct: state === 'busy' || state === 'needs-you' ? pct : null,
    eta: state === 'busy' && remainMin != null ? remainMin * 60 : null,
    phase: stage,
    detail,
    temps: { nozzle: nz, nozzleTarget: nzT, bed, bedTarget: bedT, chamber: num(p.chamber_temper) },
    layer: layer != null && layers ? { n: layer, of: layers } : null,
    feeding: feed,
    startedAt: meta.startedAt ?? null,
    finishedAt: gs === 'FINISH' || gs === 'FAILED' ? meta.finishedAt ?? null : null,
    seenAt: meta.seenAt ?? now,
    wifi: p.wifi_signal ?? null,
    items,
    actions,
    actionHelp: { pause: 'pause the print (printer keeps heat)', resume: 'resume the paused print' },
  };
}

// ---------- the live side ----------

const clients = new Map(); // name -> { client, printer, shadow, meta, timer }

function merge(into, patch) {
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && into[k] && typeof into[k] === 'object' && !Array.isArray(into[k])) merge(into[k], v);
    else into[k] = v;
  }
}

function connect(printer, log) {
  const rec = { printer, shadow: {}, meta: { connected: false, startedAt: null, finishedAt: null, seenAt: null, error: null }, client: null, timer: null };
  const url = `mqtts://${printer.host}:8883`;
  const client = mqtt.connect(url, {
    username: 'bblp', password: printer.code, rejectUnauthorized: false,
    connectTimeout: 8000, reconnectPeriod: 15_000, keepalive: 30, clientId: `herdr-web-${os.hostname()}-${printer.name}`,
  });
  const pushall = () => client.publish(`device/${printer.serial}/request`, JSON.stringify({ pushing: { sequence_id: '0', command: 'pushall' } }));
  client.on('connect', () => {
    rec.meta.connected = true; rec.meta.error = null;
    client.subscribe(`device/${printer.serial}/report`);
    pushall();
    clearInterval(rec.timer);
    rec.timer = setInterval(pushall, PUSHALL_MS);
  });
  client.on('message', (_t, buf) => {
    let j; try { j = JSON.parse(buf.toString()); } catch { return; }
    if (!j.print) return;
    const prev = rec.shadow.gcode_state;
    merge(rec.shadow, j.print);
    rec.meta.seenAt = Date.now();
    const gs = rec.shadow.gcode_state;
    if (gs !== prev) {
      if (gs === 'RUNNING' && prev !== 'PAUSE') { rec.meta.startedAt = Date.now(); rec.meta.finishedAt = null; }
      if (gs === 'FINISH' || gs === 'FAILED') rec.meta.finishedAt = Date.now();
    }
  });
  client.on('close', () => { rec.meta.connected = false; clearInterval(rec.timer); });
  client.on('error', (e) => { rec.meta.error = e.message; log.warn(`bambu ${printer.name}: ${e.message}`); });
  rec.client = client;
  return rec;
}

async function loadPrinters(cfg) {
  if (Array.isArray(cfg.printers) && cfg.printers.length) return cfg.printers;
  const file = (cfg.file ?? '~/.config/gaffer/bambu.toml').replace(/^~/, os.homedir());
  let text; try { text = await fsp.readFile(file, 'utf8'); } catch { return []; }
  const out = []; let cur = null;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const sec = /^\[([^\]]+)\]$/.exec(line);
    if (sec) { cur = { name: sec[1].trim() }; out.push(cur); continue; }
    const kv = /^(\w+)\s*=\s*"?([^"]*)"?$/.exec(line);
    if (kv && cur) cur[kv[1] === 'ip' ? 'host' : kv[1]] = kv[2];
  }
  return out.filter((p) => p.host && p.serial && p.code);
}

export default {
  id: 'bambu',
  title: 'Printers',
  every: 5000,
  async run(ctx) {
    const printers = await loadPrinters(ctx.config);
    if (!printers.length) return [];
    for (const p of printers) if (!clients.has(p.name)) clients.set(p.name, connect(p, ctx.log));
    const now = Date.now();
    const out = [];
    let busy = false;
    for (const p of printers) {
      const rec = clients.get(p.name);
      const meta = { ...rec.meta };
      if (meta.connected && meta.seenAt && now - meta.seenAt > STALE_MS) { meta.connected = false; meta.error = 'no report'; }
      const sig = toSignal(p.name, rec.shadow, meta, ctx.config, now);
      if (sig.state === 'busy') busy = true;
      out.push(sig);
    }
    return { signals: out, nextIn: busy ? 3000 : 10_000 };
  },
  async act(ctx, sig, action) {
    if (!['pause', 'resume'].includes(action)) throw new Error('unknown action');
    const name = sig.key.replace(/^bambu:/, '').replace(/@.*$/, '');
    const rec = clients.get(name);
    if (!rec?.meta.connected) throw new Error(`${name}: not connected`);
    rec.client.publish(`device/${rec.printer.serial}/request`, JSON.stringify({ print: { command: action, sequence_id: '0', param: '' } }));
    return { ok: true };
  },
  stop() {
    for (const rec of clients.values()) { clearInterval(rec.timer); try { rec.client.end(true); } catch {} }
    clients.clear();
  },
};
