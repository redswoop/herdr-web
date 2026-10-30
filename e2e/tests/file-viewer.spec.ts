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

// TODO #8 + #16: an image/video pages sideways through its folder's images
// (or videos), and blows up to a full-window lightbox
test.describe('media viewer', () => {
  const at = (p: string) => `/agent/${encodeURIComponent('w1:p1')}/file/${encodeURIComponent(p)}`;

  test('arrows step through the folder’s images only; back leaves in one go', async ({ page }) => {
    await openApp(page, { hash: `/agent/${encodeURIComponent('w1:p1')}` });
    await page.evaluate((h) => void (location.hash = h), at('/srv/gallery/a.png'));
    const viewer = page.locator('.file-viewer').first();
    const path = viewer.locator('.file-path');
    await expect(viewer.locator('.media-count')).toHaveText(/1 \/ 3/);
    await expect(viewer.getByRole('button', { name: 'previous' })).toBeDisabled();

    await page.keyboard.press('ArrowRight');
    await expect(path).toHaveValue('/srv/gallery/b.jpg'); // skipped the clip
    await viewer.getByRole('button', { name: 'next' }).click({ force: true }); // hover-revealed
    await expect(path).toHaveValue('/srv/gallery/c.png'); // skipped notes.txt
    await expect(viewer.getByRole('button', { name: 'next' })).toBeDisabled();
    await page.keyboard.press('ArrowLeft');
    await expect(path).toHaveValue('/srv/gallery/b.jpg');

    // steps replaced the route: one back closes the viewer
    await page.goBack();
    await expect(page).toHaveURL(/#\/agent\/w1%3Ap1$/);
    await expect(page.locator('.file-viewer')).toHaveCount(0);
  });

  test('videos page through videos', async ({ page }) => {
    await openApp(page, { hash: at('/srv/gallery/clip1.webm') });
    const viewer = page.locator('.file-viewer').first();
    await expect(viewer.locator('.media-count')).toHaveText(/1 \/ 2/);
    await page.keyboard.press('ArrowRight');
    await expect(viewer.locator('.file-path')).toHaveValue('/srv/gallery/clip2.webm');
  });

  test('arrows typed in the composer stay in the composer', async ({ page }) => {
    await openApp(page, { hash: at('/srv/gallery/a.png') });
    const viewer = page.locator('.file-viewer').first();
    await expect(viewer.locator('.media-count')).toHaveText(/1 \/ 3/);
    const ta = page.locator('.composer textarea');
    test.skip(!(await ta.isVisible()), 'phone: the viewer covers the composer');
    await ta.fill('abc');
    await ta.press('ArrowLeft');
    await expect(viewer.locator('.file-path')).toHaveValue('/srv/gallery/a.png');
  });

  test('click → lightbox; arrows step inside it; Esc closes only the lightbox', async ({ page }) => {
    await openApp(page, { hash: at('/srv/gallery/a.png') });
    const viewer = page.locator('.file-viewer').first();
    await expect(viewer.locator('.media-count')).toHaveText(/1 \/ 3/);
    await viewer.getByRole('button', { name: 'full window' }).click();
    const lb = page.getByRole('dialog', { name: 'full window' });
    await expect(lb).toBeVisible();
    await expect(lb.locator('.lb-name')).toHaveText('a.png · 1 / 3');
    await page.keyboard.press('ArrowRight');
    await expect(lb.locator('.lb-name')).toHaveText('b.jpg · 2 / 3');
    await page.keyboard.press('Escape');
    await expect(lb).toBeHidden();
    await expect(viewer).toBeVisible();
    await expect(viewer.locator('.file-path')).toHaveValue('/srv/gallery/b.jpg');

    // and the picture itself opens it; the backdrop closes it
    await viewer.locator('.file-img').click();
    await expect(lb).toBeVisible();
    await lb.locator('.lb-backdrop').click({ position: { x: 5, y: 120 } }); // above the picture
    await expect(lb).toBeHidden();
  });
});

test('a video keeps its playhead moving into the lightbox and back', async ({ page }) => {
  await openApp(page, { hash: `/agent/${encodeURIComponent('w1:p1')}/file/${encodeURIComponent('/srv/gallery/clip1.webm')}` });
  const viewer = page.locator('.file-viewer').first();
  const inline = viewer.locator('video.file-video');
  await expect.poll(() => inline.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThan(0);
  await inline.evaluate((v: HTMLVideoElement) => void (v.currentTime = 1.7));
  await expect.poll(() => inline.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeCloseTo(1.7, 1);

  await viewer.getByRole('button', { name: 'full window' }).click();
  const big = page.getByRole('dialog', { name: 'full window' }).locator('video');
  await expect.poll(() => big.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeCloseTo(1.7, 1);
  await expect(viewer.getByText('playing full window')).toBeVisible();

  await big.evaluate((v: HTMLVideoElement) => void (v.currentTime = 0.6));
  await page.keyboard.press('Escape');
  await expect.poll(() => inline.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeCloseTo(0.6, 1);
});

// TODO #17: ⌂ = the session's project root; pins are the host's, above a listing
test.describe('places', () => {
  const at = (p: string) => `/agent/${encodeURIComponent('w1:p1')}/file/${encodeURIComponent(p)}`;

  test('⌂ jumps to the project root and dims there', async ({ page }) => {
    await openApp(page, { hash: at('/srv/gallery/a.png') });
    const viewer = page.locator('.file-viewer').first();
    await viewer.getByRole('button', { name: 'project home' }).click();
    await expect(viewer.locator('.file-path')).toHaveValue('/home/armen/src/app');
    await expect(viewer.getByRole('button', { name: 'project home' })).toHaveClass(/dim/);
  });

  test('pin the folder you are in; a pin jumps there; right-click unpins', async ({ page }) => {
    await openApp(page, { hash: at('/srv/gallery') });
    const viewer = page.locator('.file-viewer').first();
    const strip = viewer.getByRole('navigation', { name: 'pinned places' });
    await expect(strip.getByRole('button')).toHaveText(['★ Sync', '☆ pin this folder']);

    await strip.getByRole('button', { name: '☆ pin this folder' }).click();
    await expect(strip.getByRole('button')).toHaveText(['★ Sync', '★ gallery', '★ pinned']);
    await expect(strip.getByRole('button', { name: '★ gallery' })).toHaveClass(/here/);

    await strip.getByRole('button', { name: '★ Sync' }).click();
    await expect(viewer.locator('.file-path')).toHaveValue('/home/armen/Sync');

    await strip.getByRole('button', { name: '★ gallery' }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Unpin' }).click();
    // we're in Sync now, which is pinned
    await expect(strip.getByRole('button')).toHaveText(['★ Sync', '★ pinned']);
  });
});
