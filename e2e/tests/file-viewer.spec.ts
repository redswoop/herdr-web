import { test, expect } from '@playwright/test';
import { openApp } from '../helpers/app';

test.describe('file viewer', () => {
  test('opens via hash route and shows markdown', async ({ page }) => {
    await openApp(page, {
      hash: `/agent/${encodeURIComponent('w1:p1')}/file/${encodeURIComponent('/home/armen/src/app/README.md')}`,
    });
    const viewer = page.locator('.file-viewer').first();
    await expect(viewer).toBeVisible({ timeout: 10_000 });
    await expect(viewer.locator('.file-path')).toHaveValue(/README/i);
    // rendered md or raw content from fixture
    await expect(viewer.locator('.file-md, .file-pre, .file-body').first()).toBeVisible();
    await viewer.getByRole('button', { name: /raw|pretty/i }).click();
  });
});
