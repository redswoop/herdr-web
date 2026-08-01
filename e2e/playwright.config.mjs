import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const e2eDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(e2eDir, '..');

const MOCK_PORT = Number(process.env.MOCK_PORT || 7684);
const WEB_PORT = Number(process.env.WEB_PORT || 5174);
const MOCK_URL = `http://127.0.0.1:${MOCK_PORT}`;
const WEB_URL = `http://127.0.0.1:${WEB_PORT}`;

export default defineConfig({
  testDir: path.join(e2eDir, 'tests'),
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: path.join(e2eDir, 'playwright-report') }]],
  timeout: 30_000,
  expect: { timeout: 8_000 },
  use: {
    baseURL: WEB_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'phone',
      use: {
        ...devices['Desktop Chrome'],
        browserName: 'chromium',
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: 'wide',
      use: {
        ...devices['Desktop Chrome'],
        browserName: 'chromium',
        viewport: { width: 1280, height: 800 },
      },
    },
  ],
  webServer: [
    {
      command: 'node mock/server.mjs',
      url: `${MOCK_URL}/api/roster`,
      reuseExistingServer: !process.env.CI,
      cwd: e2eDir,
      env: { ...process.env, MOCK_PORT: String(MOCK_PORT) },
    },
    {
      command: `npm run dev -w herdr-web-ui -- --host 127.0.0.1 --port ${WEB_PORT}`,
      url: WEB_URL,
      reuseExistingServer: !process.env.CI,
      cwd: rootDir,
      env: {
        ...process.env,
        HERDR_API_PROXY: MOCK_URL,
      },
    },
  ],
});
