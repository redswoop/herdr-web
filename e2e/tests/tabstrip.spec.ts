import { test, expect } from '@playwright/test';
import { mockLog, openApp } from '../helpers/app';

// the strip is wide-only; the phone keeps the list
test.describe('tab strip', () => {
  test.skip(({ viewport }) => !viewport || viewport.width < 721, 'wide layout only');

  test('lists the workspace mates, switches, and aims ＋ at the space', async ({ page }) => {
    await openApp(page, { hash: '/agent/w1:p1' });
    const strip = page.getByRole('tablist');
    await expect(strip).toBeVisible();
    // every chat in the space is a pill, the open one lit — order never shifts
    await expect(strip.getByRole('tab')).toHaveCount(2);
    await expect(strip.getByRole('tab', { name: /fix-auth/i })).toHaveAttribute('aria-selected', 'true');
    // a chat from another space is not on this strip
    await expect(strip.getByRole('tab', { name: /explore/i })).toHaveCount(0);

    await strip.getByRole('tab', { name: /fix-ui/i }).click();
    await expect(page).toHaveURL(/#\/agent\/w1(:|%3A)p2$/);
    await expect(strip.getByRole('tab', { name: /fix-ui/i })).toHaveAttribute('aria-selected', 'true');
    await expect(strip.getByRole('tab').first()).toHaveAttribute('aria-selected', 'false');

    await strip.getByRole('button', { name: /new chat in app/i }).click();
    // the launcher opens already aimed at this space — its path, not a picker
    await expect(page.locator('.modal-backdrop')).toBeVisible();
    await expect(page.locator('.modal-backdrop')).toContainText(/app/);
  });

  test('right-click → close on the open chat lands on its neighbour', async ({ page }) => {
    await openApp(page, { hash: '/agent/w1:p1' });
    page.once('dialog', (d) => d.accept());
    await page.getByRole('tablist').getByRole('tab', { name: /fix-auth/i }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: /^close agent/i }).click();
    await expect(page).toHaveURL(/#\/agent\/w1(:|%3A)p2$/);
    const log = await mockLog();
    expect(log.manage).toContainEqual(expect.objectContaining({ paneId: 'w1:p1', action: 'close' }));
    await expect(page.getByRole('tablist').getByRole('tab')).toHaveCount(1);
  });

});
