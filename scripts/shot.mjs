import { chromium } from '@playwright/test';
const [,, url, tok, out] = process.argv;
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
p.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await p.goto(url, { waitUntil: 'load' }); await p.waitForTimeout(1500);
const gate = p.locator('input[placeholder="access token"]');
if (await gate.count()) { await gate.fill(tok); await p.keyboard.press('Enter'); await p.waitForTimeout(1500); }
await p.waitForTimeout(3500);
await p.screenshot({ path: `${out}-home.png`, clip: { x: 324, y: 0, width: 1116, height: 420 } });
for (const [k, n] of [['2','disk'],['3','compute'],['5','printers'],['6','services']]) {
  await p.keyboard.press(k); await p.waitForTimeout(400);
  const box = await p.locator('.deck-detail').boundingBox();
  if (box) await p.screenshot({ path: `${out}-${n}.png`, clip: { x: box.x - 4, y: box.y - 4, width: box.width + 8, height: Math.min(box.height + 8, 500) } });
  await p.keyboard.press(k); await p.waitForTimeout(200);
}
await p.keyboard.press('j'); await p.waitForTimeout(200);
console.log('focused', await p.evaluate(() => document.activeElement?.className));
console.log('rows', JSON.stringify(await p.locator('.arow-ctx').evaluateAll((els) => els.map((e) => e.textContent))));
await b.close();
