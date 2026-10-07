import { test, expect, type Page } from '@playwright/test';
import { openAgent } from '../helpers/app';

const MOCK = process.env.MOCK_URL || 'http://127.0.0.1:7684';

async function seedScene(scope: string, cards: Record<string, unknown>[]) {
  const r = await fetch(`${MOCK}/__mock/scene`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scope, cards }),
  });
  if (!r.ok) throw new Error(`seed failed: ${r.status}`);
}
async function pushData(scope: string, id: string, data: unknown) {
  await fetch(`${MOCK}/__mock/scene-data`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scope, id, data }),
  });
}
async function actions() {
  const r = await fetch(`${MOCK}/__mock/scene-actions`);
  return (await r.json()).actions as { scope: string; id: string; action: string }[];
}
async function sceneOf(scope: string) {
  const r = await fetch(`${MOCK}/api/scene/${encodeURIComponent(scope)}`);
  return r.json() as Promise<{ rev: number; cards: { id: string }[] }>;
}

const WS = 'ws:w1';
const PANE = 'pane:w1:p1';
const watch = (d: Partial<{ value: number; out: string; history: { t: number; v: number }[]; kv: [string, string][] }>) => ({
  at: Date.now(), ok: true, code: 0, timedOut: false, ms: 3, out: '', err: '', ...d,
});

/** open the agent view, then seed the stage (seeding after open proves the live stream) */
async function openWithScene(page: Page, wsCards: Record<string, unknown>[], paneCards: Record<string, unknown>[] = []) {
  await openAgent(page, 'w1:p1');
  await seedScene(WS, wsCards);
  if (paneCards.length) await seedScene(PANE, paneCards);
  await expect(page.locator('.scene')).toBeVisible();
}

test.describe('scene panel', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name === 'phone', 'the scene panel is desktop-only for now');
  });

  test('empty stage shows the hint; cards arrive over the stream in scope order', async ({ page }) => {
    await openAgent(page, 'w1:p1');
    const scene = page.locator('.scene');
    await expect(scene).toBeVisible();
    await expect(scene.getByText(/Nothing on stage for ws:w1/)).toBeVisible();
    await expect(scene.locator('.scene-hint')).toContainText('curl -X POST');

    await seedScene(PANE, [{ id: 'pinned', plugin: 'summary', title: 'Pane card', props: { body: 'pane-level' } }]);
    await seedScene(WS, [
      { id: 'state', plugin: 'summary', title: 'State of play', props: { body: '**Building** the thing' } },
      { id: 'cpu', plugin: 'command-watch', title: 'cpu', props: { cmd: 'sensors', render: 'gauge', unit: '°C', min: 0, max: 100, warn: 70, bad: 85 }, data: watch({ value: 42 }) },
    ]);
    const titles = scene.locator('.scene-card-title');
    await expect(titles).toHaveText(['State of play', 'cpu', 'Pane card']);
    await expect(scene.locator('.scene-count')).toHaveText('2'); // the header counts the primary scope
    await expect(scene.locator('.scene-card-plugin').first()).toHaveText('summary');
    await expect(scene.locator('.scene-summary strong').first()).toHaveText('Building');
  });

  test('gauge meter shows value, percent, and level; data frames update it live', async ({ page }) => {
    await openWithScene(page, [
      { id: 'cpu', plugin: 'command-watch', title: 'cpu', props: { cmd: 'x', render: 'gauge', label: 'temp', unit: '°C', min: 0, max: 100, warn: 70, bad: 85 }, data: watch({ value: 42 }) },
    ]);
    const meter = page.locator('.sc-meter');
    await expect(meter).toHaveClass(/lvl-lo/);
    await expect(meter.locator('.val')).toHaveText('42°C');
    await expect(meter.locator('.pct')).toHaveText('42%');
    await expect(meter.locator('.k')).toHaveText('temp');
    await pushData(WS, 'cpu', watch({ value: 88.4 }));
    await expect(meter).toHaveClass(/lvl-hi/);
    await expect(meter.locator('.val')).toHaveText('88.4°C');
  });

  test('sparkline draws one column per sample, newest coloured by its level', async ({ page }) => {
    const history = Array.from({ length: 12 }, (_, i) => ({ t: i, v: 30 + i }));
    await openWithScene(page, [
      { id: 'g', plugin: 'command-watch', title: 'graph', props: { cmd: 'x', render: 'sparkline', unit: '°C', warn: 40, bad: 50 }, data: watch({ value: 41, history }) },
    ]);
    const graph = page.locator('.scene-graph');
    await expect(graph.locator('.now')).toHaveText('41');
    await expect(graph.locator('.now')).toHaveClass(/mid/);
    await expect(graph.locator('.range')).toContainText('30–41°C · 12pt');
    await expect(graph.locator('svg g rect')).toHaveCount(12); // one column per sample
  });

  test('kv and text renderers', async ({ page }) => {
    await openWithScene(page, [
      { id: 'load', plugin: 'command-watch', title: 'load', props: { cmd: 'x', render: 'kv' }, data: watch({ kv: [['1m', '0.22'], ['5m', '0.31']] }) },
      { id: 'tail', plugin: 'command-watch', title: 'tail', props: { cmd: 'x', render: 'text', lines: 2 }, data: watch({ out: 'a\nb\nc\nd\n' }) },
    ]);
    const rows = page.locator('.sc-row');
    await expect(rows).toHaveCount(2);
    await expect(rows.first().locator('.k')).toHaveText('1m');
    await expect(rows.first().locator('.v')).toHaveText('0.22');
    await expect(page.locator('.scene-text').first()).toHaveText(/… 2 more\nc\nd/);
  });

  test('service card: state, uptime, buttons post actions and show the result', async ({ page }) => {
    await openWithScene(page, [
      {
        id: 'svc', plugin: 'service-control', title: 'comfyui', props: { unit: 'comfyui.service' },
        data: { at: Date.now(), ok: true, load: 'loaded', active: 'active', sub: 'running', result: 'success', pid: 4242, restarts: 2, description: 'ComfyUI', uptimeSec: 3700 },
      },
    ]);
    const svc = page.locator('.scene-svc');
    await expect(svc).toHaveClass(/state-ok/);
    await expect(svc.locator('.scene-svc-state')).toHaveText('active·running');
    await expect(svc.locator('.scene-svc-uptime')).toContainText('up 1h01m');
    await expect(svc.locator('.scene-svc-meta')).toContainText('pid 4242');
    await expect(svc.locator('.scene-svc-meta .warn')).toHaveText('↻2');

    await svc.getByRole('button', { name: /restart/ }).click();
    await expect(svc.locator('.scene-svc-last')).toHaveText('restart comfyui.service: ok');
    expect(await actions()).toEqual([{ scope: WS, id: 'svc', action: 'restart' }]);

    // stop asks first; the mock makes it fail so the error path renders
    page.once('dialog', (d) => d.accept());
    await svc.getByRole('button', { name: /stop/ }).click();
    await expect(svc.locator('.scene-svc-last')).toHaveClass(/bad/);
    await expect(svc.locator('.scene-svc-last')).toContainText('failed (exit 1)');
    expect((await actions()).map((a) => a.action)).toEqual(['restart', 'stop']);
  });

  test('service card: a missing unit disables the buttons', async ({ page }) => {
    await openWithScene(page, [
      { id: 'svc', plugin: 'service-control', title: 'ghost', props: { unit: 'ghost.service' }, data: { at: Date.now(), ok: true, load: 'not-found', active: 'inactive', sub: 'dead', result: null, pid: null, restarts: 0, description: null, uptimeSec: null } },
    ]);
    const svc = page.locator('.scene-svc');
    await expect(svc).toHaveClass(/state-missing/);
    await expect(svc.locator('.scene-svc-state')).toHaveText('not found');
    // the bracket glyphs are CSS generated content and land in the accessible
    // name ("[restart]"), so match by position: restart first, then start/stop
    const keys = svc.locator('.sc-key');
    await expect(keys).toHaveText(['restart', 'start']);
    await expect(keys.nth(0)).toBeDisabled();
    await expect(keys.nth(1)).toBeDisabled();
  });

  test('strike removes the card through the ops API; collapsed cards start folded', async ({ page }) => {
    await openWithScene(page, [
      { id: 'a', plugin: 'summary', title: 'A', props: { body: 'aaa' } },
      { id: 'director', plugin: 'summary', title: 'director', props: { body: 'notes here', collapsed: true } },
    ]);
    const cards = page.locator('.scene-card');
    await expect(cards).toHaveCount(2);
    const folded = cards.nth(1);
    await expect(folded).toHaveClass(/collapsed/);
    await expect(folded.locator('.scene-card-body')).toHaveCount(0);
    await folded.locator('.scene-card-title').click();
    await expect(folded.locator('.scene-summary')).toHaveText('notes here');

    await cards.first().locator('.scene-card-x').click();
    await expect(cards).toHaveCount(1);
    expect((await sceneOf(WS)).cards.map((c) => c.id)).toEqual(['director']);
  });

  test('unknown plugin renders a fallback instead of crashing the panel', async ({ page }) => {
    await openWithScene(page, [{ id: 'z', plugin: 'hologram', title: 'future', props: { x: 1 } }]);
    await expect(page.locator('.scene-text')).toContainText('no renderer for "hologram"');
  });

  test('neon toggle and panel toggle persist', async ({ page }) => {
    await openWithScene(page, [{ id: 'a', plugin: 'summary', title: 'A', props: { body: 'a' } }]);
    const scene = page.locator('.scene');
    await expect(scene).not.toHaveClass(/neon/);
    await scene.getByRole('button', { name: /neon/i }).click();
    await expect(scene).toHaveClass(/neon/);
    await expect.poll(() => page.evaluate(() => localStorage.getItem('herdr.scene.neon'))).toBe('1');

    await page.locator('.scene-chip').click();
    await expect(scene).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => localStorage.getItem('herdr.scene.open'))).toBe('0');
    await page.locator('.scene-chip').click();
    await expect(page.locator('.scene')).toBeVisible();
    await expect(page.locator('.scene')).toHaveClass(/neon/, { timeout: 5000 });
  });
});
