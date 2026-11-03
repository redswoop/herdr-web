/**
 * Escape-first markdown AST parser. Produces blocks/inlines from raw text;
 * rendering (HTML or RN Text) is a separate concern.
 */

export type Align = 'left' | 'center' | 'right' | '';

export type Inline =
  | { type: 'text'; text: string }
  /** `text` is the plain inner text (markers stripped) — what copy/flatten
   *  use; `inlines` is the inner markup when the run had any (`**a *b* c**`),
   *  and a renderer that has it nests, otherwise it shows `text` */
  | { type: 'strong'; text: string; href?: string; inlines?: Inline[] }
  | { type: 'em'; text: string; inlines?: Inline[] }
  | { type: 'code'; text: string; file?: string; href?: string }
  | { type: 'link'; href: string; text: string }
  | { type: 'file'; path: string; text: string };

export type Block =
  | { type: 'code'; lang: string; text: string }
  | { type: 'table'; header: Inline[][]; aligns: Align[]; rows: Inline[][][] }
  | { type: 'para'; inlines: Inline[] }
  /** `![alt](src)` on a line of its own; `src` is as written (relative to
   *  the document, or a URL) — the renderer decides whether to show it */
  | { type: 'image'; src: string; alt: string };

const IMAGE = /!\[([^\]\n]*)\]\(([^\s)]+)\)/g;
const IMAGE_LINE = /^\s*(?:!\[[^\]\n]*\]\([^\s)]+\)\s*)+$/;

const TRAIL = /(?:[.,:;!?'"*_~\]])+$/;

/** A fenced block's text as runs: URLs (trailing punctuation shed) and the
 *  plain text between them, so each renderer can make the URLs tappable. */
export type FenceRun = { text: string; href: string | null };
const FENCE_URL = /https?:\/\/[^\s<>"'`]+/g;
export function fenceRuns(text: string): FenceRun[] {
  const out: FenceRun[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  FENCE_URL.lastIndex = 0;
  while ((m = FENCE_URL.exec(text))) {
    const url = shed(m[0]);
    if (m.index > last) out.push({ text: text.slice(last, m.index), href: null });
    out.push({ text: url, href: url });
    last = m.index + url.length; // the shed trail joins the next plain run
  }
  if (last < text.length || !out.length) out.push({ text: text.slice(last), href: null });
  return out;
}

/** shed trailing punctuation plus unbalanced closing parens */
export function shed(s: string): string {
  for (;;) {
    const t = s.replace(TRAIL, '');
    const u = t.endsWith(')') && !t.includes('(') ? t.slice(0, -1) : t;
    if (u === s) return s;
    s = u;
  }
}

/** Does an inline-code span look like a file path? */
export function pathish(s: string): string | null {
  if (/\s|&|</.test(s)) return null;
  const m = s.match(/^(~?[\w.+/-]+?)(?::\d+(?::\d+)?)?$/);
  if (!m) return null;
  const p = m[1];
  if (/^\d+(?:\.\d+)*$/.test(p)) return null;
  if (!p.includes('/') && !/\.\w*[a-z]\w*$/i.test(p)) return null;
  return p;
}

function splitCells(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim());
}

/** Separator row: each cell is dashes with optional alignment colons. GFM
 *  needs only one dash, but a colon-less cell must have 3+ so a prose line
 *  like `a | - | b` can't gate a table. */
function isTableSep(line: string): boolean {
  if (!line.includes('|') && !/-{3,}/.test(line)) return false;
  const cells = splitCells(line);
  return (
    cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c) && (c.length >= 3 || c.includes(':')))
  );
}

function isTableRow(line: string): boolean {
  return line.includes('|') && line.trim().length > 0;
}

function parseAligns(sepLine: string): Align[] {
  return splitCells(sepLine).map((c) => {
    const left = c.startsWith(':');
    const right = c.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    if (left) return 'left';
    return '';
  });
}

/** plain text of an inline run: the markers stripped, nested runs flattened */
export function plainText(inlines: Inline[]): string {
  return inlines.map((n) => n.text).join('');
}

/** parse the inside of an emphasis run; undefined when it was plain text */
function inner(src: string): Inline[] | undefined {
  const kids = parseInlines(src);
  return kids.length === 1 && kids[0].type === 'text' ? undefined : kids;
}

// Emphasis: `**bold**` (inner edges non-space, so `2 ** 3 ** 4` stays math;
// no `**` inside, so `**a** and **b**` is two runs; a lone `*` is admitted so
// `**a *b* c**` nests), `***both***`, and `*italic*` / `_italic_` — these need a non-word
// char (or line start) before the opener and after the closer, so snake_case
// and `a*b*c` are left alone; the lead char is captured (no lookbehind — Hermes)
// and re-emitted as text. Inner edges exclude the marker and whitespace so
// `__init__` and `* 3 *` don't match.
const RE_INLINE =
  /!\[([^\]\n]*)\]\(([^\s)]+)\)|\*\*\*([^*\n\s](?:[^*\n]*?[^*\n\s])?)\*\*\*|\*\*([^\s*](?:(?:[^*\n]|\*(?!\*))*?[^\s*])?)\*\*|`([^`\n]+)`|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<`]+)|((?:~|\/(?:home|mnt|tmp|etc|var|usr|opt|srv|proc))\/[^\s<`]+)|(^|[^\w*\\])\*([^*\s](?:[^*\n]*?[^*\s])?)\*(?![\w*])|(^|[^\w\\])_([^_\s](?:[^_\n]*?[^_\s])?)_(?!\w)/g;

/** Parse inline markup in a single line/cell of raw text. */
export function parseInlines(src: string): Inline[] {
  // Tokenize: ![alt](src), ***both***, **bold**, `code`, [text](url), bare urls, bare paths, *em*, _em_
  const out: Inline[] = [];
  const re = RE_INLINE;
  re.lastIndex = 0;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m.index > last) out.push({ type: 'text', text: src.slice(last, m.index) });
    if (m[2] != null) {
      // an image ref mid-paragraph (an image on its own line is a block):
      // inline it can only be a link to the picture
      const alt = m[1] || m[2];
      out.push(/^https?:\/\//.test(m[2]) ? { type: 'link', href: m[2], text: alt } : { type: 'file', path: m[2], text: alt });
    } else if (m[3] != null) {
      const kids = inner(m[3]);
      const em: Inline = kids ? { type: 'em', text: plainText(kids), inlines: kids } : { type: 'em', text: m[3] };
      out.push({ type: 'strong', text: em.text, inlines: [em] });
    } else if (m[4] != null) {
      // `**http://host:port/**` is a URL the model wanted to shout, not copy text
      const href = /^https?:\/\/\S+$/.test(m[4]) ? m[4] : null;
      const kids = href ? undefined : inner(m[4]);
      out.push(
        href
          ? { type: 'strong', text: m[4], href }
          : kids
            ? { type: 'strong', text: plainText(kids), inlines: kids }
            : { type: 'strong', text: m[4] },
      );
    } else if (m[5] != null) {
      // models wrap URLs in backticks constantly (`http://host:port/`) — keep
      // the chip styling but make it a real link, not a copy-only run of text
      const href = /^https?:\/\/\S+$/.test(m[5]) ? m[5] : null;
      const p = href ? null : pathish(m[5]);
      out.push(
        href
          ? { type: 'code', text: m[5], href }
          : p
            ? { type: 'code', text: m[5], file: p }
            : { type: 'code', text: m[5] },
      );
    } else if (m[6] != null && m[7] != null) {
      out.push({ type: 'link', href: m[7], text: m[6] });
    } else if (m[8] != null) {
      const url = shed(m[8]);
      out.push({ type: 'link', href: url, text: url });
      const trail = m[8].slice(url.length);
      if (trail) out.push({ type: 'text', text: trail });
    } else if (m[9] != null) {
      const p = shed(m[9]);
      out.push({ type: 'file', path: p, text: p });
      const trail = m[9].slice(p.length);
      if (trail) out.push({ type: 'text', text: trail });
    } else if (m[11] != null || m[13] != null) {
      const lead = m[11] != null ? m[10] : m[12];
      const body = (m[11] ?? m[13])!;
      // the captured lead char rejoins the text run before it
      const prev = out[out.length - 1];
      if (lead && prev?.type === 'text') prev.text += lead;
      else if (lead) out.push({ type: 'text', text: lead });
      const kids = inner(body);
      out.push(kids ? { type: 'em', text: plainText(kids), inlines: kids } : { type: 'em', text: body });
    }
    last = m.index + m[0].length;
    re.lastIndex = last; // inner() recursed through the same regex
  }
  if (last < src.length) out.push({ type: 'text', text: src.slice(last) });
  return out.length ? out : [{ type: 'text', text: '' }];
}

/** Apply header-as-bold on lines of a text segment, then emit para/table blocks. */
function parseTextSegment(src: string): Block[] {
  // # headers → bold whole line. Any `**` already on the line goes (the
  // whole line is bold anyway); doubling it up breaks the bold run, and the
  // nested *em* / `code` inside still parse.
  const lined = src.replace(/^#{1,6} +(.*?)\s*#*$/gm, (_, t: string) => (t ? `**${t.replace(/\*\*/g, '')}**` : ''));
  const lines = lined.split('\n');
  const blocks: Block[] = [];
  let buf: string[] = [];

  const flushPara = () => {
    // whitespace-only runs (trailing newlines after a table, blank lines
    // between blocks) would become an empty paragraph — a 2-line blank strip
    // in a bubble on mobile, an empty <p> on web
    if (!buf.some((l) => l.trim())) {
      buf = [];
      return;
    }
    // join lines with newlines so RN/HTML can break; parse as one inline stream
    // with \n preserved as text nodes
    const joined = buf.join('\n');
    blocks.push({ type: 'para', inlines: parseInlines(joined) });
    buf = [];
  };

  let i = 0;
  while (i < lines.length) {
    if (i + 1 < lines.length && isTableRow(lines[i]) && isTableSep(lines[i + 1])) {
      flushPara();
      const headerCells = splitCells(lines[i]);
      const aligns = parseAligns(lines[i + 1]);
      const cols = headerCells.length;
      i += 2;
      const body: string[][] = [];
      while (i < lines.length && isTableRow(lines[i]) && !isTableSep(lines[i])) {
        body.push(splitCells(lines[i]));
        i += 1;
      }
      const pad = (cells: string[]) => {
        const row = cells.slice(0, cols);
        while (row.length < cols) row.push('');
        return row;
      };
      blocks.push({
        type: 'table',
        header: pad(headerCells).map((c) => parseInlines(c)),
        aligns,
        rows: body.map((row) => pad(row).map((c) => parseInlines(c))),
      });
      continue;
    }
    if (IMAGE_LINE.test(lines[i])) {
      flushPara();
      for (const m of lines[i].matchAll(IMAGE)) blocks.push({ type: 'image', src: m[2], alt: m[1] });
      i += 1;
      continue;
    }
    buf.push(lines[i]);
    i += 1;
  }
  flushPara();
  return blocks;
}

export function parseMd(src: string): Block[] {
  const blocks: Block[] = [];
  const parts = src.split(/```(\w*)\n?/);
  // Split with one capture group emits TWO slots per fence (separator is
  // consumed, capture is kept), and a code block has two fences — so the
  // layout has period FOUR: [text, openLang, code, closeLang, text, …].
  // (An unclosed trailing fence still lands its code at i%4===2.)
  for (let i = 0; i < parts.length; i += 1) {
    if (i % 4 === 2) {
      blocks.push({ type: 'code', lang: parts[i - 1] ?? '', text: parts[i] });
      continue;
    }
    if (i % 4 === 1 || i % 4 === 3) continue; // fence language tags
    if (parts[i]) blocks.push(...parseTextSegment(parts[i]));
  }
  return blocks;
}
