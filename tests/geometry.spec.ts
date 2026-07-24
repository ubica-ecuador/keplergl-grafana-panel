import { test, expect } from '@grafana/plugin-e2e';

/**
 * Raw WKB/EWKB hex must render.
 *
 * This is the path that end-to-end testing proved kepler cannot handle on its
 * own — it renders GeoJSON and WKT, not WKB — so the plugin decodes WKB to
 * GeoJSON. The provisioned "EWKB geometry" panel feeds a `geom` column of raw
 * EWKB hex points (as `SELECT geom` returns straight from PostGIS).
 */
test('renders a raw EWKB hex geometry column', async ({
  gotoPanelEditPage,
  readProvisionedDashboard,
  page,
}) => {
  const dashboard = await readProvisionedDashboard({ fileName: 'dashboard.json' });
  const panelEditPage = await gotoPanelEditPage({ dashboard, id: '2' });

  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 60_000 });

  // kepler creates a geojson layer only once it has parseable geometry — which
  // for WKB means the plugin's decode worked. A blank map leaves no such layer.
  await expect(panelEditPage.panel.locator.locator('.layer__title__type')).toHaveText('geojson', {
    timeout: 60_000,
  });
});
