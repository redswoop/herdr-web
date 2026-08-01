import { test, expect } from '@playwright/test';
import { openAgent } from '../helpers/app';

test.describe('live tail', () => {
  test('shows live screen while agent is working', async ({ page }) => {
    await openAgent(page, 'w1:p2');
    await expect(page.getByText(/live screen|live tail/i).first()).toBeVisible({
      timeout: 10_000,
    });
    // body may be open by default
    const head = page.locator('.live-tail-head, .live-tail').first();
    await expect(head).toBeVisible();
  });

  test('toggle persists herdr.liveTail', async ({ page }) => {
    await openAgent(page, 'w1:p2');
    const head = page.locator('.live-tail-head').first();
    await head.click();
    await expect
      .poll(async () => page.evaluate(() => localStorage.getItem('herdr.liveTail')))
      .toBe('closed');
  });
});
