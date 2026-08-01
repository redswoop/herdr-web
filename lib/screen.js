// Screen-text parsers: everything that reads meaning out of a raw TUI pane
// capture. Pure functions of the screen string — no rpc, no fs — so the whole
// grammar zoo is testable against captured fixtures (test/screen.test.mjs).
//
// Two menu grammars live here:
//   claude  "❯ 1. Label" numbered cursor menus (permission prompts,
//           AskUserQuestion, plan approval with its free-text feedback row)
//   grok    "1 (●) Label  Description" radio menus with an optional
//           "z (○) Type your answer here" free-text row (permission prompts,
//           ask_user_question, the first-run project picker)
// Both normalize to the same MenuOption shape ({n, label, description,
// selected, input?}) so blocked-context, notifications, and the answer routes
// don't care which agent drew the menu.

// ---------- claude menus ----------

// Parse a numbered TUI menu (claude AskUserQuestion / permission prompts,
// and anything else shaped like "❯ 1. Label" with indented descriptions).
export function parseMenuScreen(text) {
  const lines = text.split('\n');
  // menus taller than the panel carry ↑/↓ scroll markers on the edge rows
  // (seen on /rewind's confirm step) — an option hiding behind one still counts
  const optRe = /^\s*(?:[↑↓]\s+)?(❯)?\s*(\d+)\.\s+(.+)$/;
  const opts = [];
  let firstIdx = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(optRe);
    if (m) {
      opts.push({ n: +m[2], label: m[3].trim(), description: '', selected: !!m[1] });
      if (firstIdx < 0) firstIdx = i;
    } else if (opts.length && /^\s{3,}\S/.test(lines[i]) && !/^[─═╌\s]+$/.test(lines[i])) {
      const o = opts[opts.length - 1];
      o.description += (o.description ? ' ' : '') + lines[i].trim();
    }
  }
  if (opts.length < 2 || opts[0].n !== 1) return null;
  for (let i = 1; i < opts.length; i += 1) {
    if (opts[i].n !== opts[i - 1].n + 1) return null; // not a real menu
  }
  // real menus have a ❯ cursor; numbered lists in prose don't
  if (!opts.some((o) => o.selected)) return null;
  // The plan prompt's last row ("Tell Claude what to change") is a free-text
  // field: once ❯ sits on it, digits and letters TYPE into it instead of
  // selecting. Its hint line (swallowed into the description above) is the
  // reliable structural marker — the label itself is whatever got typed.
  for (const o of opts) {
    if (/shift\+tab to approve with this feedback/i.test(o.description)) {
      o.input = true;
      o.description = '';
    }
  }
  let question = '';
  let header = '';
  let qIdx = -1;
  for (let i = firstIdx - 1; i >= 0; i -= 1) {
    const t = lines[i].trim();
    if (!t || /^[─═│╭╮╰╯╌|]+$/.test(t)) continue;
    const cb = t.match(/^[☐☒✔✓■□]\s*(.*)$/);
    if (cb) { header = cb[1]; continue; }
    question = t;
    qIdx = i;
    break;
  }
  // context above the question (e.g. the command a permission prompt is
  // about) up to the enclosing border
  const detail = [];
  for (let i = qIdx - 1; i >= 0 && qIdx > 0 && detail.length < 12; i -= 1) {
    const t = lines[i].trim();
    if (!t) continue; // menus space their sections with blank lines
    if (/^[─═│╭╮╰╯╌|]+$/.test(t)) break; // enclosing border = top of menu
    detail.unshift(t);
  }
  return { kind: 'menu', header, question, detail: detail.join('\n'), options: opts };
}

// ---------- grok menus ----------

// Grok draws its prompts as a ┃-guttered block of radio rows:
//   ┃  Create probe-ok.txt via touch          ← detail
//   ┃  touch probe-ok.txt                     ← question (nearest line)
//   ┃  1 (●) Yes, and don't ask again …
//   ┃  2 (○) Yes, proceed
//   ┃  3 (○) No, reject (type to add feedback)
//   ┃  z (○) Type your answer here            ← free-text row (ask menus)
// (●) marks the selection; a bare digit press selects AND submits. Rows can
// carry a trailing █ scrollbar cell, and ask_user_question rows column-align
// "Label   Description" with 2+ spaces between. Verified against grok 4.5.
export function parseGrokMenuScreen(text) {
  const lines = text.split('\n');
  const optRe = /^\s*┃?\s*(\d+|z)\s+\(([●○])\)\s+(.+?)\s*█?\s*$/;
  const opts = [];
  let firstIdx = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(optRe);
    if (!m) {
      if (opts.length) break; // options are one contiguous run
      continue;
    }
    const body = m[3].trim();
    // "Label   Description" — a 2+ space gap splits them; single-spaced
    // rows are all label
    const gap = body.match(/^(.*?)\s{2,}(.*)$/);
    const isInput = m[1] === 'z';
    opts.push({
      n: isInput ? 0 : +m[1],
      label: gap ? gap[1].trim() : body,
      description: gap ? gap[2].trim() : '',
      selected: m[2] === '●',
      ...(isInput ? { input: true } : {}),
    });
    if (firstIdx < 0) firstIdx = i;
  }
  const numbered = opts.filter((o) => !o.input);
  if (numbered.length < 2 || numbered[0].n !== 1) return null;
  for (let i = 1; i < numbered.length; i += 1) {
    if (numbered[i].n !== numbered[i - 1].n + 1) return null;
  }
  // question = nearest content line above the options inside the ┃ block
  let question = '';
  let qIdx = -1;
  for (let i = firstIdx - 1; i >= 0; i -= 1) {
    const t = lines[i].replace(/^\s*┃\s?/, '').trim();
    if (!t) continue;
    if (!/^\s*┃/.test(lines[i])) break; // left the block
    question = t;
    qIdx = i;
    break;
  }
  const detail = [];
  for (let i = qIdx - 1; i >= 0 && qIdx > 0 && detail.length < 12; i -= 1) {
    if (!/^\s*┃/.test(lines[i])) break;
    const t = lines[i].replace(/^\s*┃\s?/, '').trim();
    if (!t) continue;
    detail.unshift(t);
  }
  return { kind: 'menu', header: '', question, detail: detail.join('\n'), options: opts };
}

// One entry point for "is there an answerable menu on this screen": picks the
// grammar by agent kind, falling back to the other so a mixed/unknown pane
// still parses. Selection order matters only when both could match, which the
// grammars' anchors (❯ N. vs N (●)) make effectively impossible.
export function parseMenuFor(kind, text) {
  const first = kind === 'grok' ? parseGrokMenuScreen : parseMenuScreen;
  const second = kind === 'grok' ? parseMenuScreen : parseGrokMenuScreen;
  return first(text) ?? second(text);
}

// Grok's first-run project picker ("Run Grok Build in a project directory?")
// owns the screen on a fresh spawn in an untrusted directory and swallows any
// prompt sent before it's dismissed. createChat auto-answers it with option 1
// (current directory — the cwd the caller asked for).
export function isGrokProjectPicker(text) {
  return /Run Grok Build in a project directory\?/.test(text);
}

// ---------- rewind panel (claude) ----------

// Claude's /rewind panel, verified live against v2.1.2xx. Step 1 is an
// UNNUMBERED cursor list: blank-line-separated entries of [message line,
// change-summary lines…], ❯ on the selected row, "(current)" as the bottom
// entry. Step 2 ("Confirm you want to restore…") is a normal numbered ❯ menu
// under a │-quoted message and "The code/conversation will…" effect lines.
export function parseRewindScreen(text) {
  const lines = text.split('\n');
  let h = -1;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (lines[i].trim() === 'Rewind') { h = i; break; }
  }
  if (h === -1) return null;
  const body = lines.slice(h + 1);
  // fresh/just-forked sessions: the panel opens but offers nothing
  if (body.some((l) => /Nothing to rewind/.test(l))) return { step: 'empty' };
  if (body.some((l) => /Confirm you want to restore/.test(l))) {
    const menu = parseMenuScreen(text);
    if (!menu) return null;
    return {
      step: 'confirm',
      message: body.filter((l) => /^\s*│/.test(l))
        .map((l) => l.replace(/^\s*│\s?/, '').trimEnd()).join('\n').trim(),
      effects: body.filter((l) => /^\s*The \S+ will/.test(l)).map((l) => l.trim()),
      warning: body.find((l) => /^\s*⚠/.test(l))?.trim() ?? null,
      options: menu.options,
    };
  }
  const items = [];
  let cur = null;
  const flush = () => { if (cur) { items.push(cur); cur = null; } };
  for (const l of body) {
    if (/Enter to continue/.test(l)) break;
    const t = l.trim();
    if (!t) { flush(); continue; }
    if (/^Restore the code/.test(t)) continue;
    const selected = /^\s*❯/.test(l);
    const s = t.replace(/^❯\s*/, '');
    if (!cur || selected) {
      flush();
      cur = { message: s, detail: [], selected, current: s === '(current)' };
    } else {
      cur.detail.push(s);
    }
  }
  flush();
  if (!items.length || !items.some((i) => i.selected)) return null;
  return {
    step: 'list',
    checkpoints: items.map((i, idx) => ({
      index: idx,
      message: i.message,
      detail: i.detail.join('\n'),
      selected: i.selected,
      current: i.current,
    })),
  };
}

// ---------- composer & permission mode (claude) ----------

// Text sitting on claude's composer — the LAST bare-❯ line of the screen.
// Used to refuse opening rewind over a stranded TUI draft, and to salvage
// the message a conversation-restore prefills there.
export function composerText(screen) {
  const lines = screen.split('\n');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (/^\s*❯/.test(lines[i])) return lines[i].replace(/^\s*❯/, '').trim();
  }
  return null;
}

// eslint-disable-next-line no-control-regex
const SGR_RE = /\x1b\[([0-9;]*)m/g;

// USER-typed text on the composer, read from an ANSI capture. Claude renders
// what the user typed with NO foreground styling, but paints its own composer
// furniture — predictive/ghost suggestions, hints, sent-echo text — in color
// (dim or gray/white fg). A plain-text guard can't tell them apart and used
// to refuse /rewind over a "draft" that was only a ghost suggestion. Rule:
// a run counts as typed iff, at that point, no dim attribute and no gray-ish
// foreground is active (default fg and pure white bg-styled text pass).
export function typedComposerText(ansiScreen) {
  const lines = ansiScreen.split('\n');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const plain = lines[i].replace(SGR_RE, '');
    if (!/^\s*❯/.test(plain)) continue;
    // walk the line, tracking SGR state, keeping only unghosted runs
    let dim = false;
    let ghostFg = false;
    let out = '';
    let rest = lines[i];
    let m;
    let last = 0;
    SGR_RE.lastIndex = 0;
    while ((m = SGR_RE.exec(rest)) !== null) {
      if (!dim && !ghostFg) out += rest.slice(last, m.index);
      last = m.index + m[0].length;
      const codes = m[1].split(';').map(Number);
      for (let j = 0; j < codes.length; j += 1) {
        const c = codes[j];
        if (c === 0) { dim = false; ghostFg = false; }
        else if (c === 2) dim = true;
        else if (c === 22) dim = false;
        else if (c === 39) ghostFg = false;
        else if (c === 38 && codes[j + 1] === 2) {
          const [r, g, b] = codes.slice(j + 2, j + 5);
          // gray triple = claude chrome/ghost; leave bright/colored text alone
          ghostFg = r === g && g === b && r <= 200;
          j += 4;
        } else if ((c >= 30 && c <= 37) || (c >= 90 && c <= 97)) {
          ghostFg = c === 90 || c === 37; // bright black / dim white = ghost
        }
      }
    }
    if (!dim && !ghostFg) out += rest.slice(last);
    return out.replace(/^\s*❯/, '').trim();
  }
  return null;
}

// Claude's permission mode lives ONLY in the TUI footer (no herdr rpc exposes
// it — state_labels is pane-reported and nothing reports it). Footer strings
// verified against claude v2.1.220; herdr appends "· ← N agent" so match the
// marker, not the whole line. The shift+tab ring: manual → accept edits →
// plan → (bypass, only when enabled) → auto → manual.
export const MODE_RES = [
  [/⏸ manual mode on/, 'default'],
  [/⏵⏵ accept edits on/, 'acceptEdits'],
  [/⏸ plan mode on/, 'plan'],
  [/⏵⏵ auto mode on/, 'auto'],
  [/⏵⏵ bypass permissions on/, 'bypassPermissions'],
];
export const MODES = MODE_RES.map(([, m]) => m);

// Only the footer region — a mode string quoted in scrollback must not match.
export function parseMode(screen) {
  const lines = screen.split('\n').filter((l) => l.trim());
  for (const l of lines.slice(-6)) {
    for (const [re, mode] of MODE_RES) if (re.test(l)) return mode;
  }
  return 'unknown';
}

// ---------- interrupt salvage ----------

// Trim a raw pane capture down to the content worth salvaging: cut the
// composer/status chrome off the bottom and, when the stopped prompt's echo
// is findable, everything above it. Chrome patterns cover claude code
// (rules + ❯ + ⏵⏵ status, ✻ spinner) and grok (╭│╰ box + help line).
const CHROME_RES = [
  /^\s*$/,
  /^\s*[╭╰]─/, // box top/bottom
  /^\s*─{5,}\s*$/, // horizontal rule
  /^\s*│.*│\s*$/, // boxed input/status line
  /^\s*❯/, // bare input line
  /^\s*⏵/, // claude status line
  /^\s*[✻✳✶✢✽]\s/, // spinner / "Cogitated for 1m 6s"
  /esc to interrupt/,
  /shift\+tab/i,
  /shortcuts/i,
];
export function trimSalvage(text, promptText) {
  // grok panes carry a █ scrollbar column on the right edge — pure noise in a
  // salvage block
  const lines = text.split('\n').map((l) => l.replace(/\s*█\s*$/, ''));
  let end = lines.length;
  while (end > 0 && CHROME_RES.some((re) => re.test(lines[end - 1]))) end -= 1;
  let start = 0;
  const firstLine = (promptText ?? '').split('\n')[0].trim().slice(0, 40);
  if (firstLine) {
    // the echo can be truncated by the terminal ("> Write an ess…"), so match
    // on the shorter of echo vs prompt — but never on fewer than 8 chars
    const echoMatch = (echo) => {
      const n = Math.min(echo.length, firstLine.length);
      return n >= Math.min(8, firstLine.length) && echo.slice(0, n) === firstLine.slice(0, n);
    };
    for (let i = end - 1; i >= 0; i -= 1) {
      const m = lines[i].trim();
      if ((m.startsWith('>') || m.startsWith('❯')) && echoMatch(m.slice(1).trim())) {
        start = i + 1;
        break;
      }
    }
  }
  const out = lines
    .slice(start, end)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return out ? out.slice(-8000) : null;
}
