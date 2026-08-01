import { test, expect } from '@playwright/test';
import { mockReset } from '../helpers/app';

/**
 * Auth is environment-dependent (MOCK_TOKEN). Default mock has auth off —
 * this suite only asserts the gate UI when we spin a second mock isn't practical
 * mid-run, so we test the unfenced happy path + document title / shell load.
 *
 * TokenGate is covered by injecting a 401 via page.route when needed.
 */
test.describe('shell auth', () => {
  test.beforeEach(async () => {
    await mockReset();
  });

  test('loads roster shell without token when mock auth is off', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /herd/i }).first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole('button', { name: /fix-auth/i }).first()).toBeVisible();
  });

  test('TokenGate appears when roster returns 401', async ({ page }) => {
    await page.route('**/api/roster**', async (route) => {
      if (route.request().url().includes('stream')) return route.continue();
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'missing/bad token' }),
      });
    });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /fenced/i })).toBeVisible();
    await expect(page.getByPlaceholder(/access token/i)).toBeVisible();
  });

  test('blocked agents update document title', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: /fix-auth/i }).first()).toBeVisible({
      timeout: 15_000,
    });
    // fixture has 1 blocked agent (w2:p1)
    await expect.poll(async () => page.title()).toMatch(/\(1\) herdr/);
  });
});
