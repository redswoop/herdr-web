// Scene: what belongs to ONE session, so the chat view can show its own two
// or three live things instead of the whole deck. Candidates are found
// mechanically; lib/director.js ranks and captions them.
import { adapterFor } from '../adapters.js';
import { beatFor } from './herd.js';
import { direct } from '../director.js';

const MENTION = [
  // things a transcript names → the signal sources/keys they imply
  { re: /\b(comfy|comfyui)\b/i, key: 'svc:http', item: 'comfyui', why: 'it drives ComfyUI' },
  { re: /\b(stash)\b/i, key: 'svc:http', item: 'stash', why: 'it works against Stash' },
  { re: /\b(sab|sabnzbd|nzb|usenet)\b/i, key: 'sab:queue', why: 'it queued downloads' },
  { re: /\b(plex)\b/i, key: 'svc:http', item: 'plex', why: 'it touches Plex' },
  { re: /\b(vram|cuda|nvidia-smi|comfy|bake|upscal|flashvsr|seedvr|lora training|gaffer lease gpu)/i, source: 'gpu', why: 'it needs the card' },
  { re: /\b(qwen|llama-server|arbiter)\b/i, key: 'svc:http', item: 'qwen', why: 'it talks to the local model' },
];

function textOf(beat) {
  return (beat?.texts ?? []).slice(-12).map((t) => t.text).join('\n');
}

export default {
  id: 'scene',
  title: 'Scene',
  every: 6000,
  async run(ctx) {
    const roster = ctx.roster();
    const store = ctx.store;
    const out = [];
    for (const a of roster.agents ?? []) {
      const cands = [];
      const seen = new Set();
      const add = (sig, why, attached = false, item = null) => {
        if (!sig || seen.has(sig.key)) return;
        seen.add(sig.key);
        cands.push({ sig, why, attached, item });
      };
      const cwd = (a.cwd ?? '').replace(/\/$/, '');
      // 1. jobs launched from here (gaffer cwd, pushed signals)
      for (const s of store.signals.values()) {
        if (s.kind !== 'job' || !s.attach) continue;
        if (s.attach.paneId === a.paneId) add(s, 'reported by this session', true);
        else if (s.attach.cwd && cwd && (s.attach.cwd.replace(/\/$/, '') === cwd || (a.repoRoot && s.attach.cwd.startsWith(a.repoRoot)))) add(s, 'launched from here', true);
      }
      // 2. what the transcript keeps naming
      const file = ctx.sessionFile?.(a.paneId);
      const beat = file ? beatFor(file) : null;
      const text = textOf(beat);
      if (text) {
        for (const s of store.bySource('disk')) {
          if (s.title !== '/' && text.includes(s.title)) add(s, `it writes under ${s.title}`);
        }
        for (const m of MENTION) {
          if (!m.re.test(text)) continue;
          if (m.source) { for (const s of store.bySource(m.source)) add(s, m.why); }
          else if (m.key) {
            const s = store.get(m.key);
            if (!s) continue;
            if (m.item) { if ((s.items ?? []).some((i) => i.id === m.item)) add(s, m.why, false, m.item); }
            else add(s, m.why);
          }
        }
      }
      // 3. anything loud that lives in this session's project
      for (const s of store.signals.values()) {
        if ((s.state === 'needs-you' || s.state === 'alarm') && s.attach?.cwd && cwd && s.attach.cwd.startsWith(cwd)) add(s, 'needs you, from here', true);
      }
      if (!cands.length) continue;
      const beatSig = store.get(`beat:${a.paneId}`);
      const { cast, by } = await direct({
        paneId: a.paneId,
        sessionId: a.sessionId,
        status: a.status,
        cwd: a.cwd,
        mtimeMs: beat?.mtimeMs ?? 0,
        recap: beatSig?.recap ?? null,
        said: beatSig?.said ?? null,
      }, cands, ctx);
      if (!cast.length) continue;
      const items = cast.map((c) => {
        const cand = cands.find((x) => x.sig.key === c.key);
        return { id: c.key, label: c.why, state: cand?.sig.state ?? 'ok', item: cand?.item ?? null };
      });
      const worst = items.reduce((w, i) => (['needs-you', 'alarm', 'down', 'warn', 'busy', 'ok', 'idle'].indexOf(i.state) < ['needs-you', 'alarm', 'down', 'warn', 'busy', 'ok', 'idle'].indexOf(w) ? i.state : w), 'idle');
      out.push({
        key: `scene:${a.paneId}`,
        kind: 'list',
        title: 'scene',
        state: worst,
        by,
        items,
        attach: { paneId: a.paneId },
        detail: `${items.length} on stage · ${by}`,
      });
    }
    return out;
  },
};
