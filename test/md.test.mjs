// Markdown renderer regressions. The engine now lives in @herdr/shared
// (md/parse.ts + md/render-html.ts) with web/src/md.ts a re-export shim, so
// bundle render-html — that inlines parse and keeps the surface identical to
// what the web app imports. TypeScript, so run it through the esbuild vite
// vendors; when deps aren't installed the suite skips rather than fails.
import test from 'node:test';
import assert from 'node:assert/strict';

let md;
let pathish;
try {
  let esbuild;
  for (const p of ['../node_modules/esbuild/lib/main.js', '../web/node_modules/esbuild/lib/main.js'])
    try {
      esbuild = await import(p);
      break;
    } catch {
      /* try the next hoist location */
    }
  const { outputFiles } = await esbuild.build({
    entryPoints: [new URL('../shared/src/md/render-html.ts', import.meta.url).pathname],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'neutral',
  });
  ({ md, pathish } = await import(
    `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`
  ));
} catch (e) {
  // Fail LOUDLY: a green-skip here once hid the entire suite behind a broken
  // import. Machines that genuinely lack node_modules can opt out explicitly.
  if (process.env.HERDR_TEST_ALLOW_MD_SKIP) {
    test('md suite skipped — HERDR_TEST_ALLOW_MD_SKIP set', { skip: true }, () => {});
  } else {
    test('md suite failed to load its esbuild bundle', () => {
      throw new Error(`run npm install, or set HERDR_TEST_ALLOW_MD_SKIP=1: ${e?.message ?? e}`);
    });
  }
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
