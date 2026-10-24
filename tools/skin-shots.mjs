// Deterministic cyber-skin screenshots for pixel-diffing a theme change:
// the e2e mock daemon (:7699) + vite dev (:5199), reduced motion, the
// prefs endpoint stubbed so a headless run never touches synced settings.
// Shoot before and after, then diff the PNGs (PIL ImageChops works).
//   node tools/skin-shots.mjs <outdir>
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MOCK_PORT = 7699, WEB_PORT = 5199;
const out = process.argv[2]; mkdirSync(out, { recursive: true });
const kids = [];
const up = (url) => new Promise((ok, no) => { let n = 0; const t = setInterval(async () => { try { const r = await fetch(url); if (r.ok) { clearInterval(t); ok(); } } catch {} if (++n > 60) { clearInterval(t); no(new Error('timeout ' + url)); } }, 500); });
kids.push(spawn('node', ['mock/server.mjs'], { cwd: ROOT + '/e2e', env: { ...process.env, MOCK_PORT: String(MOCK_PORT) }, stdio: 'ignore' }));
kids.push(spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(WEB_PORT), '--strictPort'], { cwd: ROOT + '/web', env: { ...process.env, HERDR_API_PROXY: `http://127.0.0.1:${MOCK_PORT}` }, stdio: 'ignore', detached: true }));
try {
  await up(`http://127.0.0.1:${MOCK_PORT}/api/roster`); await up(`http://127.0.0.1:${WEB_PORT}/`);
  const b = await chromium.launch();
  const shots = [
    ['home-list-wide', { w: 1280, h: 800, mobile: false }, {}],
    ['home-cards-wide', { w: 1280, h: 800, mobile: false }, { homeView: 'cards' }],
    ['home-list-phone', { w: 390, h: 844, mobile: true }, {}],
    ['agent-wide', { w: 1280, h: 800, mobile: false }, { hash: '/agent/w1%3Ap1' }],
    ['agent-phone', { w: 390, h: 844, mobile: true }, { hash: '/agent/w1%3Ap1' }],
    ['blocked-wide', { w: 1280, h: 800, mobile: false }, { hash: '/agent/w2%3Ap1' }],
    ['prefs-wide', { w: 1280, h: 800, mobile: false }, { prefs: true }],
    ['launcher-wide', { w: 1280, h: 800, mobile: false }, { launcher: true }],
  ];
  for (const [name, vp, o] of shots) {
    await fetch(`http://127.0.0.1:${MOCK_PORT}/__mock/reset`, { method: 'POST' });
    const ctx = await b.newContext({ viewport: { width: vp.w, height: vp.h }, isMobile: vp.mobile, hasTouch: vp.mobile, deviceScaleFactor: 1, reducedMotion: 'reduce', timezoneId: 'UTC' });
    await ctx.addCookies([{ name: 'herdr.theme', value: 'cyber', url: `http://127.0.0.1:${WEB_PORT}` }]);
    const page = await ctx.newPage();
    await page.clock.install({ time: new Date('2026-10-24T12:00:00Z') });
    await page.addInitScript((hv) => { localStorage.setItem('herdr.homeView', hv); localStorage.setItem('herdr.groupBy', 'workspace'); sessionStorage.setItem('herdr.booted', '1'); }, o.homeView ?? 'list');
    await page.route('**/api/prefs', (r) => r.request().method() === 'PUT' ? r.fulfill({ status: 200, body: '{}' }) : r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ prefs: { theme: 'cyber', colors: {}, palette: {}, base: {} } }) }));
    const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
    await page.goto(`http://127.0.0.1:${WEB_PORT}/${o.hash ? '#' + o.hash : ''}`, { waitUntil: 'networkidle' });
    await page.addStyleTag({ content: '.cy-ticker{visibility:hidden} .age,.freshness-age{visibility:hidden}' });
    if (o.prefs) { await page.locator('button[title*="pref" i], button[aria-label*="pref" i], button:has-text("⚙")').first().click(); await page.waitForTimeout(300); }
    if (o.launcher) { await page.locator('.bar button[title*="new" i], .bar button[aria-label*="new" i], button:has-text("＋"), button:has-text("+")').first().click(); await page.waitForTimeout(300); }
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${out}/${name}.png` });
    if (errs.length) console.log(name, 'pageerrors:', errs);
    await ctx.close();
  }
  await b.close();
  console.log('ok', out);
} finally {
  for (const k of kids) { try { process.kill(-k.pid, 'SIGTERM'); } catch {} try { k.kill('SIGTERM'); } catch {} }
}
