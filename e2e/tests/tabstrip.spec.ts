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

  test('each pill has an ×; it confirms, closes, and lands on the neighbour', async ({ page }) => {
    await openApp(page, { hash: '/agent/w1:p1' });
    const strip = page.getByRole('tablist');
    const x = strip.getByRole('button', { name: /^close fix-auth/i });
    await expect(x).toBeVisible(); // the lit tab shows its × without hover
    // declining the confirm leaves everything as it was
    page.once('dialog', (d) => d.dismiss());
    await x.click();
    await expect(strip.getByRole('tab')).toHaveCount(2);
    await expect(page).toHaveURL(/#\/agent\/w1(:|%3A)p1$/);
    page.once('dialog', (d) => d.accept());
    await x.click();
    await expect(page).toHaveURL(/#\/agent\/w1(:|%3A)p2$/);
    const log = await mockLog();
    expect(log.manage).toContainEqual(expect.objectContaining({ paneId: 'w1:p1', action: 'close' }));
    await expect(strip.getByRole('tab')).toHaveCount(1);
  });

  test('keyboard: Tab to a neighbour\'s × and Enter asks to close it, without switching', async ({ page }) => {
    await openApp(page, { hash: '/agent/w1:p1' });
    const strip = page.getByRole('tablist');
    const x = strip.getByRole('button', { name: /^close fix-ui/i });
    await x.focus();
    let asked = false;
    page.once('dialog', (d) => { asked = true; void d.dismiss(); });
    await page.keyboard.press('Enter');
    await expect.poll(() => asked).toBe(true);
    await expect(page).toHaveURL(/#\/agent\/w1(:|%3A)p1$/); // Enter on the × never selects that tab
    await expect(strip.getByRole('tab')).toHaveCount(2);
    page.once('dialog', (d) => d.accept());
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await mockLog()).manage.some((m) => m.paneId === 'w1:p2' && m.action === 'close')).toBe(true);
    await expect(strip.getByRole('tab')).toHaveCount(1);
  });

  test('middle-click on the × itself closes too (the hover text promises it)', async ({ page }) => {
    await openApp(page, { hash: '/agent/w1:p1' });
    const strip = page.getByRole('tablist');
    await strip.getByRole('tab', { name: /fix-ui/i }).hover();
    page.once('dialog', (d) => d.accept());
    await strip.getByRole('button', { name: /^close fix-ui/i }).click({ button: 'middle' });
    await expect.poll(async () => (await mockLog()).manage.some((m) => m.paneId === 'w1:p2' && m.action === 'close')).toBe(true);
    await expect(strip.getByRole('tab')).toHaveCount(1);
  });

  test('middle-click on a pill closes it, not the chat you are reading', async ({ page }) => {
    await openApp(page, { hash: '/agent/w1:p1' });
    const strip = page.getByRole('tablist');
    page.once('dialog', (d) => d.accept());
    await strip.getByRole('tab', { name: /fix-ui/i }).click({ button: 'middle' });
    const log = await mockLog();
    expect(log.manage).toContainEqual(expect.objectContaining({ paneId: 'w1:p2', action: 'close' }));
    await expect(page).toHaveURL(/#\/agent\/w1(:|%3A)p1$/);
    await expect(strip.getByRole('tab')).toHaveCount(1);
  });
});
