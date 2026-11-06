// Services: the daemons the herd leans on. Three lists — systemd user units,
// docker containers, HTTP endpoints — and the point of each is the row that
// is NOT up. Config: { units: [...], docker: true, http: [{ name, url }] }.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);

const DEFAULT_UNITS = ['herdr', 'herdr-web', 'gaffer-controller', 'gaffer-agent', 'comfyui', 'qwen', 'syncthing'];

async function systemd(units) {
  if (!units.length) return [];
  const { stdout } = await run('systemctl', ['--user', 'show', ...units, '-p', 'Id,ActiveState,SubState,NRestarts,ActiveEnterTimestamp'], { timeout: 4000 });
  return stdout.trim().split('\n\n').map((blk) => {
    const kv = Object.fromEntries(blk.split('\n').map((l) => l.split(/=(.*)/s).slice(0, 2)));
    const id = (kv.Id ?? '').replace(/\.service$/, '');
    const up = kv.ActiveState === 'active';
    const restarts = Number(kv.NRestarts ?? 0);
    return {
      id,
      label: id,
      sub: `${kv.ActiveState}${kv.SubState && kv.SubState !== kv.ActiveState ? ` (${kv.SubState})` : ''}${restarts ? ` · ${restarts} restart${restarts === 1 ? '' : 's'}` : ''}`,
      state: up ? (restarts >= 3 ? 'warn' : 'ok') : kv.ActiveState === 'inactive' ? 'idle' : 'down',
    };
  }).filter((r) => r.id);
}

async function docker() {
  let stdout;
  try { ({ stdout } = await run('docker', ['ps', '-a', '--format', '{{json .}}'], { timeout: 5000 })); } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
  return stdout.trim().split('\n').filter(Boolean).map((l) => {
    const c = JSON.parse(l);
    const up = c.State === 'running';
    return { id: c.ID, label: c.Names, sub: c.Status, state: up ? (/unhealthy/i.test(c.Status) ? 'warn' : 'ok') : 'idle' };
  }).sort((a, b) => (a.state === b.state ? a.label.localeCompare(b.label) : a.state === 'ok' ? 1 : -1));
}

async function http(list) {
  return Promise.all(list.map(async (e) => {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), e.timeoutMs ?? 3000);
    const t0 = Date.now();
    try {
      const r = await fetch(e.url, { method: e.method ?? 'GET', signal: ac.signal, redirect: 'manual' });
      const ms = Date.now() - t0;
      const ok = r.status < 500 && (e.expect ? r.status === e.expect : true);
      return { id: e.name, label: e.name, sub: `${r.status} · ${ms} ms`, state: ok ? (ms > 2000 ? 'warn' : 'ok') : 'down', href: e.ui ?? e.url, ms };
    } catch (err) {
      return { id: e.name, label: e.name, sub: err.name === 'AbortError' ? 'timeout' : (err.cause?.code ?? err.message), state: 'down', href: e.ui ?? e.url };
    } finally { clearTimeout(t); }
  }));
}

const worst = (items, downIs = 'alarm') => items.some((i) => i.state === 'down') ? downIs : items.some((i) => i.state === 'warn') ? 'warn' : 'ok';
const count = (items) => {
  const up = items.filter((i) => i.state === 'ok' || i.state === 'warn').length;
  const down = items.filter((i) => i.state === 'down').length;
  const off = items.filter((i) => i.state === 'idle').length;
  return `${up} up${down ? ` · ${down} DOWN: ${items.filter((i) => i.state === 'down').map((i) => i.label).join(', ')}` : ''}${off ? ` · ${off} stopped` : ''}`;
};

export default {
  id: 'services',
  title: 'Services',
  every: 15_000,
  async run(ctx) {
    const cfg = ctx.config;
    const [units, containers, endpoints] = await Promise.all([
      systemd(cfg.units ?? DEFAULT_UNITS).catch((e) => [{ id: 'systemctl', label: 'systemctl', sub: e.message, state: 'down' }]),
      cfg.docker === false ? null : docker().catch((e) => [{ id: 'docker', label: 'docker', sub: e.message, state: 'down' }]),
      http(cfg.http ?? []),
    ]);
    const out = [{ key: 'svc:systemd', kind: 'list', title: 'units', state: worst(units), detail: count(units), items: units }];
    if (containers) out.push({ key: 'svc:docker', kind: 'list', title: 'docker', state: worst(containers, 'warn'), detail: count(containers), items: containers });
    if (endpoints.length) out.push({ key: 'svc:http', kind: 'list', title: 'endpoints', state: worst(endpoints), detail: count(endpoints), items: endpoints });
    return out;
  },
};
