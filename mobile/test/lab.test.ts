import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMd, type Inline } from '@herdr/shared';
import { chunkFrags, splitInlineSegs } from '../src/components/segment';
import { BLACK_BOX_REPLY } from '../src/lab-fixture';

const t = (text: string): Inline => ({ type: 'text', text });

describe('chunkFrags (render lab)', () => {
  it('leaves short segments alone and caps long ones on span boundaries', () => {
    const seg = Array.from({ length: 23 }, (_, i) => t(`s${i}`));
    expect(chunkFrags(seg, 30)).toEqual([seg]);
    const chunks = chunkFrags(seg, 10);
    expect(chunks.map((c) => c.length)).toEqual([10, 10, 3]);
    expect(chunks.flat()).toEqual(seg);
    expect(chunkFrags(seg, 0)).toEqual([seg]);
  });
});

describe('black-box fixture', () => {
  it('matches the markdown source and keeps the shape that boxed', () => {
    const md = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'black-box-reply.md'), 'utf8');
    expect(BLACK_BOX_REPLY).toBe(md);
    const paras = parseMd(BLACK_BOX_REPLY).filter((b) => b.type === 'para');
    const spans = paras.map((p) => splitInlineSegs((p as { inlines: Inline[] }).inlines).map((s) => s.length));
    // two single-segment paragraphs of 55 and 35 spans — the thing under test
    expect(spans).toEqual([[55], [35]]);
  });
});
