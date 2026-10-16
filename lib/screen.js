// Screen-text parsers: everything that reads meaning out of a raw TUI pane
// capture. Pure functions of the screen string — no rpc, no fs — so the whole
// grammar zoo is testable against captured fixtures (test/screen.test.mjs).
//
// Three menu grammars live here, plus grok's plan-approval overlay (not a menu):
//   claude  "❯ 1. Label" numbered cursor menus (permission prompts,
//           AskUserQuestion, plan approval with its free-text feedback row)
//   grok    "1 (●) Label  Description" radio menus with an optional
//           "z (○) Type your answer here" free-text row (permission prompts,
//           ask_user_question, the first-run project picker)
//   codex   "› 1. Label  Description" numbered cursor menus (approval
//           prompts, startup dialogs, the /permissions and /model pickers)
//   grok    plan.md preview with an a/s/q action bar — herdr stays "working"
//           while this is up; Esc returns focus, it does not dismiss (q does)
// All menus normalize to the same MenuOption shape ({n, label, description,
// selected, input?}) so blocked-context, notifications, and the answer routes
// don't care which agent drew the menu. Grok plan approval synthesizes that
// shape with n=1/2/3 mapped to keys a/s/q.

// ---------- claude menus ----------

// Parse a claude TUI menu: numbered ("❯ 1. Label", below) first, then the
// unnumbered cursor form (the folder-trust prompt).
export function parseMenuScreen(text) {
  return parseNumberedMenu(text) ?? parseCursorMenuScreen(text);
}

// Parse a numbered TUI menu (claude AskUserQuestion / permission prompts,
// and anything else shaped like "❯ 1. Label" with indented descriptions).
function parseNumberedMenu(text) {
  const lines = text.split('\n');
  // menus taller than the panel carry ↑/↓ scroll markers on the edge rows
  // (seen on /rewind's confirm step) — an option hiding behind one still counts
  const optRe = /^\s*(?:[↑↓]\s+)?(❯)?\s*(\d+)\.\s+(.+)$/;
  const opts = [];
  const optLines = []; // line index of each option row, parallel to opts
  let firstIdx = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(optRe);
    if (m) {
      opts.push({ n: +m[2], label: m[3].trim(), description: '', selected: !!m[1] });
      optLines.push(i);
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
  // AskUserQuestion carries the same trap: a "Type something." row that a
  // rule fences off from the trailing "Chat about this". Same structural
  // approach — the rule between two option rows marks the row above it, since
  // the label is the placeholder only until someone types. Verified against
  // claude v2.1.283 (2026-09), where stray digit taps became "55636".
  let form;
  for (let i = 0; i + 1 < opts.length; i += 1) {
    const between = lines.slice(optLines[i] + 1, optLines[i + 1]);
    if (between.some((l) => /^\s*[─═╌]{8,}\s*$/.test(l))) {
      opts[i].input = true;
      form = 'ask';
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
  return {
    kind: 'menu', header, question, detail: detail.join('\n'), options: opts,
    ...(form ? { form } : {}),
  };
}

// Claude's startup dialogs draw an UNNUMBERED cursor list — the folder-trust
// prompt, verified against claude v2.1.288 (2026-10):
//   ─────────────────────────────
//    Accessing workspace:
//    /home/armen/src/thing
//    Quick safety check: Is this a project you created or one you trust? …
//    ❯ No, exit
//      Yes, I trust this folder
//    Enter to confirm · Esc to cancel
// Digits do nothing here; only ↑/↓ + Enter answer it. Rows get synthetic
// n=1.. and the menu carries nav:true so callers answer by cursor navigation
// ({option}), never by digit. The footer as the LAST line of the screen is
// the anchor — a bare ❯ alone would match the composer.
export function parseCursorMenuScreen(text) {
  const lines = text.split('\n');
  let end = lines.length - 1;
  while (end >= 0 && !lines[end].trim()) end -= 1;
  if (end < 0 || !/^\s*Enter to confirm\b/.test(lines[end])) return null;
  end -= 1;
  while (end >= 0 && !lines[end].trim()) end -= 1;
  const opts = [];
  let i = end;
  for (; i >= 0 && lines[i].trim(); i -= 1) {
    const m = lines[i].match(/^\s*(❯)?\s*(.*\S)\s*$/);
    opts.unshift({ n: 0, label: m[2], description: '', selected: !!m[1] });
  }
  if (opts.length < 2 || opts.filter((o) => o.selected).length !== 1) return null;
  opts.forEach((o, k) => { o.n = k + 1; });
  // the dialog body above the rows, up to its top rule: blank-line-separated
  // paragraphs, terminal-wrapped lines rejoined
  const paras = [];
  let cur = [];
  let ruled = false;
  for (let j = i; j >= 0; j -= 1) {
    const t = lines[j].trim();
    if (/^[─═╌]{8,}$/.test(t)) { ruled = true; break; }
    if (t) { cur.unshift(t); continue; }
    if (cur.length) { paras.unshift(cur.join(' ')); cur = []; }
  }
  if (cur.length) paras.unshift(cur.join(' '));
  // no rule = no telling where the dialog starts; keep only what hugs the rows
  const body = ruled ? paras : paras.slice(-2);
  let question = body.shift() ?? '';
  // "Accessing workspace:" + the path on its own line read as one heading
  if (/:$/.test(question) && body.length) question += ` ${body.shift()}`;
  return {
    kind: 'menu', header: '', question, detail: body.join('\n'), options: opts, nav: true,
  };
}

// ---------- codex menus ----------

// Codex draws every picker the same way — a numbered list with a › cursor,
// descriptions column-aligned on the SAME row (2+ space gap, wrapped
// continuations indented under the description), no borders, and a key-hint
// footer. Verified against codex 0.162 (2026-10):
//   Update Model Permissions
//
//   1. Ask for approval  Read and edit workspace files and run commands, with
//                        approval required for internet access or edits …
// › 2. Approve for me    Only ask for actions detected as potentially unsafe
//   3. Full Access       Use with caution: …
//
//   enter select · esc back
// Approval prompts are the same list under a "Would you like to …?" block
// (layout NOT yet captured live — the picker rows above are):
//   Would you like to run the following command?
//
//   $ touch /tmp/x
//
// › 1. Yes, proceed (y)
//   2. Yes, and don't ask again for commands that start with `touch` (p)
//   3. No, and tell Codex what to do differently (esc)
// The sent-message echo and the composer also start with ›, so the cursor
// only counts on a numbered row of a 1..N run.
export function parseCodexMenuScreen(text) {
  const lines = text.split('\n');
  const optRe = /^\s*(›)?\s*(\d+)\.\s+(.+)$/;
  // the LAST contiguous 1..N run holding the cursor — transcript above may
  // carry numbered prose
  let best = null;
  let run = null;
  const close = () => {
    if (run && run.opts.length >= 2 && run.opts.some((o) => o.selected)) best = run;
    run = null;
  };
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(optRe);
    if (m) {
      const n = +m[2];
      if (run && n !== run.opts.length + 1) close();
      if (!run) {
        if (n !== 1) continue;
        run = { first: i, opts: [] };
      }
      const gap = m[3].trim().match(/^(.*?)\s{2,}(.*)$/);
      run.opts.push({
        n,
        label: gap ? gap[1].trim() : m[3].trim(),
        description: gap ? gap[2].trim() : '',
        selected: !!m[1],
      });
    } else if (run) {
      // a deeply indented line continues the row above (wrapped description
      // or label); anything else — blank included — ends the run
      if (/^\s{5,}\S/.test(lines[i])) {
        const o = run.opts[run.opts.length - 1];
        const field = o.description ? 'description' : 'label';
        o[field] += ` ${lines[i].trim()}`;
      } else {
        close();
      }
    }
  }
  close();
  if (!best) return null;
  // Heading: the nearest "…?" line within reach (approval prompts), with
  // whatever sits between it and the rows as detail.
  const above = [];
  for (let i = best.first - 1; i >= 0 && above.length < 14; i -= 1) {
    const t = lines[i].trim();
    if (/^[›•]/.test(t)) break; // transcript: sent echo / agent bullet
    above.unshift(t);
  }
  const body = above.filter(Boolean);
  const qAt = body.findLastIndex((t) => /\?$/.test(t));
  let question = qAt >= 0 ? body[qAt] : '';
  let detail = qAt >= 0 ? body.slice(qAt + 1).join('\n') : '';
  if (qAt < 0) {
    // no standalone question line: take the paragraph hugging the rows — a
    // picker title, or prose like the folder-trust dialog's "Trust this
    // folder? Codex can read, edit, …" (first sentence asks, rest explains)
    while (above.length && !above[above.length - 1]) above.pop();
    const para = above.slice(above.lastIndexOf('') + 1).join(' ');
    const cut = para.indexOf('? ');
    question = cut >= 0 ? para.slice(0, cut + 1) : para;
    detail = cut >= 0 ? para.slice(cut + 2) : '';
  }
  return { kind: 'menu', header: '', question, detail, options: best.opts };
}

// Text on codex's composer: the last ›-line of the screen (earlier ones are
// sent-message echoes). An empty composer shows dim placeholder text there,
// which a plain capture can't tell from typed text — callers may only test
// it for a specific expected string.
export function codexComposerText(screen) {
  const lines = screen.split('\n');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (/^\s*›/.test(lines[i])) return lines[i].replace(/^\s*›/, '').trim();
  }
  return null;
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

// One entry point for "is there an answerable menu on this screen": the
// agent's own grammar first, falling back to the others so a mixed/unknown
// pane still parses. Order matters only when two could match, which the
// grammars' anchors (❯ N. vs N (●) vs › N.) make effectively impossible.
const MENU_GRAMMARS = { claude: parseMenuScreen, grok: parseGrokMenuScreen, codex: parseCodexMenuScreen };
export function parseMenuFor(kind, text) {
  const own = MENU_GRAMMARS[kind] ?? parseMenuScreen;
  for (const parse of [own, ...Object.values(MENU_GRAMMARS).filter((g) => g !== own)]) {
    const menu = parse(text);
    if (menu) return menu;
  }
  return null;
}

// Grok's first-run project picker ("Run Grok Build in a project directory?")
// owns the screen on a fresh spawn in an untrusted directory and swallows any
// prompt sent before it's dismissed. createChat auto-answers it with option 1
// (current directory — the cwd the caller asked for).
export function isGrokProjectPicker(text) {
  return /Run Grok Build in a project directory\?/.test(text);
}

// Grok's fullscreen viewers (the transcript/message viewer and kin) are
// MODAL: they own the whole pane and advertise their hotkeys in a footer like
//   Esc:close │ /:search │ f:filter │ v:select │ w:wrap │ r:raw
// While one is up, agent.prompt still acks "ok" but the text lands in the
// viewer — characters can trigger its hotkeys — and never reaches the
// composer (hit live 2026-08-07). "Esc:close" in the footer region is the
// signature; the composer's own help line never says it. Only the bottom
// chrome rows are checked so a transcript that merely quotes the string
// can't false-positive.
export function isGrokModalOverlay(text) {
  const lines = text.split('\n').filter((l) => l.trim());
  return lines.slice(-4).some((l) => /Esc:close/i.test(l));
}

// Grok's exit_plan_mode surface is a scrollable plan.md preview with a letter
// action bar, NOT a radio menu. herdr reports the pane as working the whole
// time (the tool_call stays Pending). Verified against grok 4.6 (2026-09):
//   ◆ Waiting on plan approval
//   a approve  |  s request changes  |  c comment  |  y copy plan  |  q quit plan
//   Grok 4.6 (high) · plan approval
// Esc from the prompt returns focus to the preview; q is the only dismiss.
export function isGrokPlanApproval(text) {
  return /Waiting on plan approval/i.test(text)
    || (/q:?\s*quit plan/i.test(text) && /plan approval/i.test(text));
}

export function parseGrokPlanApproval(text) {
  if (!isGrokPlanApproval(text)) return null;
  const comments = +(text.match(/c\s+comment(?:\s+(\d+))?/i)?.[1] ?? 0);
  const withComments = /a\s+approve\s+w\/\s+comments/i.test(text) || comments > 0;
  return {
    kind: 'plan',
    dialect: 'grok',
    plan: '',
    question: 'Waiting on plan approval',
    comments,
    options: [
      {
        n: 1,
        label: withComments ? 'Approve with comments' : 'Approve and start building',
        description: withComments
          ? 'a — sends pending line comments with the approval'
          : 'a',
        selected: false,
      },
      {
        n: 2,
        label: 'Request changes',
        description: 's — type feedback and send; stays in plan mode',
        selected: false,
        input: true,
      },
      {
        n: 3,
        label: 'Quit plan',
        description: 'q — Esc does not dismiss this overlay',
        selected: false,
      },
    ],
  };
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
// (rules + ❯ + ⏵⏵ status, ✻ spinner), grok (╭│╰ box + help line) and codex
// (› composer + "model · cwd" status row + shortcuts hint).
const CHROME_RES = [
  /^\s*$/,
  /^\s*[╭╰]─/, // box top/bottom
  /^\s*─{5,}\s*$/, // horizontal rule
  /^\s*│.*│\s*$/, // boxed input/status line
  /^\s*[❯›]/, // bare input line (claude ❯, codex ›)
  /^\s*⏵/, // claude status line
  /^\s+\S.* · [~/]\S*\s*$/, // codex status row: "model effort · cwd"
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
      if (/^[>❯›]/.test(m) && echoMatch(m.slice(1).trim())) {
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
