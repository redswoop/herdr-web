import { describe, expect, it } from 'vitest';
import { parseMd, pathish, shed } from '../src/md/parse';
import { md } from '../src/md/render-html';

describe('pathish / shed', () => {
  it('pathish accepts real paths', () => {
    expect(pathish('foo.ts')).toBe('foo.ts');
    expect(pathish('src/app.tsx')).toBe('src/app.tsx');
    expect(pathish('1.2.3')).toBe(null);
    expect(pathish('not a path')).toBe(null);
  });
  it('shed trims punctuation', () => {
    expect(shed('http://x.com.')).toBe('http://x.com');
    expect(shed('/home/a/b,')).toBe('/home/a/b');
  });
});

describe('parseMd + md()', () => {
  it('renders bold and code', () => {
    const html = md('hello **world** and `code`');
    expect(html).toContain('<strong>world</strong>');
    expect(html).toContain('<code>code</code>');
  });

  it('renders fenced code', () => {
    const html = md('```js\nconst x = 1;\n```');
    expect(html).toContain('<pre><code>');
    expect(html).toContain('const x = 1;');
  });

  it('linkifies bare paths', () => {
    const html = md('see /home/armen/foo.ts please');
    expect(html).toContain('data-file="/home/armen/foo.ts"');
  });

  it('escapes quotes in bare-URL hrefs (attribute-injection regression)', () => {
    // the bare-URL matcher admits `"` — unescaped, this injects a live
    // onfocus handler into the transcript's origin
    const html = md('bare https://a.com/"onfocus="alert(1)" x');
    expect(html).not.toContain('"onfocus="');
    // shed() trims the trailing quote; everything kept must arrive escaped
    expect(html).toContain('href="https://a.com/&quot;onfocus=&quot;alert(1)"');
  });

  it('escapes quotes in [text](url) hrefs', () => {
    const html = md('[click](https://a.com/?q="onmouseover="x")');
    expect(html).not.toContain('"onmouseover="');
    expect(html).toContain('&quot;onmouseover=&quot;');
  });

  it('renders GFM tables', () => {
    const src = '| a | b |\n| --- | --- |\n| 1 | 2 |';
    const html = md(src);
    expect(html).toContain('<table>');
    expect(html).toContain('<th');
    expect(html).toContain('1');
  });

  it('parseMd produces blocks', () => {
    const blocks = parseMd('**hi**\n\n```\ncode\n```');
    expect(blocks.some((b) => b.type === 'code')).toBe(true);
    expect(blocks.some((b) => b.type === 'para')).toBe(true);
  });
});
