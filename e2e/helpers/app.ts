import { type Page, expect } from '@playwright/test';

const MOCK = process.env.MOCK_URL || 'http://127.0.0.1:7684';

export async function mockReset() {
  const r = await fetch(`${MOCK}/__mock/reset`, { method: 'POST' });
  if (!r.ok) throw new Error(`mock reset failed: ${r.status}`);
}

export async function mockState(body: Record<string, unknown>) {
  const r = await fetch(`${MOCK}/__mock/state`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`mock state failed: ${r.status}`);
}

export async function mockLog() {
  const r = await fetch(`${MOCK}/__mock/log`);
  return r.json() as Promise<{
    prompts: unknown[];
    answers: unknown[];
    keys: unknown[];
    chats: unknown[];
    uploads: unknown[];
    push: unknown[];
  }>;
}

/** Open the app at home, optionally seeding localStorage before load. */
export async function openApp(
  page: Page,
  opts: {
    hash?: string;
    storage?: Record<string, string>;
    homeView?: 'list' | 'cards';
  } = {},
) {
  await mockReset();
  const storage: Record<string, string> = {
    'herdr.homeView': opts.homeView ?? 'list',
    'herdr.groupBy': 'workspace',
    ...(opts.storage ?? {}),
  };
  await page.addInitScript((entries) => {
    for (const [k, v] of Object.entries(entries)) localStorage.setItem(k, v);
  }, storage);
  const hash = opts.hash ?? '';
  await page.goto(`/${hash ? `#${hash.replace(/^#/, '')}` : ''}`);
  // wait for roster to paint (connected or agents)
  await expect(page.locator('.shell, .token-gate').first()).toBeVisible();
}

export async function openAgent(page: Page, paneId: string) {
  await openApp(page, { hash: `/agent/${encodeURIComponent(paneId)}` });
  await expect(page.locator('.view, .detail .view').first()).toBeVisible({ timeout: 10_000 });
}

export async function selectSession(page: Page, name: string | RegExp) {
  await page.getByRole('button', { name }).first().click();
}
