// The stage manager's pure parts: prompt building, cursor resume, delta
// splitting, and the per-workspace scheduler. manager.mjs wires these to
// the daemon and the claude CLI; this file has no I/O so it can be tested.
import { compactEvents, budget } from './compact.mjs';

export const NOTES_LINES = 40;

/** The nudge a headless director turn receives. */
export function buildPrompt({ ws, label, agents, notes, deltas, scene, first }) {
  const paneLines = agents
    .map((a) => `- ${a.paneId}: ${a.displayAgent ?? a.agent} "${a.label ?? a.title}" — ${a.status}, cwd ${a.cwd ?? '?'}`)
    .join('\n');
  const delta = deltas.length
    ? deltas.map(({ paneId, text }) => `[pane ${paneId}]\n${text}`).join('\n\n')
    : '(nothing new in the transcripts — a status changed)';
  return [
    `You are the director for workspace ${ws}${label && label !== ws ? ` ("${label}")` : ''}. Scene scope: ws:${ws}.`,
    `PANES:\n${paneLines || '(none)'}`,
    `YOUR NOTES (your only memory; ${first ? 'none yet — this is your first turn here' : 'from your last turn'}):\n${notes || '(empty)'}`,
    `SINCE YOU LAST LOOKED:\n${delta}`,
    `SCENE NOW:\n${scene}`,
    first
      ? 'First turn: call scene_catalog once, then dress the stage for where the story is. Call transcript_tail for any pane whose context you need.'
      : 'Adjust the scene with scene_apply if the story moved; otherwise leave it.',
    `Then call notes_write with your rewritten notes (≤ ${NOTES_LINES} lines: the story, what is on stage and why, what to watch for, what you decided not to show). Use knowledge_append only for durable facts about the machine. Reply with ONE line.`,
  ].join('\n\n');
}

/** Body of the collapsed `director` card the manager keeps on stage. */
export function buildLogBody({ line, notes, turns, cost }) {
  return `${line || '(no reply)'}\n\n---\n${(notes ?? '').trim() || '(no notes)'}\n\n_turn ${turns} · $${(cost ?? 0).toFixed(2)} total_`;
}

/**
 * Where to open a pane's transcript stream, given the persisted cursor and
 * the current transcript head. Same session and a cursor behind the head →
 * resume at the cursor (the server replays the gap). Otherwise start at the
 * head and seed a glimpse of the recent story.
 */
export function resumeOffset(cursor, transcript, { glimpse = 40 } = {}) {
  const head = transcript.offset ?? 0;
  const events = transcript.events ?? [];
  if (cursor && cursor.sessionId === transcript.sessionId && cursor.offset <= head) {
    return { offset: cursor.offset, seed: [], unseenBytes: head - cursor.offset };
  }
  return { offset: head, seed: events.slice(-glimpse), unseenBytes: 0 };
}

/**
 * Turn each pane's pending events into a budgeted delta. The character
 * budget is split across the panes that actually have something.
 */
export function splitDeltas(panes, deltaChars) {
  const live = panes.filter((p) => p.pending.length);
  const per = Math.floor(deltaChars / Math.max(1, live.length));
  return live.map((p) => ({
    paneId: p.paneId,
    events: p.pending,
    text: budget(compactEvents(p.pending), per),
  }));
}

/**
 * Per-workspace turn scheduler: debounce, a floor between turns, single
 * flight per workspace, a global concurrency cap, and re-queue when a turn
 * throws or when more arrives mid-turn.
 */
export class Scheduler {
  constructor({ run, debounce = 3000, minGap = 20_000, concurrency = 2, slotRetry = 5000, log = () => {} }) {
    this.run = run;
    this.debounce = debounce;
    this.minGap = minGap;
    this.concurrency = concurrency;
    this.slotRetry = slotRetry;
    this.log = log;
    this.ws = new Map();
    this.running = 0;
  }

  state(ws) {
    let r = this.ws.get(ws);
    if (!r) {
      r = { timer: null, want: false, running: false, lastTick: 0, why: '', turns: 0 };
      this.ws.set(ws, r);
    }
    return r;
  }

  schedule(ws, why, delay = this.debounce) {
    const r = this.state(ws);
    r.want = true;
    r.why = why;
    if (r.timer || r.running) return;
    const gap = Math.max(delay, this.minGap - (Date.now() - r.lastTick));
    this.log(`[${ws}] turn in ${(gap / 1000).toFixed(1)}s (${why})`);
    r.timer = setTimeout(() => {
      r.timer = null;
      this.fire(ws).catch((e) => this.log(`[${ws}] turn failed: ${e.message ?? e}`));
    }, gap);
  }

  async fire(ws) {
    const r = this.state(ws);
    if (!r.want || r.running) return;
    if (this.running >= this.concurrency) {
      this.log(`[${ws}] waiting for a slot (${this.running} turns running)`);
      r.timer = setTimeout(() => {
        r.timer = null;
        this.fire(ws).catch(() => {});
      }, this.slotRetry);
      return;
    }
    r.running = true;
    r.want = false;
    this.running += 1;
    const why = r.why;
    try {
      await this.run(ws, why);
      r.turns += 1;
    } catch (e) {
      this.log(`[${ws}] turn error: ${e.message ?? e}`);
      r.want = true; // retry with the next schedule
    } finally {
      r.running = false;
      r.lastTick = Date.now();
      this.running -= 1;
      if (r.want) this.schedule(ws, 'queued during turn');
    }
  }

  /** cancel every pending timer (tests, shutdown) */
  stop() {
    for (const r of this.ws.values()) {
      if (r.timer) clearTimeout(r.timer);
      r.timer = null;
      r.want = false;
    }
  }
}
