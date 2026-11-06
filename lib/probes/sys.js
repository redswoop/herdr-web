// Host vitals: cpu %, memory, load. One tile; the point is the sparkline
// and knowing when the box is pegged by something a session started.
import fsp from 'node:fs/promises';
import os from 'node:os';

let lastCpu = null;
async function cpuPct() {
  const line = (await fsp.readFile('/proc/stat', 'utf8')).split('\n')[0];
  const n = line.trim().split(/\s+/).slice(1).map(Number);
  const idle = n[3] + (n[4] ?? 0);
  const total = n.reduce((a, b) => a + b, 0);
  const prev = lastCpu;
  lastCpu = { idle, total };
  if (!prev || total === prev.total) return null;
  return Math.round((1 - (idle - prev.idle) / (total - prev.total)) * 100);
}

async function memInfo() {
  const txt = await fsp.readFile('/proc/meminfo', 'utf8');
  const get = (k) => Number((txt.match(new RegExp(`^${k}:\\s+(\\d+)`, 'm')) ?? [])[1] ?? 0) * 1024;
  return { total: get('MemTotal'), avail: get('MemAvailable'), swapTotal: get('SwapTotal'), swapFree: get('SwapFree') };
}

export default {
  id: 'sys',
  title: 'Host',
  every: 4000,
  async run(ctx) {
    const [cpu, mem] = await Promise.all([cpuPct(), memInfo()]);
    const [l1, l5] = os.loadavg();
    const cores = os.cpus().length;
    const memPct = Math.round(((mem.total - mem.avail) / mem.total) * 100);
    const swapUsed = mem.swapTotal - mem.swapFree;
    const out = [];
    if (cpu != null) {
      out.push({
        key: `sys:${ctx.hostname}:cpu`, kind: 'gauge', title: 'cpu', value: cpu, unit: '%', pct: cpu,
        state: cpu >= 90 ? 'busy' : 'ok',
        detail: `load ${l1.toFixed(1)} / ${l5.toFixed(1)} on ${cores} cores · up ${Math.floor(os.uptime() / 3600)}h`,
      });
    }
    out.push({
      key: `sys:${ctx.hostname}:mem`, kind: 'gauge', title: 'mem', value: memPct, unit: '%', pct: memPct,
      state: memPct >= 92 ? 'alarm' : memPct >= 80 ? 'warn' : 'ok',
      detail: `${((mem.total - mem.avail) / 1e9).toFixed(1)} / ${(mem.total / 1e9).toFixed(0)} GB${swapUsed > 1e9 ? ` · swap ${(swapUsed / 1e9).toFixed(1)} GB` : ''}`,
    });
    return out;
  },
};
