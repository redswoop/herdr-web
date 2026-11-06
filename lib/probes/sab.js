// SABnzbd: the download you just queued, as a progress bar you don't have
// to go find. Config: { url, apiKey, ui } — no url, no probe.
import { fetchJson, fmtBytes } from '../signals.js';

const hms = (s) => {
  const m = /^(\d+):(\d\d):(\d\d)$/.exec(s ?? '');
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
};

export default {
  id: 'sab',
  title: 'Downloads',
  every: 15_000,
  async run(ctx) {
    const { url, apiKey, ui } = ctx.config;
    if (!url || !apiKey) return [];
    const api = (mode, extra = '') => fetchJson(`${url.replace(/\/$/, '')}/api?mode=${mode}&output=json&apikey=${encodeURIComponent(apiKey)}${extra}`, { timeoutMs: 4000 });
    const [q, h] = await Promise.all([api('queue', '&limit=12'), api('history', '&limit=6')]);
    const queue = q.queue ?? {};
    const slots = queue.slots ?? [];
    const mb = Number(queue.mb ?? 0), mbleft = Number(queue.mbleft ?? 0);
    const speed = Number(queue.kbpersec ?? 0) * 1024;
    const downloading = /download/i.test(queue.status ?? '') && slots.length > 0;
    const paused = !!queue.paused;
    const state = downloading ? 'busy' : paused && slots.length ? 'warn' : slots.length ? 'idle' : 'idle';
    const detail = slots.length
      ? `${paused ? 'paused · ' : ''}${fmtBytes(speed)}/s · ${fmtBytes(mbleft * 1e6)} left · ${queue.timeleft ?? '?'}`
      : 'queue empty';
    const out = [{
      key: 'sab:queue',
      kind: 'job',
      title: 'usenet',
      host: ctx.config.host ?? '',
      state,
      value: speed,
      unit: 'B/s',
      done: mb - mbleft,
      total: mb || null,
      pct: mb ? Math.round(((mb - mbleft) / mb) * 100) : null,
      eta: hms(queue.timeleft),
      detail,
      href: ui ?? url,
      items: slots.map((s) => ({
        id: s.nzo_id,
        label: s.filename,
        sub: `${s.cat ?? ''} · ${s.size ?? ''} · ${s.timeleft ?? ''}`.replace(/^ · /, ''),
        pct: Number(s.percentage ?? 0),
        state: /paus/i.test(s.status ?? '') ? 'idle' : /download/i.test(s.status ?? '') ? 'busy' : 'idle',
      })),
      actions: slots.length ? [paused ? 'resume' : 'pause'] : [],
    }];
    const hist = h.history?.slots ?? [];
    if (hist.length) {
      out.push({
        key: 'sab:history',
        kind: 'list',
        title: 'landed',
        state: hist.some((s) => s.status === 'Failed') ? 'warn' : 'ok',
        detail: `${hist.filter((s) => s.status === 'Completed').length} landed lately`,
        items: hist.map((s) => ({
          id: s.nzo_id,
          label: s.name,
          sub: `${s.category ?? ''} · ${s.size ?? ''} · ${s.status}${s.fail_message ? ` · ${s.fail_message}` : ''}`,
          state: s.status === 'Failed' ? 'alarm' : s.status === 'Completed' ? 'ok' : 'busy',
          at: s.completed ? s.completed * 1000 : null,
        })),
      });
    }
    return { signals: out, nextIn: downloading ? 3000 : 15_000 };
  },
  async act(ctx, sig, action) {
    const { url, apiKey } = ctx.config;
    if (!['pause', 'resume'].includes(action)) throw new Error('unknown action');
    return fetchJson(`${url.replace(/\/$/, '')}/api?mode=${action}&output=json&apikey=${encodeURIComponent(apiKey)}`);
  },
};
