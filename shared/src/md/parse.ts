/**
 * Escape-first markdown AST parser. Produces blocks/inlines from raw text;
 * rendering (HTML or RN Text) is a separate concern.
 */

export type Align = 'left' | 'center' | 'right' | '';

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'strong'; text: string }
  | { type: 'code'; text: string; file?: string }
  | { type: 'link'; href: string; text: string }
  | { type: 'file'; path: string; text: string };

export type Block =
  | { type: 'code'; lang: string; text: string }
  | { type: 'table'; header: Inline[][]; aligns: Align[]; rows: Inline[][][] }
  | { type: 'para'; inlines: Inline[] };

const TRAIL = /(?:[.,:;!?'"*_~\]])+$/;

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

function isTableSep(line: string): boolean {
  if (!line.includes('|') && !/-{3,}/.test(line)) return false;
  const cells = splitCells(line);
  return cells.length > 0 && cells.every((c) => /^:?-{3,}:?$/.test(c));
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

/** Parse inline markup in a single line/cell of raw text. */
export function parseInlines(src: string): Inline[] {
  // Tokenize: **bold**, `code`, [text](url), bare urls, bare paths
  const out: Inline[] = [];
  const re =
    /\*\*([^*\n]+)\*\*|`([^`\n]+)`|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<`]+)|((?:~|\/(?:home|mnt|tmp|etc|var|usr|opt|srv|proc))\/[^\s<`]+)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m.index > last) out.push({ type: 'text', text: src.slice(last, m.index) });
    if (m[1] != null) {
      out.push({ type: 'strong', text: m[1] });
    } else if (m[2] != null) {
      const p = pathish(m[2]);
      out.push(p ? { type: 'code', text: m[2], file: p } : { type: 'code', text: m[2] });
    } else if (m[3] != null && m[4] != null) {
      out.push({ type: 'link', href: m[4], text: m[3] });
    } else if (m[5] != null) {
      const url = shed(m[5]);
      out.push({ type: 'link', href: url, text: url });
      const trail = m[5].slice(url.length);
      if (trail) out.push({ type: 'text', text: trail });
    } else if (m[6] != null) {
      const p = shed(m[6]);
      out.push({ type: 'file', path: p, text: p });
      const trail = m[6].slice(p.length);
      if (trail) out.push({ type: 'text', text: trail });
    }
    last = m.index + m[0].length;
  }
  if (last < src.length) out.push({ type: 'text', text: src.slice(last) });
  return out.length ? out : [{ type: 'text', text: '' }];
}

/** Apply header-as-bold on lines of a text segment, then emit para/table blocks. */
function parseTextSegment(src: string): Block[] {
  // # headers → bold whole line
  const lined = src.replace(/^#{1,3} (.*)$/gm, '**$1**');
  const lines = lined.split('\n');
  const blocks: Block[] = [];
  let buf: string[] = [];

  const flushPara = () => {
    if (!buf.length) return;
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
    buf.push(lines[i]);
    i += 1;
  }
  flushPara();
  return blocks;
}

export function parseMd(src: string): Block[] {
  const blocks: Block[] = [];
  const parts = src.split(/```(\w*)\n?/);
  for (let i = 0; i < parts.length; i += 1) {
    if (i % 3 === 2) {
      blocks.push({ type: 'code', lang: parts[i - 1] ?? '', text: parts[i] });
      continue;
    }
    if (i % 3 === 1) continue;
    if (parts[i]) blocks.push(...parseTextSegment(parts[i]));
  }
  return blocks;
}
