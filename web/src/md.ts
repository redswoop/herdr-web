/* Tiny escape-first markdown: fenced code, inline code, bold, headers, links. */
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

export function md(src: string): string {
  const out: string[] = [];
  const parts = src.split(/```(\w*)\n?/);
  // parts alternate: text, lang, code, text, lang, code, ...
  for (let i = 0; i < parts.length; i += 1) {
    if (i % 3 === 2) {
      out.push(`<pre><code>${esc(parts[i])}</code></pre>`);
      continue;
    }
    if (i % 3 === 1) continue; // language tag
    let t = linkify(esc(parts[i]));
    t = t.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    // backticked file paths become viewer links (skip spans already anchored)
    t = t.replace(/<code>([^<]+)<\/code>/g, (m, body) => {
      const p = pathish(body);
      return p ? `<code>${fileAnchor(p, body)}</code>` : m;
    });
    t = t.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/^#{1,3} (.*)$/gm, '<strong>$1</strong>');
    t = t.replace(/\n/g, '<br>');
    out.push(t);
  }
  return out.join('');
}
