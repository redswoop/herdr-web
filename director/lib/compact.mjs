// Turn transcript events (herdr-web's normalized TEvent shape) into the
// compact text the director reads. The goal is "what happened", not a
// faithful replay: tool inputs and outputs are clipped hard, thoughts and
// token accounting are dropped.

const CLIP_TEXT = 1500;
const CLIP_TOOL_IN = 240;
const CLIP_TOOL_OUT = 400;

function clip(s, n) {
  s = String(s ?? '').replace(/\s+$/, '');
  if (s.length <= n) return s;
  return `${s.slice(0, n)}… [+${s.length - n} chars]`;
}

function oneLine(s) {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}

/** Pull the interesting bit out of a tool_use input (a command, a path). */
export function toolInputSummary(name, input) {
  if (input == null) return '';
  if (typeof input === 'string') return clip(oneLine(input), CLIP_TOOL_IN);
  if (typeof input !== 'object') return clip(String(input), CLIP_TOOL_IN);
  const i = input;
  const pick = i.command ?? i.cmd ?? i.file_path ?? i.path ?? i.pattern ?? i.query ?? i.url ?? i.prompt ?? i.description;
  if (typeof pick === 'string') return clip(oneLine(pick), CLIP_TOOL_IN);
  try {
    return clip(oneLine(JSON.stringify(i)), CLIP_TOOL_IN);
  } catch {
    return '';
  }
}

/** One event → zero or one compact line(s). */
export function compactEvent(ev) {
  switch (ev.kind) {
    case 'user':
      return `USER: ${clip(ev.text, CLIP_TEXT)}`;
    case 'assistant':
      return `AGENT: ${clip(ev.text, CLIP_TEXT)}`;
    case 'tool_use':
      return `  tool ${ev.name ?? '?'}: ${toolInputSummary(ev.name, ev.input)}`;
    case 'tool_result':
      return ev.text?.trim() ? `  → ${clip(oneLine(ev.text), CLIP_TOOL_OUT)}` : null;
    case 'command':
      return `USER ran ${ev.name ?? ''} ${oneLine(ev.text)}`.trim();
    case 'command_out':
    case 'command_err':
      return ev.text?.trim() ? `  → ${clip(oneLine(ev.text), CLIP_TOOL_OUT)}` : null;
    case 'note':
      return ev.text?.trim() ? `NOTE: ${clip(oneLine(ev.text), CLIP_TOOL_OUT)}` : null;
    case 'interrupted':
      return 'USER interrupted the agent';
    default:
      return null; // thought, usage, salvage
  }
}

/** Many events → the delta text for one tick. */
export function compactEvents(events) {
  const lines = [];
  for (const ev of events) {
    const l = compactEvent(ev);
    if (l) lines.push(l);
  }
  return lines.join('\n');
}

/** Rough token guard: keep the tail of a long delta, note what was cut. */
export function budget(text, maxChars) {
  if (text.length <= maxChars) return text;
  const cut = text.length - maxChars;
  const tail = text.slice(cut);
  const nl = tail.indexOf('\n');
  return `[… ${cut} earlier chars omitted …]\n${nl === -1 ? tail : tail.slice(nl + 1)}`;
}
