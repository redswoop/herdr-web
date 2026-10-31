import { test, expect } from '@playwright/test';
import { openAgent } from '../helpers/app';

// TODO #21: the HERD mark in the sidebar header is the way back to the
// overview once a chat is open (the phone's back button takes the same path).
test('the HERD mark goes back to the overview', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'wide', 'phone: the sidebar is off-screen while a pane is open');
  await openAgent(page, 'w1:p1');
  await expect(page.locator('.detail .overview')).toHaveCount(0);
  await page.getByRole('navigation').getByRole('button', { name: 'overview', exact: true }).click();
  await expect(page).toHaveURL(/\/#?$/);
  await expect(page.locator('.detail .overview')).toBeVisible();
  await expect(page.locator('.detail .view')).toHaveCount(0);
});
