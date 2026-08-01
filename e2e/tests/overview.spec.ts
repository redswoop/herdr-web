import { test, expect } from '@playwright/test';
import { mockLog, openApp } from '../helpers/app';

test.describe('overview cards (phone)', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'phone', 'phone home surface only');
  });

  test('cards view shows project cards and quick spawn', async ({ page }) => {
    await openApp(page, { homeView: 'cards' });
    await expect(page.getByText(/the herd|project/i).first()).toBeVisible({ timeout: 10_000 });
    // card for app with sessions
    await expect(page.getByText('fix-auth').first()).toBeVisible();
    // quick spawn button on card
    const spawn = page.locator('.group-spawn, button[title*="new session"]').first();
    await expect(spawn).toBeVisible();
    await spawn.click();
    await expect
      .poll(async () => (await mockLog()).chats.length)
      .toBeGreaterThan(0);
  });

  test('dormant projects section present', async ({ page }) => {
    await openApp(page, { homeView: 'cards' });
    await expect(page.getByText(/start somewhere|dormant/i).first()).toBeVisible({
      timeout: 10_000,
    });
  });
});
