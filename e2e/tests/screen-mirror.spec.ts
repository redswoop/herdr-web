import { test, expect } from '@playwright/test';
import { mockState, openAgent } from '../helpers/app';

test.describe('screen mirror (slash commands)', () => {
  test('slash command arms local dialog mirror', async ({ page }) => {
    await openAgent(page, 'w1:p1');
    await mockState({
      screens: { 'w1:p1': '╭─ /model ──\n│ ❯ 1. opus\n╰──────────\n' },
      agentStatus: { 'w1:p1': 'idle' },
    });
    const ta = page.locator('textarea').first();
    await ta.fill('/model');
    await page.getByRole('button', { name: 'send' }).click();
    // mock leaves working briefly then lands command after 1.5s; mirror arms at 800ms
    await expect(page.getByText(/local dialog/i)).toBeVisible({ timeout: 5_000 });
  });
});
