import { test, expect, type Page } from '@playwright/test';
import { mockState, openAgent } from '../helpers/app';

// seed after openAgent's reset, then reload: the fetch carries the events, so
// nothing races the stream subscribing
async function seeded(page: Page, events: unknown[]) {
  await openAgent(page, 'w1:p1');
  await mockState({ appendEvents: { 'w1:p1': events } });
  await page.reload();
}

const send = (files: string[], extra: Record<string, unknown> = {}) => [
  {
    kind: 'tool_use',
    name: 'SendUserFile',
    id: 'suf1',
    text: '',
    input: { files, caption: 'round 1 contact sheet', status: 'normal', ...extra },
    ts: '2024-06-01T12:00:05.000Z',
  },
  { kind: 'tool_result', id: 'suf1', text: `${files.length} files delivered to user.`, ts: '2024-06-01T12:00:06.000Z' },
];

test.describe('SendUserFile', () => {
  test('renders a card with thumbnails and chips; tap opens the viewer', async ({ page }) => {
    await seeded(page, send(['/tmp/sp/contact.png', '/tmp/sp/notes.csv']));
    const card = page.locator('.sent-files');
    await expect(card).toBeVisible();
    await expect(card.locator('.sent-caption')).toHaveText('round 1 contact sheet');
    await expect(card.locator('.sent-thumb img')).toHaveCount(1);
    await expect(card.locator('.sent-chip')).toHaveText(/notes\.csv/);
    // the receipt is swallowed, not a stray activity row
    await expect(page.getByText(/files delivered to user/)).toHaveCount(0);
    await card.locator('.sent-thumb').click();
    await expect(page.locator('.file-viewer').first()).toBeVisible();
  });

  test('a wiped scratchpad file folds to a "gone" chip', async ({ page }) => {
    await seeded(page, send(['/tmp/gone/contact.png']));
    const card = page.locator('.sent-files');
    await expect(card.locator('.sent-chip.gone')).toHaveText(/contact\.png · gone/);
    await expect(card.locator('.sent-thumb')).toHaveCount(0);
  });

  test("display: 'attach' never inlines an image", async ({ page }) => {
    await seeded(page, send(['/tmp/sp/contact.png'], { display: 'attach' }));
    const card = page.locator('.sent-files');
    await expect(card.locator('.sent-chip')).toHaveText(/contact\.png/);
    await expect(card.locator('.sent-thumb')).toHaveCount(0);
  });
});
