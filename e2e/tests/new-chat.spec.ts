import { test, expect } from '@playwright/test';
import { mockLog, openApp } from '../helpers/app';

test.describe('new chat launcher', () => {
  test('opens dialog, lists kinds, spawns chat', async ({ page }) => {
    await openApp(page);
    // title attribute, visible glyph is ＋
    await page.locator('button.new-chat').first().click();
    await expect(page.locator('.modal.launcher')).toBeVisible();
    await expect(page.getByText(/open workspaces|projects|elsewhere/i).first()).toBeVisible();
    await expect(page.locator('.modal.launcher select, .modal.launcher .kind').first()).toBeVisible();
    await page.locator('.modal.launcher button.primary, .modal.launcher button[type=submit]').click();
    await expect
      .poll(async () => (await mockLog()).chats.length)
      .toBeGreaterThan(0);
  });
});
