import { test, expect } from '@playwright/test';
import { mockLog, openApp } from '../helpers/app';

test.describe('overview cards (phone)', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'phone', 'phone home surface only');
  });

  test('cards view shows project cards; card ＋ opens the launcher', async ({ page }) => {
    await openApp(page, { homeView: 'cards' });
    await expect(page.getByRole('button', { name: 'project overview', pressed: true })).toBeVisible({
      timeout: 10_000,
    });
    // card for app with sessions
    await expect(page.getByText('fix-auth').first()).toBeVisible();
    // quick spawn button on card
    const spawn = page.locator('.group-spawn, button[title*="new session"]').first();
    await expect(spawn).toBeVisible();
    await spawn.click();
    // the card ＋ opens the launcher pre-aimed — the start is the confirm
    await page.locator('.modal.launcher .nc-start').click();
    await expect
      .poll(async () => (await mockLog()).chats.length)
      .toBeGreaterThan(0);
  });

  test('no dormant-project launcher on the cards view', async ({ page }) => {
    await openApp(page, { homeView: 'cards' });
    await expect(page.getByRole('button', { name: 'project overview', pressed: true })).toBeVisible();
    await expect(page.getByText(/start somewhere/i)).toHaveCount(0);
  });

  test('list ↔ cards toggle stays in the same spot', async ({ page }) => {
    await openApp(page, { homeView: 'list' });
    const toggle = page.locator('.home-toggle');
    const before = await toggle.boundingBox();
    await page.getByRole('button', { name: 'project overview' }).click();
    await expect(page.getByRole('button', { name: 'project overview', pressed: true })).toBeVisible();
    expect(await toggle.boundingBox()).toEqual(before);
    await page.getByRole('button', { name: 'session list' }).click();
    await expect(page.locator('.session').first()).toBeVisible();
  });
});
