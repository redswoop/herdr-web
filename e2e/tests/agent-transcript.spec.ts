import { test, expect } from '@playwright/test';
import { mockLog, openAgent } from '../helpers/app';

test.describe('agent transcript', () => {
  test('renders history, tools, and assistant markdown', async ({ page }) => {
    await openAgent(page, 'w1:p1');
    await expect(page.getByText(/list the auth module files/i)).toBeVisible();
    await expect(page.getByText(/Here are the auth files/i)).toBeVisible();
    // activity group collapses tools
    await expect(page.locator('.activity, .act-count, .step-name').first()).toBeVisible();
  });

  test('send prompt shows optimistic bubble then confirmation', async ({ page }) => {
    await openAgent(page, 'w1:p1');
    const ta = page.locator('textarea').first();
    await ta.fill('hello from e2e');
    await page.getByRole('button', { name: 'send' }).click();
    await expect(page.getByText('hello from e2e')).toBeVisible();
    // mock replies
    await expect(page.getByText(/mock reply to: hello from e2e/i)).toBeVisible({ timeout: 10_000 });
    const log = await mockLog();
    expect(log.prompts.some((p: any) => p.text === 'hello from e2e')).toBeTruthy();
  });

  test('stop interrupt while working', async ({ page }) => {
    await openAgent(page, 'w1:p2');
    // agent is working — stop button should be available (no draft)
    const stop = page.getByRole('button', { name: 'stop' });
    await expect(stop).toBeVisible();
    await stop.click();
    // interrupt lands
    await expect(page.getByText(/interrupted|interrupting/i).first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test('clicking the prompt bubble body does NOT interrupt; the status line does', async ({ page }) => {
    // regression (71567d8 parity): selecting text in your own last prompt used
    // to fire the whole-bubble click handler and Ctrl-C the agent
    await openAgent(page, 'w1:p1');
    const ta = page.locator('textarea').first();
    await ta.fill('long running question [no-reply]');
    await page.getByRole('button', { name: 'send' }).click();
    const bubble = page.locator('.msg.user.cancellable').first();
    await expect(bubble).toBeVisible();

    // click the bubble body (the markdown span) — must not interrupt
    await bubble.locator('span').first().click();
    let log = await mockLog();
    expect(log.prompts.some((p: any) => p.interrupt)).toBeFalsy();

    // click the status line — this is the interrupt affordance
    await bubble.locator('.sent-status').click();
    await expect
      .poll(async () => (await mockLog()).prompts.some((p: any) => p.interrupt), { timeout: 8_000 })
      .toBeTruthy();
  });

  test('file path link opens file viewer', async ({ page }) => {
    await openAgent(page, 'w1:p1');
    // assistant text has pathish link
    const link = page.locator('a[data-file], a').filter({ hasText: /README\.md|login\.ts/ }).first();
    await expect(link).toBeVisible();
    await link.click();
    await expect(page.locator('.file-viewer, .file-bar, .file-path').first()).toBeVisible({
      timeout: 8_000,
    });
  });
});
