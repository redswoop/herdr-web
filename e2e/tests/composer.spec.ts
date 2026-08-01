import { test, expect } from '@playwright/test';
import { mockLog, openAgent } from '../helpers/app';

test.describe('composer', () => {
  test('persists text draft across reload', async ({ page }) => {
    await openAgent(page, 'w1:p1');
    await page.locator('textarea').first().fill('draft survives');
    await expect
      .poll(async () => page.evaluate(() => localStorage.getItem('herdr.textDraft.w1:p1')))
      .toBe('draft survives');
    await page.reload();
    await expect(page.locator('textarea').first()).toHaveValue('draft survives', {
      timeout: 10_000,
    });
  });

  test('key strip sends keys', async ({ page }) => {
    await openAgent(page, 'w1:p1');
    await page.getByRole('button', { name: 'toggle key pad' }).click();
    await page.getByRole('button', { name: 'esc', exact: true }).click();
    await expect
      .poll(async () => {
        const log = await mockLog();
        return log.keys.some((k: any) => k.paneId === 'w1:p1' && k.keys?.includes('Escape'));
      })
      .toBeTruthy();
  });

  test('clear draft button empties textarea', async ({ page }) => {
    await openAgent(page, 'w1:p1');
    await page.locator('textarea').first().fill('scratch');
    await page.getByRole('button', { name: 'clear draft' }).click();
    await expect(page.locator('textarea').first()).toHaveValue('');
  });
});
