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

  test('grok plan card answers with option, not a digit key', async ({ page }) => {
    await openAgent(page, 'w2:p1');
    // openAgent resets to the permission fixture; swap in a grok plan overlay
    // and reload so useBlockedContext refetches.
    await mockState({
      blocked: {
        'w2:p1': {
          kind: 'plan',
          dialect: 'grok',
          plan: '# Nuclear Minecraft\n\nA datapack plan.',
          question: 'Waiting on plan approval',
          options: [
            { n: 1, label: 'Approve and start building', description: 'a', selected: false },
            { n: 2, label: 'Request changes', description: 's', selected: false, input: true },
            { n: 3, label: 'Quit plan', description: 'q', selected: false },
          ],
        },
      },
    });
    await page.reload();
    await expect(page.getByRole('button', { name: /approve and start building/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /quit plan/i })).toBeVisible();
    await page.getByRole('button', { name: /approve and start building/i }).click();
    await expect
      .poll(async () => {
        const log = await mockLog();
        return log.answers.length > 0;
      })
      .toBeTruthy();
    const ans = (await mockLog()).answers[0] as { option?: number; keys?: string[] };
    expect(ans.option).toBe(1);
    expect(ans.keys).toBeUndefined();
  });

  test('view screen peek on blocked banner', async ({ page }) => {
    await openAgent(page, 'w2:p1');
    await page.getByRole('button', { name: /view screen/i }).click();
    await expect(page.locator('pre.screen').first()).toBeVisible();
    await page.getByRole('button', { name: /hide screen/i }).click();
  });
});
