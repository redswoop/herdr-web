import { test, expect } from '@playwright/test';
import { mockLog, openAgent, openApp } from '../helpers/app';

// Rename / close (TODO #15): sidebar + overview rows and workspace headers
// get a ⋯ menu (and right-click); the agent header's name renames in place.
// The verbs go through the browser's prompt/confirm, same wording as Capra.

test.describe('manage sessions', () => {
  test('right-click a session → rename', async ({ page }) => {
    await openApp(page);
    const rail = page.getByRole('navigation');
    await rail.getByRole('button', { name: /fix-auth/i }).first().click({ button: 'right' });
    const menu = page.getByRole('menu');
    await expect(menu).toContainText('fix-auth');
    page.once('dialog', (d) => d.accept('auth rework'));
    await menu.getByRole('menuitem', { name: 'Rename…' }).click();
    await expect(rail.getByRole('button', { name: /auth rework/i }).first()).toBeVisible();
    await expect(menu).toBeHidden();
    const { manage } = await mockLog();
    expect(manage).toEqual([{ paneId: 'w1:p1', action: 'rename', name: 'auth rework' }]);
  });

  test('close asks first; cancel keeps the session', async ({ page }) => {
    await openApp(page);
    const rail = page.getByRole('navigation');
    const row = rail.getByRole('button', { name: /fix-ui/i }).first();
    await row.click({ button: 'right' });
    // fix-ui is working — the menu says so
    const close = page.getByRole('menuitem', { name: 'Close agent (it is working)' });
    let asked = '';
    page.once('dialog', (d) => {
      asked = d.message();
      void d.dismiss();
    });
    await close.click();
    expect(asked).toMatch(/^Close fix-ui\?/);
    expect((await mockLog()).manage).toEqual([]);
    await expect(row).toBeVisible();

    await row.click({ button: 'right' });
    page.once('dialog', (d) => d.accept());
    await page.getByRole('menuitem', { name: /Close agent/ }).click();
    await expect(rail.getByRole('button', { name: /fix-ui/i })).toHaveCount(0);
    expect((await mockLog()).manage).toEqual([{ paneId: 'w1:p2', action: 'close' }]);
  });

  test('Esc closes the menu without acting', async ({ page }) => {
    await openApp(page);
    await page.getByRole('navigation').getByRole('button', { name: /fix-auth/i }).first().click({ button: 'right' });
    await expect(page.getByRole('menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toBeHidden();
    expect((await mockLog()).manage).toEqual([]);
  });

  test('workspace header ⋯ → rename space', async ({ page }) => {
    await openApp(page); // groupBy workspace
    const rail = page.getByRole('navigation');
    await rail.locator('section.group', { hasText: /fix-auth/i }).getByRole('button', { name: 'space menu' }).click();
    await expect(page.getByRole('menuitem', { name: /Close space \(2 agents\)/ })).toBeVisible();
    page.once('dialog', (d) => d.accept('app v2'));
    await page.getByRole('menuitem', { name: 'Rename space…' }).click();
    await expect(rail.getByText('app v2').first()).toBeVisible();
    expect((await mockLog()).manage).toEqual([{ workspaceId: 'w1', action: 'rename', name: 'app v2' }]);
  });

  test('header name renames in place; Esc cancels', async ({ page }) => {
    await openAgent(page, 'w1:p1');
    const view = page.locator('.view');
    await view.locator('.agent-name').click();
    const input = view.getByRole('textbox', { name: 'session name' });
    await expect(input).toBeFocused();
    await input.fill('nope');
    await input.press('Escape');
    await expect(input).toBeHidden();
    expect((await mockLog()).manage).toEqual([]);

    await view.locator('.agent-name').click();
    await view.getByRole('textbox', { name: 'session name' }).fill('auth rework');
    await page.keyboard.press('Enter');
    await expect(view.locator('.agent-name')).toHaveText('auth rework');
    expect((await mockLog()).manage).toEqual([{ paneId: 'w1:p1', action: 'rename', name: 'auth rework' }]);
  });

  test('closing the open session goes home', async ({ page }) => {
    await openAgent(page, 'w1:p1');
    const row = page.locator('.row-wrap.active .session').first();
    test.skip(!(await row.isVisible()), 'phone: the list is off-screen while a pane is open');
    await row.hover(); // desktop reveals ⋯ on hover
    await page.locator('.row-wrap.active .row-more').first().click();
    page.once('dialog', (d) => d.accept());
    await page.getByRole('menuitem', { name: 'Close agent' }).click();
    await expect(page).toHaveURL(/\/(#)?$/);
    expect((await mockLog()).manage).toEqual([{ paneId: 'w1:p1', action: 'close' }]);
  });

  test('touch: ⋯ shows on every row without hovering', async ({ page }) => {
    await openApp(page);
    test.skip(!(await page.evaluate(() => matchMedia('(hover: none)').matches)), 'pointer device');
    const more = page.getByRole('navigation').getByRole('button', { name: 'session menu' });
    await expect(more).toHaveCount(4);
    await more.first().click();
    await expect(page.getByRole('menuitem', { name: 'Rename…' })).toBeVisible();
  });
});
