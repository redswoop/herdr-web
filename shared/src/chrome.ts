/** claude/grok composer + status furniture at the bottom of the screen —
 *  cut it so the tail is output, not chrome */
export const TAIL_CHROME_RES = [
  /^\s*$/,
  /^\s*─{5,}\s*$/,
  /^\s*❯/,
  /^\s*[⏸⏵]/,
  /esc to interrupt/,
  /\? for shortcuts/i,
  /shift\+tab/i,
];

/** Peel trailing chrome. `│…│` rows are ambiguous — the composer box AND
 *  rendered markdown tables both paint them — so they only peel inside a
 *  ROUNDED box (╰…╭, the composers'); tables use sharp corners (└…┌) and
 *  stop the peel, keeping a streaming table visible instead of frozen. */
export function stripChrome(lines: string[]): number {
  let end = lines.length;
  let inBox = false;
  while (end > 0) {
    const l = lines[end - 1];
    if (/^\s*╰─/.test(l)) {
      inBox = true;
      end -= 1;
      continue;
    }
    if (/^\s*╭─/.test(l)) {
      inBox = false;
      end -= 1;
      continue;
    }
    if (/^\s*│.*│\s*$/.test(l)) {
      if (!inBox) break;
      end -= 1;
      continue;
    }
    if (TAIL_CHROME_RES.some((re) => re.test(l))) {
      end -= 1;
      continue;
    }
    break;
  }
  return end;
}

/** lines that are TUI furniture, not command output */
const TUI_CHROME_RES = [
  /^[─═╌▔]+$/, // rules
  /^[╭╰╮╯│]/, // box borders
  /^❯/, // input line / menu cursor
  /^⏸|^⏵/, // status line
  /\? for shortcuts/,
  /esc to interrupt/,
  /^[✻✳✶✢✽]\s/, // spinner
  /^●\s+\S+ · \/effort$/, // effort chip
];

export function isTuiChrome(line: string): boolean {
  return TUI_CHROME_RES.some((re) => re.test(line));
}

/** claude's idle/working status line — if it's back at the bottom of the
 *  screen, the dialog is gone and the mirror should go too */
const CHROME_RE = /\? for shortcuts|esc to interrupt|shift\+tab/i;

export function chromeVisible(raw: string): boolean {
  const tail = raw
    .split('\n')
    .filter((l) => l.trim())
    .slice(-3)
    .join('\n');
  return CHROME_RE.test(tail);
}
