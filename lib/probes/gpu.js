// GPU: nvidia-smi on this box — memory, utilisation, temperature, and who
// holds the card (so "GPU busy" reads as "llama-server 24 GB + comfy 0.6 GB",
// not a bare number). Other boxes' GPUs arrive through the gaffer probe.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);

const Q = ['name', 'memory.used', 'memory.total', 'utilization.gpu', 'temperature.gpu', 'power.draw', 'power.limit'];

export default {
  id: 'gpu',
  title: 'GPU',
  every: 3000,
  async run(ctx) {
    let gpus, apps;
    try {
      const [g, a] = await Promise.all([
        run('nvidia-smi', [`--query-gpu=${Q.join(',')}`, '--format=csv,noheader,nounits'], { timeout: 2500 }),
        run('nvidia-smi', ['--query-compute-apps=pid,process_name,used_memory', '--format=csv,noheader,nounits'], { timeout: 2500 }),
      ]);
      gpus = g.stdout.trim().split('\n').filter(Boolean).map((l) => l.split(',').map((s) => s.trim()));
      apps = a.stdout.trim().split('\n').filter(Boolean).map((l) => {
        const [pid, name, mib] = l.split(',').map((s) => s.trim());
        return { pid: Number(pid), name: name.split('/').pop(), mib: Number(mib) };
      });
    } catch (e) {
      if (e.code === 'ENOENT') return []; // no nvidia here: not a failure, just nothing to say
      throw e;
    }
    apps.sort((x, y) => y.mib - x.mib);
    return gpus.map((g, i) => {
      const [name, used, total, util, temp, power, plimit] = g;
      const usedMiB = Number(used), totalMiB = Number(total), u = Number(util);
      const holders = apps.filter((a) => a.mib >= 100);
      const who = holders.slice(0, 3).map((a) => `${a.name} ${a.mib >= 1024 ? `${(a.mib / 1024).toFixed(1)}G` : `${a.mib}M`}`).join(' · ');
      const busy = u >= 25;
      return {
        key: `gpu:${ctx.hostname}:${i}`,
        kind: 'gauge',
        title: name.replace(/^NVIDIA (GeForce )?/, ''),
        host: '',
        state: Number(temp) >= 85 ? 'alarm' : busy ? 'busy' : 'ok',
        value: u,
        unit: '%',
        pct: u,
        mem: { used: usedMiB, total: totalMiB },
        temp: Number(temp),
        power: Number.isFinite(Number(power)) ? Math.round(Number(power)) : null,
        powerLimit: Number.isFinite(Number(plimit)) ? Math.round(Number(plimit)) : null,
        detail: `${(usedMiB / 1024).toFixed(1)} / ${(totalMiB / 1024).toFixed(0)} GB · ${temp}°C${who ? ` · ${who}` : ''}`,
        items: holders.map((a) => ({ id: String(a.pid), label: a.name, sub: `${a.mib} MiB`, state: 'ok' })),
      };
    });
  },
};
