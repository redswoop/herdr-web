import type { Align, Block, Inline } from './parse';
import { fenceRuns, parseMd } from './parse';

export function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

// esc(href) is load-bearing: the bare-URL matcher admits `"` so an unescaped
// href lets agent-fetched content inject live attributes (onfocus=…) into our
// origin. The scheme is regex-pinned upstream; the quotes are on us.
const anchor = (href: string, text: string) =>
  `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(text)}</a>`;

const fileAnchor = (p: string, text: string) => `<a data-file="${esc(p)}">${esc(text)}</a>`;

function renderInlines(inlines: Inline[]): string {
  return inlines
    .map((n) => {
      switch (n.type) {
        case 'text':
          return esc(n.text);
        case 'strong':
          if (n.href) return `<strong>${anchor(n.href, n.text)}</strong>`;
          return `<strong>${n.inlines ? renderInlines(n.inlines) : esc(n.text)}</strong>`;
        case 'em':
          return `<em>${n.inlines ? renderInlines(n.inlines) : esc(n.text)}</em>`;
        case 'code':
          if (n.href) return `<code>${anchor(n.href, n.text)}</code>`;
          return n.file
            ? `<code>${fileAnchor(n.file, n.text)}</code>`
            : `<code>${esc(n.text)}</code>`;
        case 'link':
          return anchor(n.href, n.text);
        case 'file':
          return fileAnchor(n.path, n.text);
      }
    })
    .join('');
}

// Fenced blocks are verbatim text, but a URL dropped in one (a list of
// endpoints, a curl line) should still open on tap: anchor the URLs, escape
// the gaps. Capra's MdView renders the same runs as tappable Text.
const linkifyFence = (text: string): string =>
  fenceRuns(text)
    .map((r) => (r.href ? anchor(r.href, r.text) : esc(r.text)))
    .join('');

function cellTag(tag: 'th' | 'td', content: string, align: Align): string {
  const a = align ? ` style="text-align:${align}"` : '';
  return `<${tag}${a}>${content}</${tag}>`;
}

export interface MdOpts {
  /** Where an `![alt](src)` block is shown as a picture, the URL that serves
   *  `src` (relative to the document) — the file viewer's raw route. Without
   *  it the ref renders as a tappable file chip, which is what a transcript
   *  wants: nothing an agent prints should make the page fetch an image. */
  image?: (src: string) => string | null;
}

export function mdToHtml(blocks: Block[], opts: MdOpts = {}): string {
  return blocks
    .map((b) => {
      if (b.type === 'code') {
        return `<pre><code>${linkifyFence(b.text)}</code></pre>`;
      }
      if (b.type === 'image') {
        const url = opts.image ? (/^https?:\/\//.test(b.src) ? b.src : opts.image(b.src)) : null;
        // data-file on the <img> too: a tap opens the picture in the viewer
        if (url) return `<figure class="md-img"><img src="${esc(url)}" alt="${esc(b.alt)}" loading="lazy" data-file="${esc(b.src)}"></figure>`;
        return /^https?:\/\//.test(b.src) ? anchor(b.src, b.alt || b.src) : fileAnchor(b.src, b.alt || b.src);
      }
      if (b.type === 'table') {
        const thead = `<thead><tr>${b.header
          .map((c, j) => cellTag('th', renderInlines(c), b.aligns[j] ?? ''))
          .join('')}</tr></thead>`;
        const tbody =
          b.rows.length === 0
            ? ''
            : `<tbody>${b.rows
                .map(
                  (row) =>
                    `<tr>${row
                      .map((c, j) => cellTag('td', renderInlines(c), b.aligns[j] ?? ''))
                      .join('')}</tr>`,
                )
                .join('')}</tbody>`;
        return `<div class="md-table"><table>${thead}${tbody}</table></div>`;
      }
      // para: newlines become <br>
      const html = renderInlines(b.inlines).replace(/\n/g, '<br>');
      return html;
    })
    .join('');
}

/** Drop-in replacement for the original md() helper. */
export function md(src: string, opts?: MdOpts): string {
  return mdToHtml(parseMd(src), opts);
}

export { pathish } from './parse';
