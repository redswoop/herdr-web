// Markdown renderer regressions. md.ts is TypeScript, so transpile it with
// the esbuild that vite already vendors under web/node_modules; when the web
// deps aren't installed the suite skips rather than fails.
import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';

let md;
let pathish;
try {
  const esbuild = await import('../web/node_modules/esbuild/lib/main.js');
  const src = await fsp.readFile(new URL('../web/src/md.ts', import.meta.url), 'utf8');
  const { code } = await esbuild.transform(src, { loader: 'ts', format: 'esm' });
  ({ md, pathish } = await import(
    `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
  ));
} catch {
  test('md.ts suite skipped — web/node_modules not installed', { skip: true }, () => {});
}
const t = (name, fn) => test(name, { skip: !md }, fn);

t('single fence: prose after the closing fence survives', () => {
  const html = md('intro\n```js\ncode()\n```\nTRAILING PROSE');
  assert.match(html, /<pre><code>code\(\)\n<\/code><\/pre>/);
  assert.match(html, /TRAILING PROSE/);
  assert.match(html, /intro/);
});

t('two fences: middle prose kept, blocks stay blocks', () => {
  const html = md('a\n```\nB1\n```\nmid\n```\nB2\n```\nend');
  assert.match(html, /<pre><code>B1\n<\/code><\/pre>/);
  assert.match(html, /<pre><code>B2\n<\/code><\/pre>/);
  assert.match(html, /mid/);
  assert.match(html, /end/);
  // the prose must not be swallowed into a code block
  assert.ok(!/<pre><code>[^<]*mid/.test(html));
  assert.ok(!/<pre><code>[^<]*end/.test(html));
});

t('unclosed trailing fence still renders as code', () => {
  const html = md('before\n```py\nx = 1');
  assert.match(html, /<pre><code>x = 1<\/code><\/pre>/);
  assert.match(html, /before/);
});

t('html is escaped everywhere', () => {
  const html = md('<script>alert(1)</script>\n```\n<b>code</b>\n```');
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<b>'));
  assert.match(html, /&lt;script&gt;/);
});

t('inline code, bold, headers, links', () => {
  assert.match(md('use `foo()` now'), /<code>foo\(\)<\/code>/);
  assert.match(md('**bold** move'), /<strong>bold<\/strong>/);
  assert.match(md('# Title'), /<strong>Title<\/strong>/);
  assert.match(md('see https://x.test/a.'), /<a href="https:\/\/x.test\/a"/);
});

t('backticked paths become file anchors; versions do not', () => {
  assert.match(md('open `lib/adapters.js` now'), /<a data-file="lib\/adapters.js">/);
  assert.match(md('`file.ts:12` ref'), /<a data-file="file.ts">/);
  assert.ok(!md('node `22.22.1` here').includes('data-file'));
});

t('pathish edge cases', () => {
  assert.equal(pathish('a b'), null);
  assert.equal(pathish('1.2.3'), null);
  assert.equal(pathish('src/x.ts:3:1'), 'src/x.ts');
  assert.equal(pathish('~/notes.md'), '~/notes.md');
});

t('gfm table renders with alignment', () => {
  const html = md('| a | b |\n|---|--:|\n| 1 | 2 |');
  assert.match(html, /<table>/);
  assert.match(html, /<th>a<\/th>/);
  assert.match(html, /<td style="text-align:right">2<\/td>/);
});
