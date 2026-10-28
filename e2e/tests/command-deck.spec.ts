import { test, expect } from '@playwright/test';
import { mockLog, mockState, openAgent } from '../helpers/app';

test('deck lays out fixed slots from the kind manifest; unsupported verbs stay dimmed', async ({ page }) => {
  await openAgent(page, 'w1:p1');
  const keys = page.locator('.deck-key');
  await expect(keys).toHaveCount(8);
  await expect(keys.nth(3)).toHaveText('4compact');
  await expect(keys.nth(3)).toBeEnabled();
  await expect(keys.nth(6)).toBeEnabled();
  // claude's fixture manifest has no context — it keeps its slot, off
  await expect(keys.nth(7)).toBeDisabled();
});

test('no manifest, no deck (grok)', async ({ page }) => {
  await openAgent(page, 'w2:p1');
  await expect(page.locator('.bar .agent-name')).toBeVisible();
  await expect(page.locator('.deck')).toHaveCount(0);
});

test('working agent: every slot is off', async ({ page }) => {
  await openAgent(page, 'w1:p2');
  await expect(page.locator('.deck-key').first()).toBeDisabled();
});

test('Alt+4 opens compact; Enter fires it with the focus line', async ({ page }) => {
  await openAgent(page, 'w1:p1');
  // the manifest loads async — the hotkey binds once the deck is up
  await expect(page.locator('.deck-key', { hasText: 'compact' })).toBeEnabled();
  await page.keyboard.press('Alt+Digit4');
  const input = page.locator('.deck-arg input');
  await expect(input).toBeFocused();
  await input.fill('keep the auth notes');
  await input.press('Enter');
  await expect(page.locator('.deck-pop')).toHaveCount(0);
  await expect
    .poll(async () => (await mockLog()).prompts)
    .toContainEqual(expect.objectContaining({ paneId: 'w1:p1', text: '/compact keep the auth notes' }));
});

test('effort picker marks the current level and fires the pick; readout follows the transcript', async ({ page }) => {
  await openAgent(page, 'w1:p1');
  await mockState({
    appendEvents: {
      'w1:p1': [
        {
          kind: 'assistant',
          text: 'done',
          ts: '2024-06-01T12:00:09.000Z',
          model: 'claude-opus-5-5',
          effort: 'high',
          msgId: 'm9',
          usage: { out: 5, ctx: 98_038 },
        },
      ],
    },
  });
  await page.reload();
  await expect(page.locator('.bar .sub')).toContainText('opus 5.5 · high · 98k ctx');
  await page.locator('.deck-key', { hasText: 'effort' }).click();
  await expect(page.locator('.deck-pop .mode-row.current')).toContainText('high');
  await page.locator('.deck-pop .mode-row', { hasText: 'low' }).click();
  await expect
    .poll(async () => (await mockLog()).prompts)
    .toContainEqual(expect.objectContaining({ paneId: 'w1:p1', text: '/effort low' }));
});

test('model picker lists the aliases, marks the family, and fires /model <alias>', async ({ page }) => {
  await openAgent(page, 'w1:p1');
  await mockState({
    appendEvents: {
      'w1:p1': [
        { kind: 'assistant', text: 'done', ts: '2024-06-01T12:00:09.000Z', model: 'claude-opus-5-5', effort: 'high', msgId: 'm9' },
      ],
    },
  });
  await page.reload();
  await page.locator('.deck-key', { hasText: 'model' }).click();
  await expect(page.locator('.deck-pop .mode-row')).toHaveText(['fable', '❯ opus', 'sonnet', 'haiku']);
  await page.locator('.deck-pop .mode-row', { hasText: 'sonnet' }).click();
  await expect
    .poll(async () => (await mockLog()).prompts)
    .toContainEqual(expect.objectContaining({ paneId: 'w1:p1', text: '/model sonnet' }));
});
