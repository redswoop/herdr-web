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

  it('backticked URLs become links inside the code chip', () => {
    const html = md('Tailnet URL is `http://desk.tailnet.ts.net:8188/`.');
    expect(html).toContain(
      '<code><a href="http://desk.tailnet.ts.net:8188/" target="_blank" rel="noopener noreferrer">http://desk.tailnet.ts.net:8188/</a></code>',
    );
    // a path in backticks is still a file link, and a quote in a backticked URL is escaped
    expect(md('`src/app.ts`')).toContain('data-file="src/app.ts"');
    expect(md('`https://a.com/"onfocus="x`')).not.toContain('"onfocus="');
    // not a URL chip: prose with a URL in it stays plain code
    expect(md('`see http://a.com`')).toBe('<code>see http://a.com</code>');
  });

  it('linkifies URLs inside fenced blocks, escaping the rest', () => {
    const html = md('```\ncurl https://api.x.com/v1?q=1) .\n<b>x</b> xmlns="http://w3.org/svg"\n```');
    // shed() keeps the stray `)` and `.` out of the href; they stay as text
    expect(html).toContain(
      '<a href="https://api.x.com/v1?q=1" target="_blank" rel="noopener noreferrer">https://api.x.com/v1?q=1</a>) .',
    );
    // markup between URLs is still escaped, and a quoted URL stops at the quote
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt; xmlns=&quot;<a href="http://w3.org/svg"');
    expect(html).toContain('</a>&quot;');
  });

  it('splits fenced text into tappable runs', async () => {
    const { fenceRuns } = await import('../src/md/parse');
    expect(fenceRuns('open https://stormer.ts.net:7683/link?token=x.\nthen https://b.io)')).toEqual([
      { text: 'open ', href: null },
      { text: 'https://stormer.ts.net:7683/link?token=x', href: 'https://stormer.ts.net:7683/link?token=x' },
      { text: '.\nthen ', href: null },
      { text: 'https://b.io', href: 'https://b.io' },
      { text: ')', href: null },
    ]);
    expect(fenceRuns('no links here')).toEqual([{ text: 'no links here', href: null }]);
    expect(fenceRuns('')).toEqual([{ text: '', href: null }]);
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
