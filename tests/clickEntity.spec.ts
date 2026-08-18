import { test, expect } from '@grafana/plugin-e2e';
import type { Locator, Page } from '@playwright/test';

import { emptyPoint, projectRows, settle, urlVariable } from './keplerHelpers';

/**
 * The entity-click channel: a mapping with `source: 'click'` publishes the
 * clicked entity's value of its column to the variable (`site` → `$site` on
 * the provisioned cross-filter dashboard).
 *
 * What these pin, from the click-sync design: an entity click publishes, the
 * empty-map deselect clears — but only a selection this panel itself
 * published, so a dashboard opened from a shared link keeps its preset value
 * through stray background clicks.
 */

async function gotoCrossFilterPanel(
  gotoDashboardPage: (args: { uid: string; queryParams?: URLSearchParams }) => Promise<unknown>,
  readProvisionedDashboard: (args: { fileName: string }) => Promise<{ uid: string }>,
  page: Page,
  queryParams?: URLSearchParams
): Promise<Locator> {
  const dashboard = await readProvisionedDashboard({ fileName: 'varsync.json' });
  await gotoDashboardPage({ ...dashboard, queryParams });

  const panel = page.getByTestId('data-testid Panel header Kepler.gl — cross-filter');
  const map = panel.locator('.maplibregl-map');
  await expect(map).toBeVisible({ timeout: 60_000 });
  await expect(panel.locator('.dataset-name')).toHaveText('Query A', { timeout: 60_000 });
  await page.waitForTimeout(3000);
  return map;
}

test('clicking a point publishes its column value, an empty click clears it', async ({
  gotoDashboardPage,
  readProvisionedDashboard,
  page,
}) => {
  test.slow();
  const map = await gotoCrossFilterPanel(gotoDashboardPage, readProvisionedDashboard, page);

  expect(urlVariable(page, 'site')).toBe('');

  const rows = await projectRows(map);
  expect(rows.length).toBeGreaterThan(0);
  const target = rows[0];
  await page.mouse.click(target.x, target.y);
  await settle(page);

  await expect.poll(() => urlVariable(page, 'site'), { timeout: 10_000 }).toBe(String(target.values.site));

  // The deliberate deselect: an empty-map click clears what this panel
  // published, keeping the SQL guard (`$site != ''`) literal on consumers.
  const empty = await emptyPoint(map);
  await page.mouse.click(empty.x, empty.y);
  await settle(page);
  await expect.poll(() => urlVariable(page, 'site'), { timeout: 10_000 }).toBe('');
});

test('a preset variable from a shared link survives stray empty clicks', async ({
  gotoDashboardPage,
  readProvisionedDashboard,
  page,
}) => {
  test.slow();
  const map = await gotoCrossFilterPanel(
    gotoDashboardPage,
    readProvisionedDashboard,
    page,
    new URLSearchParams({ 'var-site': 'site-99' })
  );

  const empty = await emptyPoint(map);
  await page.mouse.click(empty.x, empty.y);
  await settle(page);
  await page.mouse.click(empty.x, empty.y);
  await settle(page);

  // The panel never published site-99, so the deselect must not clear it.
  expect(urlVariable(page, 'site')).toBe('site-99');
});
