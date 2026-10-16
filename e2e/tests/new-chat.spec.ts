import { test, expect } from '@playwright/test';
import { mockLog, openApp } from '../helpers/app';

const launcher = '.modal.launcher';

test.describe('new chat launcher', () => {
  test('header ＋ opens a pre-aimed launcher that starts on confirm', async ({ page }) => {
    await openApp(page);
    await page.locator('button.new-chat').first().click();
    await expect(page.locator(launcher)).toBeVisible();
    // pre-aimed: the place is picked, the list is folded
    await expect(page.locator('.nc-where')).toBeVisible();
    await expect(page.locator('.nc-picker')).toHaveCount(0);
    // agent row lists only installed kinds
    await expect(page.getByRole('radiogroup', { name: 'agent' }).getByRole('radio').first()).toBeVisible();
    const start = page.locator(`${launcher} .nc-start`);
    await expect(start).toHaveText(/^start \S+ in /);
    await start.click();
    await expect.poll(async () => (await mockLog()).chats.length).toBeGreaterThan(0);
  });

  test('a space ＋ opens the launcher aimed at that space — no instant spawn', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: /sort and group/i }).click();
    await page.getByRole('menuitemradio', { name: /by space/ }).click();
    const before = (await mockLog()).chats.length;
    await page.locator('.group-spawn').first().click();
    await expect(page.locator(launcher)).toBeVisible();
    expect((await mockLog()).chats.length).toBe(before);
    await page.locator(`${launcher} .nc-start`).click();
    await expect.poll(async () => (await mockLog()).chats.length).toBe(before + 1);
    const body = (await mockLog()).chats.at(-1) as { workspaceId?: string };
    expect(body.workspaceId).toBeTruthy();
  });

  test('picker filters places and Enter picks the top match', async ({ page }) => {
    await openApp(page);
    await page.locator('button.new-chat').first().click();
    await page.locator('.nc-where').click();
    const filter = page.getByPlaceholder('filter places…');
    await expect(filter).toBeVisible();
    await filter.fill('zzzz-no-such-place');
    await expect(page.locator('.place-row')).toHaveCount(0);
    await filter.fill('');
    await expect(page.locator('.place-row').first()).toBeVisible();
    await filter.press('Enter');
    await expect(page.locator('.nc-picker')).toHaveCount(0);
  });

  test('permission mode is remembered per kind', async ({ page }) => {
    await openApp(page);
    await page.locator('button.new-chat').first().click();
    await page.locator('.nc-options-toggle').click();
    await page.getByRole('button', { name: 'plan', exact: true }).click();
    await page.locator(`${launcher} .nc-start`).click();
    await expect.poll(async () => (await mockLog()).chats.length).toBeGreaterThan(0);
    const body = (await mockLog()).chats.at(-1) as { args?: string[] };
    expect(body.args).toEqual(['--permission-mode', 'plan']);
    // starting a chat opens it; on phone that hides the list — go home
    await expect(page).toHaveURL(/#\/agent\//);
    await page.evaluate(() => (location.hash = ''));
    await page.locator('button.new-chat').first().click();
    await expect(page.locator('.nc-options-toggle')).toContainText('plan');
  });
});
