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
    // scope to the session rail — wide mode also shows fix-auth as an
    // overview card, which collapsing the rail group must not (and does not) hide
    const rail = page.getByRole('navigation');
    const fixAuth = rail.getByRole('button', { name: /fix-auth/i }).first();
    await expect(fixAuth).toBeVisible();
    // assert the UI actually collapses, not just the storage side-effect —
    // the old localStorage-only check survived a broken collapse
    await rail.locator('.group-head').first().click();
    await expect(fixAuth).toBeHidden();
    await page.reload();
    await expect(page.getByRole('heading', { name: /herd/i }).first()).toBeVisible();
    // the collapse persisted: still hidden after reload
    await expect(rail.getByRole('button', { name: /fix-auth/i })).toBeHidden();
    // and expanding brings it back
    await rail.locator('.group-head').first().click();
    await expect(rail.getByRole('button', { name: /fix-auth/i }).first()).toBeVisible();
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
