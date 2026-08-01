import { test, expect } from '@playwright/test';
import { mockLog, mockState, openAgent } from '../helpers/app';

test.describe('blocked cards', () => {
  test('permission card answers with keys+expect', async ({ page }) => {
    await openAgent(page, 'w2:p1');
    await expect(page.getByText(/waiting on you/i)).toBeVisible();
    await expect(page.getByText(/wants to run/i)).toBeVisible();
    // pick Yes
    await page.getByRole('button', { name: /Yes/i }).first().click();
    await expect
      .poll(async () => {
        const log = await mockLog();
        return log.answers.length > 0;
      })
      .toBeTruthy();
    const log = await mockLog();
    const ans = log.answers[0] as { keys: string[]; expect: string | null };
    expect(ans.keys?.length).toBeGreaterThan(0);
  });

  test('409 forces raw key strip', async ({ page }) => {
    await openAgent(page, 'w2:p1');
    // make expect never match
    await mockState({
      screens: { 'w2:p1': 'completely different screen' },
    });
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: /Yes/i }).first().click();
    // raw keys appear
    await expect(page.locator('.keysrow, .key')).toBeVisible({ timeout: 8_000 });
  });

  test('view screen peek on blocked banner', async ({ page }) => {
    await openAgent(page, 'w2:p1');
    await page.getByRole('button', { name: /view screen/i }).click();
    await expect(page.locator('pre.screen').first()).toBeVisible();
    await page.getByRole('button', { name: /hide screen/i }).click();
  });
});
