// Disk: free space per real mount, sampled often enough that the store's
// slope says "freeing at 1.2 GB/min" while a cleanup runs. Mounts come from
// /proc/mounts (ext4/xfs/btrfs/nfs/cifs…), or config.mounts to pin the list.
import fsp from 'node:fs/promises';
import { GB, fmtBytes, fmtDur } from '../signals.js';

const REAL_FS = new Set(['ext4', 'ext3', 'xfs', 'btrfs', 'zfs', 'f2fs', 'nfs', 'nfs4', 'cifs', 'smb3', 'fuse.sshfs', 'exfat', 'ntfs3', 'vfat']);
const SKIP = /^\/(boot|snap|var\/lib\/docker|run|dev|sys|proc)(\/|$)/;

async function realMounts() {
  const txt = await fsp.readFile('/proc/mounts', 'utf8');
  const out = [];
  for (const line of txt.split('\n')) {
    const [dev, mnt, type] = line.split(' ');
    if (!mnt || !REAL_FS.has(type) || SKIP.test(mnt)) continue;
    // the same export mounted twice (nfs + cifs of one NAS share) is one disk
    if (out.some((m) => m.mnt === mnt)) continue;
    const remote = /^(nfs|cifs|smb|fuse)/.test(type);
    out.push({ dev, mnt: mnt.replace(/\\040/g, ' '), type, remote });
  }
  return out;
}

function stateFor(free, total, cfg) {
  const warn = (cfg.warnGb ?? 60) * GB;
  const alarm = (cfg.alarmGb ?? 20) * GB;
  // big volumes: thresholds scale so a 49 TB NAS isn't "alarm" at 20 GB
  const scale = Math.max(1, total / (2000 * GB));
  if (free < alarm * scale) return 'alarm';
  if (free < warn * scale) return 'warn';
  return 'ok';
}

export default {
  id: 'disk',
  title: 'Disk',
  every: 5000,
  async run(ctx) {
    const cfg = ctx.config;
    const mounts = cfg.mounts
      ? cfg.mounts.map((m) => (typeof m === 'string' ? { mnt: m } : m))
      : await realMounts();
    const out = [];
    const seenRemote = [];
    for (const m of mounts) {
      let st;
      try {
        // a sleeping NAS can hang statfs: race it against a short timer
        st = await Promise.race([
          fsp.statfs(m.mnt),
          new Promise((_, rej) => setTimeout(() => rej(new Error('statfs timeout')), 2500)),
        ]);
      } catch (e) {
        out.push({ key: `disk:${m.mnt}`, kind: 'gauge', title: m.label ?? m.mnt, state: 'down', detail: e.message, host: m.host ?? '' });
        continue;
      }
      const total = st.bsize * st.blocks;
      const free = st.bsize * st.bavail;
      // one NAS export mounted twice (nfs + cifs) reports identical numbers: one disk
      if (m.remote) {
        // nfs and cifs round differently: same size and free within 1% is one share
        if (seenRemote.some((r) => Math.abs(r.total - total) < total * 0.001 && Math.abs(r.free - free) < total * 0.01)) continue;
        seenRemote.push({ total, free });
      }
      const used = total - st.bsize * st.bfree;
      const prev = ctx.store.get(`disk:${m.mnt}`);
      const rate = prev?.rate ?? null; // bytes/s, from the store's history slope
      let detail = `${fmtBytes(free)} free of ${fmtBytes(total)}`;
      // a drift under ~2 MB/s over ten minutes is noise (logs, caches)
      if (rate != null && Math.abs(rate) > 2e6) {
        const perMin = fmtBytes(Math.abs(rate) * 60);
        detail += rate > 0 ? ` · freeing ${perMin}/min` : ` · filling ${perMin}/min`;
        if (rate < 0) {
          const alarmAt = (cfg.alarmGb ?? 20) * GB;
          const left = (free - alarmAt) / -rate;
          if (left > 0 && left < 6 * 3600) detail += ` · hits ${fmtBytes(alarmAt)} in ${fmtDur(left)}`;
        }
      }
      if (prev?.first != null && prev.since && Math.abs(free - prev.first) > 0.5 * GB) {
        const d = free - prev.first;
        detail += ` · ${d > 0 ? '+' : '−'}${fmtBytes(Math.abs(d))} since ${new Date(prev.since).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}`;
      }
      out.push({
        key: `disk:${m.mnt}`,
        kind: 'gauge',
        title: m.label ?? m.mnt,
        host: m.host ?? '',
        state: stateFor(free, total, cfg),
        value: free,
        unit: 'B',
        total,
        used,
        pct: Math.round((used / total) * 100),
        detail,
        href: m.mnt,
        remote: !!m.remote,
      });
    }
    return out;
  },
};
