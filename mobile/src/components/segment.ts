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
// Soft cap: once a segment holds this much, the next newline ends it. It
// must sit well under HARD_CHARS, or the hard mid-run cut always fires first
// and a paragraph breaks in the middle of a sentence (the "- **Why / this
// lowers price**" stray line break, 2026-11-03: both were 2000).
export const SEG_CHARS = 1200;
// A single wrapped run this long risks the limit on its own. Calibrated for
// the WORST consumer — 15pt/22-lineHeight body text at ~45 chars per wrapped
// line ≈ 44 lines ≈ 970pt ≈ 2900px @3x. (6000 was fine for 12pt monospace
// but blew past 8192px as body text.)
export const HARD_CHARS = 2000;
// A hard cut lands on the last space within this many chars of the limit,
// so the forced break at least falls between words.
const CUT_SLACK = 200;

/** where to cut `t` so the piece is at most `take` long: the last space in
 *  reach (the space stays on the first piece, so the next segment doesn't
 *  open with one), else exactly `take` */
export function cutAt(t: string, take: number): number {
  if (take >= t.length) return t.length;
  const sp = t.lastIndexOf(' ', take - 1);
  return sp >= take - CUT_SLACK && sp > 0 ? sp + 1 : take;
}

// The layer cap applies to WIDTH too: in a non-wrapping context (fenced code
// inside a horizontal ScrollView) a Text is as wide as its longest line, and
// ~380 chars of 12pt monospace already exceeds 8192px @3x. 240 leaves margin.
export const MAX_LINE_CHARS = 240;

/** Hard-wrap any line longer than max — for Text rendered without wrapping.
 *  A forced continuation line beats a black box. */
export function wrapLongLines(text: string, max = MAX_LINE_CHARS): string {
  if (!text.split('\n').some((l) => l.length > max)) return text;
  return text
    .split('\n')
    .map((line) => {
      if (line.length <= max) return line;
      const parts: string[] = [];
      for (let i = 0; i < line.length; i += max) parts.push(line.slice(i, i + max));
      return parts.join('\n');
    })
    .join('\n');
}

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
      const cut = start + cutAt(text.slice(start), i - start);
      out.push(text.slice(start, cut));
      start = cut;
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
  // type/styling and, for link/file nodes, its target on every piece; a
  // sliced emphasis run shows its plain text (its nested markup can't be cut)
  const flat = (n: Inline, text: string): Inline => {
    if (n.type === 'strong' || n.type === 'em') {
      const { inlines: _drop, ...rest } = n;
      return { ...rest, text };
    }
    return { ...n, text };
  };
  const push = (n: Inline) => {
    let t = n.text;
    let cut = false;
    while (chars + t.length > HARD_CHARS) {
      const take = chars < HARD_CHARS ? cutAt(t, HARD_CHARS - chars) : 0;
      cut = true;
      if (take > 0) {
        cur.push(flat(n, t.slice(0, take)));
        t = t.slice(take);
      }
      flush();
    }
    if (t) {
      cur.push(cut ? flat(n, t) : { ...n, text: t });
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

/** Lab only: cap the nested spans per root <Text>. Cuts fall on span
 *  boundaries, so a chunk edge mid-sentence becomes a visual line break —
 *  acceptable for a diagnostic, not for the transcript. */
export function chunkFrags(seg: Inline[], max: number): Inline[][] {
  if (max < 1 || seg.length <= max) return [seg];
  const out: Inline[][] = [];
  for (let i = 0; i < seg.length; i += max) out.push(seg.slice(i, i + max));
  return out;
}
