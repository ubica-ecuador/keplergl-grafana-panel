import { test, expect } from '@grafana/plugin-e2e';

/**
 * Assertions run against kepler's own DOM rather than pixels — the map is WebGL
 * and screenshot comparison would be flaky across GPU/software-rendering setups.
 */

test('renders the kepler.gl map with the query results loaded', async ({
  gotoDashboardPage,
  readProvisionedDashboard,
  page,
}) => {
  const dashboard = await readProvisionedDashboard({ fileName: 'dashboard.json' });
  await gotoDashboardPage(dashboard);

  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 60_000 });

  // One dataset per query, named after its refId. The mobility query carries a
  // trip id and a time; in the default `table` trip mode the dataset keeps all
  // 80 GPS pings — one row per point, every column intact — and the Trip layer
  // does its own grouping on top. If the data had not reached kepler it would
  // show its empty-state modal instead.
  await expect(page.locator('.dataset-name')).toHaveText('Query A', { timeout: 60_000 });
  await expect(page.locator('[class*="source-data-rows"]')).toHaveText('80 rows');
  await expect(page.getByText('Drag & Drop Your File(s) Here')).toBeHidden();
});

test('offers the flow layer, which only exists in the pinned pre-release', async ({
  gotoDashboardPage,
  readProvisionedDashboard,
  page,
}) => {
  const dashboard = await readProvisionedDashboard({ fileName: 'dashboard.json' });
  await gotoDashboardPage(dashboard);
  await expect(page.locator('.dataset-name')).toHaveText('Query A', { timeout: 60_000 });

  await page.getByText('Add Layer', { exact: true }).click();
  await page.getByText('Select A Type', { exact: true }).click();

  await expect(page.locator('.layer-type-selector__item__label', { hasText: /^flow$/ })).toBeVisible();
  await expect(page.locator('.layer-type-selector__item__label', { hasText: /^trip$/ })).toBeVisible();
});

test('keeps kepler styles out of the surrounding Grafana UI', async ({
  gotoDashboardPage,
  readProvisionedDashboard,
  page,
}) => {
  const dashboard = await readProvisionedDashboard({ fileName: 'dashboard.json' });
  await gotoDashboardPage(dashboard);
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 60_000 });

  // StyleSheetManager targets a container inside the panel, so kepler's rules
  // must not accumulate in <head> where they could restyle Grafana.
  const counts = await page.evaluate(() => ({
    inPanel: document.querySelectorAll('[class*="panel-content"] style, [data-panelid] style').length,
    inHead: document.head.querySelectorAll('style').length,
  }));

  expect(counts.inPanel).toBeGreaterThan(counts.inHead);
  await expect(page.locator('body')).toHaveCSS('font-family', /Inter/);
});
