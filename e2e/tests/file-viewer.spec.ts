import { test, expect } from '@playwright/test';
import { openApp } from '../helpers/app';

test.describe('file viewer', () => {
  test('opens via hash route and shows markdown', async ({ page }) => {
    await openApp(page, {
      hash: `/agent/${encodeURIComponent('w1:p1')}/file/${encodeURIComponent('/home/armen/src/app/README.md')}`,
    });
    const viewer = page.locator('.file-viewer').first();
    await expect(viewer).toBeVisible({ timeout: 10_000 });
    await expect(viewer.locator('.file-path')).toHaveValue(/README/i);
    // rendered md or raw content from fixture
    await expect(viewer.locator('.file-md, .file-pre, .file-body').first()).toBeVisible();
    await viewer.getByRole('button', { name: /raw|pretty/i }).click();
  });
});

test.describe('folder sort', () => {
  const dirHash = (p: string) => `/agent/${encodeURIComponent('w1:p1')}/file/${encodeURIComponent(p)}`;

  test('one sort menu: name/kind/size/date + folders first, remembered', async ({ page }) => {
    await openApp(page, { hash: dirHash('/home/armen/src/app/') });
    const viewer = page.locator('.file-viewer').first();
    const sort = viewer.getByRole('button', { name: 'sort', exact: true });
    await expect(sort).toHaveText(/name ↑/);

    await sort.click();
    const menu = page.getByRole('menu');
    await expect(menu.getByRole('menuitem')).toHaveText(['name ↑', 'kind', 'size', 'date', '✓ folders first']);
    const byKind = page.waitForRequest((r) => r.url().includes('sort=kind&desc=0'));
    await menu.getByRole('menuitem', { name: 'kind' }).click();
    await byKind;
    await expect(menu).toBeHidden();
    await expect(sort).toHaveText(/kind ↑/);

    await sort.click();
    const mixed = page.waitForRequest((r) => r.url().includes('folders=mix'));
    await page.getByRole('menuitem', { name: /folders first/ }).click();
    await mixed;
    await expect(sort).toHaveText(/kind ↑ · folders mixed/);

    // per-device habit: survives a reload
    await page.reload();
    await expect(page.locator('.file-viewer').first().getByRole('button', { name: 'sort', exact: true })).toHaveText(
      /kind ↑ · folders mixed/,
    );
  });

  test('the sort header stays put while the listing scrolls', async ({ page }) => {
    await openApp(page, { hash: dirHash('/home/armen/src/app/renders') });
    const viewer = page.locator('.file-viewer').first();
    await expect(viewer.locator('.dir-row')).toHaveCount(81); // 80 + ..
    const body = viewer.locator('.file-body');
    const top = (await body.boundingBox())!.y;
    await body.evaluate((el) => (el.scrollTop = el.scrollHeight));
    const head = (await viewer.locator('.dir-head').boundingBox())!;
    expect(Math.abs(head.y - top)).toBeLessThan(2);
    // and the menu opens over the full-screen viewer
    await viewer.getByRole('button', { name: 'sort', exact: true }).click();
    await expect(page.getByRole('menuitem', { name: 'date' })).toBeVisible();
    await page.getByRole('menuitem', { name: 'date' }).click();
    await expect(page.getByRole('menu')).toBeHidden();
  });
});
