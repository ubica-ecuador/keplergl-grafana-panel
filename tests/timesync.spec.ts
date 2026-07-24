import { test, expect } from '@grafana/plugin-e2e';

/**
 * The dashboard time range drives the map's time filter.
 *
 * With time sync on (the provisioned "time sync" panel uses it), loading the
 * dashboard must create a kepler timeRange filter bound to the data's time
 * column and set to the dashboard's window. kepler only renders a
 * `.time-range-slider` for a timeRange filter, so its presence proves the
 * dashboard range reached the map — the Grafana → map direction, end to end.
 *
 * The map → Grafana direction and the anti-echo guard are covered by the unit
 * tests around `TimeSyncGuard`; asserting them here would mean driving a WebGL
 * slider by pixel, which is too brittle to be worth it.
 */
test('drives a kepler time filter from the dashboard time range', async ({
  gotoDashboardPage,
  readProvisionedDashboard,
  page,
}) => {
  const dashboard = await readProvisionedDashboard({ fileName: 'timesync.json' });
  await gotoDashboardPage(dashboard);

  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 60_000 });

  // Open kepler's Filters tab (the tabs are layer, filter, interaction, base map).
  await page.locator('.side-panel__tab').nth(1).click();

  // The time-range slider only exists for a timeRange filter, which the panel
  // creates from the dashboard time range.
  await expect(page.locator('.time-range-slider').first()).toBeVisible({ timeout: 60_000 });
});
