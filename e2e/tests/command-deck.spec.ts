import { test, expect, type Page } from '@playwright/test';
import { mockLog, mockState, openAgent } from '../helpers/app';

// The header status line: model · effort · ctx · cwd, each readout the control
// that changes it (per the kind manifest), and the lifecycle verbs behind the
// status chip. Since #22 the line lives behind the details chip (model + ctx
// on the chip). Mock only — never test effort/model picks against real
// claude, it saves a default to settings.json.

// wide: the line is behind the details chip; phone: it's under the name
const wide = () => test.info().project.name === 'wide';
const details = async (page: Page) => {
  if (wide()) await page.locator('.bar .details-chip').click();
};

const turn = (extra: Record<string, unknown> = {}) => ({
  kind: 'assistant',
  text: 'done',
  ts: '2024-06-01T12:00:09.000Z',
  model: 'claude-opus-5-5',
  effort: 'high',
  msgId: 'm9',
  usage: { out: 5, ctx: 98_038 },
  ...extra,
});

test('readouts are controls where the manifest has a verb; cwd opens the browser', async ({ page }) => {
  await openAgent(page, 'w1:p1');
  await mockState({ appendEvents: { 'w1:p1': [turn()] } });
  await page.reload();
  if (wide()) await expect(page.locator('.bar .details-chip')).toHaveText('opus 5.598k');
  await details(page);
  const line = page.locator('.bar .status-line');
  await expect(line).toHaveText('opus 5.5 · high · 98k ctx · ~/src/app');
  await expect(line.locator('button.ro')).toHaveCount(4);
  await expect(page.locator('.deck')).toHaveCount(0);
  await line.locator('button.ro', { hasText: '~/src/app' }).click();
  await expect(page).toHaveURL(/\/file\/%2Fhome%2Farmen%2Fsrc%2Fapp$/);
  await expect(page.locator('.details-pop')).toHaveCount(0); // browsing closes the details
});

test('no manifest (grok): plain text, plain status chip', async ({ page }) => {
  await openAgent(page, 'w2:p1');
  await details(page);
  await expect(page.locator('.bar .status-line')).toBeVisible();
  await expect(page.locator('.bar .status-line button.ro')).toHaveCount(1); // cwd only
  await expect(page.locator('.bar button.session-chip')).toHaveCount(0);
});

test('working agent: every readout is off', async ({ page }) => {
  await openAgent(page, 'w1:p2');
  await details(page);
  await expect(page.locator('.bar .status-line button.ro').first()).toBeDisabled();
  await expect(page.locator('.bar button.session-chip')).toBeDisabled();
});

test('ctx → compact now; Enter fires it with the focus line', async ({ page }) => {
  await openAgent(page, 'w1:p1');
  await mockState({ appendEvents: { 'w1:p1': [turn()] } });
  await page.reload();
  await details(page);
  await page.locator('.bar button.ro', { hasText: 'ctx' }).click();
  await page.locator('.status-pop .mode-row', { hasText: 'compact now' }).click();
  const input = page.locator('.status-arg input');
  await expect(input).toBeFocused();
  await input.fill('keep the auth notes');
  await input.press('Enter');
  await expect(page.locator('.status-pop')).toHaveCount(0);
  await expect
    .poll(async () => (await mockLog()).prompts)
    .toContainEqual(expect.objectContaining({ paneId: 'w1:p1', text: '/compact keep the auth notes' }));
});

test('a click outside a pop (even deep in the transcript) closes it; so does Escape', async ({ page }) => {
  await openAgent(page, 'w1:p1');
  await mockState({ appendEvents: { 'w1:p1': [turn()] } });
  await page.reload();
  await details(page);
  const ctx = page.locator('.bar button.ro', { hasText: 'ctx' });
  await ctx.click();
  await expect(page.locator('.status-pop')).toBeVisible();
  // a click outside closes the nested pop and the details behind it
  await page.locator('.transcript').click({ position: { x: 20, y: 320 } });
  await expect(page.locator('.status-pop')).toHaveCount(0);
  await expect(page.locator('.details-pop')).toHaveCount(0);
  // the trigger itself toggles rather than closing-then-reopening
  await details(page);
  await ctx.click();
  await expect(page.locator('.status-pop')).toBeVisible();
  await ctx.click();
  await expect(page.locator('.status-pop')).toHaveCount(0);
  if (wide()) await expect(page.locator('.details-pop')).toBeVisible();
  await ctx.click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.status-pop')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('.details-pop')).toHaveCount(0);
  // the session chip's pop, the same way
  await page.locator('.bar button.session-chip').click();
  await expect(page.locator('.session-pop')).toBeVisible();
  await page.locator('.transcript').click({ position: { x: 20, y: 320 } });
  await expect(page.locator('.session-pop')).toHaveCount(0);
  expect((await mockLog()).prompts.some((p: { text: string }) => p.text.startsWith('/'))).toBe(false);
});

test('right-click on ctx goes straight to the compact focus line', async ({ page }) => {
  await openAgent(page, 'w1:p1');
  await mockState({ appendEvents: { 'w1:p1': [turn()] } });
  await page.reload();
  await details(page);
  await page.locator('.bar button.ro', { hasText: 'ctx' }).click({ button: 'right' });
  await expect(page.locator('.status-arg input')).toBeFocused();
});

test('ctx tints as the window fills, once /context has named the window', async ({ page }) => {
  await openAgent(page, 'w1:p1');
  await mockState({
    appendEvents: {
      'w1:p1': [
        { kind: 'command', text: '/context', ts: '2024-06-01T12:00:08.000Z' },
        { kind: 'command_out', text: 'Context Usage\n  33.5k/100k tokens (33%)\n', ts: '2024-06-01T12:00:08.500Z' },
        turn({ usage: { out: 5, ctx: 90_000 } }),
      ],
    },
  });
  await page.reload();
  if (wide()) await expect(page.locator('.bar .details-ctx.hot')).toHaveText('90k');
  await details(page);
  await expect(page.locator('.bar button.ro.hot')).toHaveText('90k ctx');
  await page.locator('.bar button.ro.hot').click();
  await expect(page.locator('.status-pop-desc')).toContainText('90k tokens of 100k');
});

test('effort picker marks the current level and fires the pick', async ({ page }) => {
  await openAgent(page, 'w1:p1');
  await mockState({ appendEvents: { 'w1:p1': [turn()] } });
  await page.reload();
  await details(page);
  await page.locator('.bar button.ro', { hasText: 'high' }).click();
  await expect(page.locator('.status-pop .mode-row.current')).toContainText('high');
  await page.locator('.status-pop .mode-row', { hasText: 'low' }).click();
  await expect
    .poll(async () => (await mockLog()).prompts)
    .toContainEqual(expect.objectContaining({ paneId: 'w1:p1', text: '/effort low' }));
});

test('model picker lists the aliases, marks the family, and fires /model <alias>', async ({ page }) => {
  await openAgent(page, 'w1:p1');
  await mockState({ appendEvents: { 'w1:p1': [turn({ usage: undefined })] } });
  await page.reload();
  await details(page);
  await page.locator('.bar button.ro', { hasText: 'opus 5.5' }).click();
  await expect(page.locator('.status-pop .mode-row')).toHaveText(['fable', '❯ opus', 'sonnet', 'haiku']);
  await page.locator('.status-pop .mode-row', { hasText: 'sonnet' }).click();
  await expect
    .poll(async () => (await mockLog()).prompts)
    .toContainEqual(expect.objectContaining({ paneId: 'w1:p1', text: '/model sonnet' }));
});

test('status chip: new · rewind · resume; new arms first (keep backs out), second tap sends /clear', async ({ page }) => {
  await openAgent(page, 'w1:p1');
  const chip = page.locator('.bar button.session-chip');
  await expect(chip).toBeEnabled();
  await chip.click();
  await expect(page.locator('.session-pop .mode-row .mode-name')).toHaveText(['new', 'rewind', 'resume']);
  await page.locator('.session-pop .mode-row', { hasText: 'new' }).click();
  const armed = page.locator('.session-pop .mode-row.armed');
  await expect(armed).toBeVisible();
  await armed.locator('.arm-keep').click();
  await expect(page.locator('.session-pop .mode-row.armed')).toHaveCount(0);
  await expect(page.locator('.session-pop')).toBeVisible();
  expect((await mockLog()).prompts.some((p: { text: string }) => p.text === '/clear')).toBe(false);
  await page.locator('.session-pop .mode-row', { hasText: 'new' }).click();
  await page.locator('.session-pop .mode-row.armed .arm-go').click();
  await expect(page.locator('.session-pop')).toHaveCount(0);
  await expect
    .poll(async () => (await mockLog()).prompts)
    .toContainEqual(expect.objectContaining({ paneId: 'w1:p1', text: '/clear' }));
});
