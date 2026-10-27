import { test, expect } from '@playwright/test';
import { mockState, openAgent } from '../helpers/app';

test('a ! bash line renders as an open command pill with unwrapped columns', async ({ page }) => {
  await openAgent(page, 'w1:p1');
  const table = '  ID STATUS   GPU      NAME\n   2 running  stormer  ' + 'x'.repeat(160);
  await mockState({
    appendEvents: {
      'w1:p1': [
        { kind: 'command', name: '!', text: 'upq ls', ts: '2024-06-01T12:00:05.000Z' },
        { kind: 'command_out', text: table, ts: '2024-06-01T12:00:05.000Z' },
      ],
    },
  });
  await page.reload();
  const pill = page.locator('.command-pill.bash');
  await expect(pill.locator('.cmd-name')).toHaveText('! upq ls');
  const out = pill.locator('.cmd-out');
  await expect(out).toBeVisible(); // open without a tap
  await expect(out).toHaveCSS('white-space', 'pre');
  // the long row scrolls inside the box instead of wrapping or widening the page
  expect(await out.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  await expect(page.getByText('<bash-')).toHaveCount(0);
});
