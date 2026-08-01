import { test, expect } from '@playwright/test';
import { mockReset, mockState, openApp } from '../helpers/app';

test.describe('roster', () => {
  test('shows sessions with status words and focused mark', async ({ page }) => {
    await openApp(page);
    await expect(page.getByRole('button', { name: /fix-auth/i }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /fix-ui/i }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /explore/i }).first()).toBeVisible();
    // status words on session chips
    await expect(page.locator('.session .state-word.idle').first()).toBeVisible();
    await expect(page.locator('.session .state-word.working').first()).toBeVisible();
    await expect(page.locator('.session .state-word.blocked').first()).toBeVisible();
    // focused mark on fix-auth
    await expect(page.locator('.session .focus-mark').first()).toBeVisible();
    // starting + fresh tags
    await expect(page.locator('.session .tag.warn').first()).toBeVisible();
  });

  test('group-by modes switch labels', async ({ page }) => {
    await openApp(page);
    const tablist = page.getByRole('tablist', { name: /group sessions/i });
    await expect(tablist).toBeVisible();
    await tablist.getByRole('tab', { name: 'status' }).click();
    await expect(page.getByText('blocked', { exact: false }).first()).toBeVisible();
    await tablist.getByRole('tab', { name: 'agent' }).click();
    await expect(page.getByText(/Claude|claude|Grok|grok/i).first()).toBeVisible();
    await tablist.getByRole('tab', { name: 'project' }).click();
    await expect(page.getByText('app').first()).toBeVisible();
  });

  test('collapse group and persist across reload', async ({ page }) => {
    await openApp(page);
    // workspace mode: collapse first group
    const groupHead = page.locator('.group-head').first();
    await groupHead.click();
    // agents inside first group should hide (fix-auth is in w1)
    // after collapse, session buttons under that group gone — check localStorage key format
    const closed = await page.evaluate(() => localStorage.getItem('herdr.groupsClosed'));
    expect(closed).toBeTruthy();
    expect(closed!).toMatch(/workspace:/);
    await page.reload();
    await expect(page.getByRole('heading', { name: /herd/i }).first()).toBeVisible();
    const closed2 = await page.evaluate(() => localStorage.getItem('herdr.groupsClosed'));
    expect(closed2).toBe(closed);
  });

  test('herdrDown shows unreachable empty state', async ({ page }) => {
    await openApp(page);
    await mockState({
      roster: { agents: [], workspaces: [], tabs: [], herdrDown: true },
      herdrDown: true,
    });
    // wait for SSE roster update
    await expect(page.getByText(/herdr server unreachable|no agents/i)).toBeVisible({
      timeout: 10_000,
    });
  });

  test('selecting a session opens agent view', async ({ page }) => {
    await openApp(page);
    await page.locator('button.session', { hasText: 'fix-auth' }).first().click();
    await expect(page.getByText(/list the auth module files/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.composer')).toBeVisible();
  });

  test('connection lost banner when roster SSE dies after load', async ({ page }) => {
    await openApp(page);
    await expect(page.getByRole('button', { name: /fix-auth/i }).first()).toBeVisible();
    // Abort subsequent roster stream connections so reconnect also fails → banner
    await page.route('**/api/roster/stream**', (route) => route.abort());
    await mockState({ disconnectRoster: true });
    await expect(page.locator('.conn-banner')).toBeVisible({ timeout: 20_000 });
  });
});
