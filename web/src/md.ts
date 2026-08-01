/* Tiny escape-first markdown: fenced code, inline code, bold, headers, links,
 * GFM tables. */
export function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

const anchor = (href: string, text: string) =>
  `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`;

/** href-less anchor: clicks are handled by delegation on the transcript
 *  (a[data-file] → file viewer overlay), so a stray click can't navigate. */
const fileAnchor = (p: string, text: string) => `<a data-file="${p}">${text}</a>`;

const TRAIL = /(?:[.,:;!?'"*_~\]]|&quot;|&lt;|&gt;|&amp;)+$/;

/** shed trailing punctuation/entities plus unbalanced closing parens */
function shed(s: string): string {
  for (;;) {
    const t = s.replace(TRAIL, '');
    const u = t.endsWith(')') && !t.includes('(') ? t.slice(0, -1) : t;
    if (u === s) return s;
    s = u;
  }
}

/** Runs on already-escaped text: [text](url), bare http(s) URLs, then bare
 *  absolute/`~` filesystem paths. Bare matches shed trailing punctuation and
 *  escape entities so `see http://x.` links to x. */
function linkify(t: string): string {
  return t.replace(
    /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<`]+)|((?:~|\/(?:home|mnt|tmp|etc|var|usr|opt|srv|proc))\/[^\s<`]+)/g,
    (_m, txt: string, href: string, bare: string, fpath: string) => {
      if (fpath) {
        const p = shed(fpath);
        return fileAnchor(p, p) + fpath.slice(p.length);
      }
      if (!bare) return anchor(href, txt);
      const url = shed(bare);
      return anchor(url, url) + bare.slice(url.length);
    },
  );
}

/** Does an inline-code span look like a file path? Conservative: one token,
 *  ending in a real extension or containing a slash; `file.ts:12` line
 *  suffixes are stripped. Relative paths resolve server-side against the
 *  session cwd. */
export function pathish(s: string): string | null {
  if (/\s|&|</.test(s)) return null;
  const m = s.match(/^(~?[\w.+/-]+?)(?::\d+(?::\d+)?)?$/);
  if (!m) return null;
  const p = m[1];
  if (/^\d+(?:\.\d+)*$/.test(p)) return null; // version numbers
  if (!p.includes('/') && !/\.\w*[a-z]\w*$/i.test(p)) return null;
  return p;
}

/** Split a GFM table row into cells. Leading/trailing pipes optional. */
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
  return cells.length > 0
    && cells.every((c) => /^:?-+:?$/.test(c) && (c.length >= 3 || c.includes(':')));
}

/** Any pipe-bearing non-blank line is a candidate row; the separator gate
 *  keeps prose with a lone `|` from becoming a table. */
function isTableRow(line: string): boolean {
  return line.includes('|') && line.trim().length > 0;
}

type Align = 'left' | 'center' | 'right' | '';

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

function cellTag(tag: 'th' | 'td', content: string, align: Align): string {
  const a = align ? ` style="text-align:${align}"` : '';
  return `<${tag}${a}>${content}</${tag}>`;
}

/** Lift GFM tables out of a post-inline text block; remaining lines become
 *  <br>-joined runs. Must run after inline markup (cells keep bold/code/links)
 *  and before the global newline→br pass. */
function blockify(t: string): string {
  const lines = t.split('\n');
  const chunks: string[] = [];
  let buf: string[] = [];
  const flush = () => {
    if (buf.length) {
      chunks.push(buf.join('<br>'));
      buf = [];
    }
  };

  let i = 0;
  while (i < lines.length) {
    if (i + 1 < lines.length && isTableRow(lines[i]) && isTableSep(lines[i + 1])) {
      const header = splitCells(lines[i]);
      const aligns = parseAligns(lines[i + 1]);
      const cols = header.length;
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
      const thead = `<thead><tr>${pad(header)
        .map((c, j) => cellTag('th', c, aligns[j] ?? ''))
        .join('')}</tr></thead>`;
      const tbody =
        body.length === 0
          ? ''
          : `<tbody>${body
              .map(
                (row) =>
                  `<tr>${pad(row)
                    .map((c, j) => cellTag('td', c, aligns[j] ?? ''))
                    .join('')}</tr>`,
              )
              .join('')}</tbody>`;
      flush();
      chunks.push(`<div class="md-table"><table>${thead}${tbody}</table></div>`);
      continue;
    }
    buf.push(lines[i]);
    i += 1;
  }
  flush();
  return chunks.join('');
}

export function md(src: string): string {
  const out: string[] = [];
  const parts = src.split(/```(\w*)\n?/);
  // Split with one capture group emits TWO slots per fence (separator is
  // consumed, capture is kept), and a code block has two fences — so the
  // layout has period FOUR: [text, openLang, code, closeLang, text, …].
  // (An unclosed trailing fence still lands its code at i%4===2.)
  for (let i = 0; i < parts.length; i += 1) {
    if (i % 4 === 2) {
      out.push(`<pre><code>${esc(parts[i])}</code></pre>`);
      continue;
    }
    if (i % 4 === 1 || i % 4 === 3) continue; // fence language tags
    let t = linkify(esc(parts[i]));
    t = t.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    // backticked file paths become viewer links (skip spans already anchored)
    t = t.replace(/<code>([^<]+)<\/code>/g, (m, body) => {
      const p = pathish(body);
      return p ? `<code>${fileAnchor(p, body)}</code>` : m;
    });
    t = t.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/^#{1,3} (.*)$/gm, '<strong>$1</strong>');
    t = blockify(t);
    out.push(t);
  }
  return out.join('');
}
