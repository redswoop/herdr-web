import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { mockLog, mockReset, mockState, openApp } from '../helpers/app';

const groupBy = async (page: Page, mode: RegExp) => {
  await page.getByRole('button', { name: /sort and group/i }).click();
  await page.getByRole('menuitemradio', { name: mode }).click();
};

test.describe('roster', () => {
  test('shows sessions with status words and focused mark', async ({ page }) => {
    await openApp(page);
    await expect(page.getByRole('button', { name: /fix-auth/i }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /fix-ui/i }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /explore/i }).first()).toBeVisible();
    // status words only where they need attention — idle rows show age instead
    await expect(page.locator('.session .state-word.idle')).toHaveCount(0);
    await expect(page.locator('.session .state-word.working').first()).toBeVisible();
    await expect(page.locator('.session .state-word.blocked').first()).toBeVisible();
    // focused mark on fix-auth
    await expect(page.locator('.session .focus-mark').first()).toBeVisible();
    // starting + fresh tags
    await expect(page.locator('.session .tag.warn').first()).toBeVisible();
  });

  test('group-by modes switch labels', async ({ page }) => {
    await openApp(page);
    // the recent list is flat: no group headers
    await groupBy(page, /^❯? ?recent/);
    await expect(page.getByRole('navigation').locator('.group-head')).toHaveCount(0);
    await groupBy(page, /by status/);
    await expect(page.getByText('blocked', { exact: false }).first()).toBeVisible();
    await groupBy(page, /by agent/);
    await expect(page.getByText(/Claude|claude|Grok|grok/i).first()).toBeVisible();
    await groupBy(page, /by project/);
    await expect(page.getByText('app').first()).toBeVisible();
    await groupBy(page, /^❯? ?recent/);
    await expect(page.getByRole('navigation').locator('.group-head')).toHaveCount(0);
  });

  test('collapse group and persist across reload', async ({ page }) => {
    await openApp(page);
    // scope to the session rail — wide mode also shows fix-auth as an
    // overview card, which collapsing the rail group must not (and does not) hide
    const rail = page.getByRole('navigation');
    const fixAuth = rail.getByRole('button', { name: /fix-auth/i }).first();
    await expect(fixAuth).toBeVisible();
    await groupBy(page, /by space/);
    const fixAuthHead = rail.locator('section.group', { hasText: /fix-auth/i }).locator('.group-head');
    // assert the UI actually collapses, not just the storage side-effect —
    // the old localStorage-only check survived a broken collapse
    await fixAuthHead.click();
    await expect(fixAuth).toBeHidden();
    await page.reload();
    await expect(page.getByRole('heading', { name: /herd/i }).first()).toBeVisible();
    // the collapse persisted: still hidden after reload
    await expect(rail.getByRole('button', { name: /fix-auth/i })).toBeHidden();
    // and expanding brings it back — its section no longer contains a
    // visible fix-auth to anchor on, so find the one collapsed group
    await rail.locator('section.group:not(.empties) .group-head.closed').click();
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

  test('tapping the freshness dot re-snapshots the roster', async ({ page }) => {
    await openApp(page);
    const dot = page.locator('.sidebar .freshness');
    await expect(dot).toHaveClass(/\bok\b/);
    const before = (await mockLog()).refreshes;
    await dot.click();
    await expect.poll(async () => (await mockLog()).refreshes).toBeGreaterThan(before);
  });

  test('pull down at the top of the list refreshes', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'phone', 'touch gesture');
    await openApp(page);
    await expect(page.locator('.session').first()).toBeVisible();
    const before = (await mockLog()).refreshes;
    // synthesize the gesture — playwright has no touch drag
    await page.locator('.sessions').evaluate((el) => {
      const r = el.getBoundingClientRect();
      const at = (y: number) =>
        new Touch({ identifier: 1, target: el, clientX: r.left + 40, clientY: y });
      const fire = (type: string, y: number) =>
        el.dispatchEvent(
          new TouchEvent(type, {
            touches: type === 'touchend' ? [] : [at(y)],
            changedTouches: [at(y)],
            bubbles: true,
            cancelable: true,
          }),
        );
      fire('touchstart', r.top + 10);
      for (let y = 20; y <= 200; y += 20) fire('touchmove', r.top + 10 + y);
      fire('touchend', r.top + 210);
    });
    await expect.poll(async () => (await mockLog()).refreshes).toBeGreaterThan(before);
  });

  test('coming back to the foreground re-snapshots', async ({ page }) => {
    await openApp(page);
    await expect(page.locator('.session').first()).toBeVisible();
    const before = (await mockLog()).refreshes;
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect.poll(async () => (await mockLog()).refreshes).toBeGreaterThan(before);
  });
});
