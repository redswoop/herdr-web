// Windowing for GET /api/agent/:pane/transcript.
//
// A pane's whole history can run to many MB (one 725-event claude transcript
// was 14 MB, 13.5 of it tool_result text) — fine on a desktop tab, a long
// stall on a phone over tailscale. Two cuts: oversized tool results are
// clipped here to exactly what the UIs show (shared clip() stops at 20k
// chars), and a client may ask for just the newest `tail` events, aligned to
// a user prompt so a turn's tool_use/tool_result pairs never split.

export const CLIP_CHARS = 20_000;
const CLIP_MARK = '\n… [truncated]';

// Output the UIs clip: tool results and `!` bash stdout/stderr (a `!cat big.log`
// is the same payload as a Read of it).
const CLIPPED = new Set(['tool_result', 'command_out', 'command_err']);

export function trimEvents(events) {
  return events.map((ev) =>
    CLIPPED.has(ev.kind) && typeof ev.text === 'string' && ev.text.length > CLIP_CHARS
      ? { ...ev, text: ev.text.slice(0, CLIP_CHARS) + CLIP_MARK }
      : ev,
  );
}

/**
 * Slice `events` to the `tail` newest before index `end` (0 = the end).
 * When the cut lands mid-turn it moves back to that turn's user prompt, but
 * never further than another `tail` events (a 300-step turn stays bounded).
 * Returns { events, start, total }: `start` is how many older events remain.
 */
export function windowEvents(events, tail = 0, end = 0) {
  const total = events.length;
  const endIdx = end > 0 ? Math.min(end, total) : total;
  if (!(tail > 0)) return { events: events.slice(0, endIdx), start: 0, total };
  let start = Math.max(0, endIdx - tail);
  if (start > 0) {
    const floor = Math.max(0, endIdx - 2 * tail);
    for (let i = start; i >= floor; i--) {
      if (events[i].kind === 'user') { start = i; break; }
    }
  }
  return { events: events.slice(start, endIdx), start, total };
}

// Inputs a one-line tool summary is built from (the watch's "Bash ls -la").
const LITE_INPUT_KEYS = ['command', 'description', 'pattern', 'url', 'query', 'prompt', 'file_path', 'path'];
const LITE_INPUT_CHARS = 200;

/**
 * ?lite=1 — the wrist's cut. Tool results and thinking keep their slot but
 * lose their text; tool calls keep only the input fields a summary line
 * needs, clipped. A 60-event tail drops from ~200 KB to a few.
 */
export function liteEvents(events) {
  return events.map((ev) => {
    if (CLIPPED.has(ev.kind) || ev.kind === 'thought') return { ...ev, text: '' };
    if (ev.kind !== 'tool_use') return ev;
    const input = {};
    if (ev.input && typeof ev.input === 'object') {
      for (const k of LITE_INPUT_KEYS) {
        if (typeof ev.input[k] === 'string') input[k] = ev.input[k].slice(0, LITE_INPUT_CHARS);
      }
    }
    return { ...ev, text: '', input };
  });
}
