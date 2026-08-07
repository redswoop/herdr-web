import { describe, expect, it } from 'vitest';
import type { Inline } from '@herdr/shared';
import { HARD_CHARS, SEG_CHARS, splitInlineSegs, splitPlain } from '../src/components/segment';

// The iOS black-box bug (commit 3cd4c57): any <Text> taller than the ~8192px
// layer cap silently renders as an empty box. These tests pin the invariant
// that NO segmentation path can emit an unbounded run.

const segChars = (seg: Inline[]) => seg.reduce((n, s) => n + s.text.length, 0);

describe('splitPlain', () => {
  it('leaves short text alone', () => {
    expect(splitPlain('hello\nworld')).toEqual(['hello\nworld']);
  });

  it('splits many-line text into bounded segments', () => {
    const text = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n');
    const segs = splitPlain(text);
    expect(segs.length).toBeGreaterThan(1);
    for (const s of segs) expect(s.length).toBeLessThanOrEqual(SEG_CHARS + HARD_CHARS);
    expect(segs.join('\n')).toBe(text); // lossless at newline boundaries
  });

  it('hard-splits a single enormous line with no newlines', () => {
    const text = 'x'.repeat(10 * HARD_CHARS);
    const segs = splitPlain(text);
    for (const s of segs) expect(s.length).toBeLessThanOrEqual(HARD_CHARS);
    expect(segs.join('')).toBe(text); // lossless mid-line
  });
});

describe('splitInlineSegs', () => {
  it('passes short inline streams through untouched', () => {
    const nodes: Inline[] = [
      { type: 'text', text: 'hello ' },
      { type: 'strong', text: 'world' },
    ];
    expect(splitInlineSegs(nodes)).toEqual([nodes]);
  });

  it('splits at newline boundaries once past the line cap', () => {
    const nodes: Inline[] = [
      { type: 'text', text: Array.from({ length: 60 }, (_, i) => `l${i}`).join('\n') },
    ];
    const segs = splitInlineSegs(nodes);
    expect(segs.length).toBeGreaterThan(1);
    for (const seg of segs) expect(segChars(seg)).toBeLessThanOrEqual(HARD_CHARS);
  });

  it('hard-splits a single-line paragraph with no newlines (the black-box regression)', () => {
    // minified JSON echoed outside a code fence — one text node, zero '\n'
    const text = `{"k":${'"v",'.repeat(3000)}}`;
    const segs = splitInlineSegs([{ type: 'text', text }]);
    expect(segs.length).toBeGreaterThan(1);
    for (const seg of segs) expect(segChars(seg)).toBeLessThanOrEqual(HARD_CHARS);
    expect(segs.flat().map((n) => n.text).join('')).toBe(text); // lossless
  });

  it('hard-splits oversized non-text nodes and keeps their type + target', () => {
    const nodes: Inline[] = [
      { type: 'code', text: 'y'.repeat(3 * HARD_CHARS) },
      { type: 'link', href: 'https://x.dev', text: 'z'.repeat(2 * HARD_CHARS + 5) },
    ];
    const segs = splitInlineSegs(nodes);
    for (const seg of segs) expect(segChars(seg)).toBeLessThanOrEqual(HARD_CHARS);
    const flat = segs.flat();
    expect(flat.every((n) => n.type === 'code' || n.type === 'link')).toBe(true);
    for (const n of flat) {
      if (n.type === 'link') expect(n.href).toBe('https://x.dev'); // target survives slicing
    }
  });

  it('mixed stream: no emitted segment ever exceeds the cap', () => {
    const nodes: Inline[] = [
      { type: 'text', text: `intro\n${'a'.repeat(5000)}\nmid` },
      { type: 'strong', text: 'bold bit' },
      { type: 'text', text: 'b'.repeat(4000) },
    ];
    for (const seg of splitInlineSegs(nodes)) {
      expect(segChars(seg)).toBeLessThanOrEqual(HARD_CHARS);
    }
  });
});
