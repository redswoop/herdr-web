import { chromium } from '@playwright/test';
const out = process.argv[2];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
// NEON=1 → screenshot the neon variant (same localStorage flag the toggle uses)
if (process.env.NEON) await page.addInitScript(() => localStorage.setItem('herdr.scene.neon', '1'));
await page.goto('http://100.119.251.97:5194/#/agent/w20%3Ap1', { waitUntil: 'networkidle' });
await page.waitForSelector('.scene-card', { timeout: 10_000 }).catch(() => {});
await page.waitForTimeout(2500);
await page.screenshot({ path: out });
console.log('cards:', await page.locator('.scene-card').count());
console.log('errors:', JSON.stringify(errors));
await browser.close();
