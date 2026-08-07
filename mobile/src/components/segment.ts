import type { Inline } from '@herdr/shared';

/**
 * iOS draws each <Text> into a single layer backing store; past the GPU
 * texture limit (~8192px, ~2700pt at @3x) the layer silently renders as an
 * empty box. Long agent replies, tool results, and file bodies all clear
 * that bar, so no Text in the app may grow unbounded — split into stacked
 * segments instead. Pure logic lives here (no react-native imports) so it
 * stays unit-testable; SegText.tsx renders it.
 */
export const SEG_LINES = 20;
export const SEG_CHARS = 2000;
// A single wrapped run this long risks the limit on its own. Calibrated for
// the WORST consumer — 15pt/22-lineHeight body text at ~45 chars per wrapped
// line ≈ 44 lines ≈ 970pt ≈ 2900px @3x. (6000 was fine for 12pt monospace
// but blew past 8192px as body text.)
export const HARD_CHARS = 2000;

export function splitPlain(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  let lines = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '\n') {
      lines += 1;
      if (lines >= SEG_LINES || i - start >= SEG_CHARS) {
        out.push(text.slice(start, i));
        start = i + 1;
        lines = 0;
      }
    } else if (i - start >= HARD_CHARS) {
      out.push(text.slice(start, i));
      start = i;
      lines = 0;
    }
  }
  out.push(text.slice(start));
  return out;
}

/** Split an inline stream so no segment exceeds the height cap. Newlines are
 *  the preferred break, but a single-line paragraph with none (minified JSON
 *  outside a fence, wall-of-prose reply) must still hard-split mid-run —
 *  without that this path black-boxed exactly like unbounded plain text. */
export function splitInlineSegs(nodes: Inline[]): Inline[][] {
  const segs: Inline[][] = [];
  let cur: Inline[] = [];
  let lines = 0;
  let chars = 0;
  const flush = () => {
    if (cur.length) segs.push(cur);
    cur = [];
    lines = 0;
    chars = 0;
  };
  // hard-split oversized runs of ANY node type (a 10k-char inline code span
  // blows the layer just as hard as plain text); slicing keeps the node's
  // type/styling and, for link/file nodes, its target on every piece
  const push = (n: Inline) => {
    let t = n.text;
    while (chars + t.length > HARD_CHARS) {
      const take = HARD_CHARS - chars;
      if (take > 0) {
        cur.push({ ...n, text: t.slice(0, take) });
        t = t.slice(take);
      }
      flush();
    }
    if (t) {
      cur.push({ ...n, text: t });
      chars += t.length;
    }
  };
  for (const n of nodes) {
    if (n.type !== 'text' || !n.text.includes('\n')) {
      push(n);
      continue;
    }
    const parts = n.text.split('\n');
    for (let i = 0; i < parts.length; i += 1) {
      if (i > 0) {
        lines += 1;
        if (lines >= SEG_LINES || chars >= SEG_CHARS) flush();
        else push({ type: 'text', text: '\n' });
      }
      if (parts[i]) push({ type: 'text', text: parts[i] });
    }
  }
  flush();
  return segs.length ? segs : [nodes];
}
