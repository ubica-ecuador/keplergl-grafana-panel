import { test, expect } from '@grafana/plugin-e2e';

/**
 * A query with a trip id, a time and coordinates must render an animated Trip
 * layer, not a scatter of points.
 *
 * The pipeline (`buildTrips`) groups the pings by trip id, orders them by time
 * and emits one LineString per trip with `[lng, lat, alt, ts]` coordinates. That
 * fourth coordinate is what makes kepler create a `trip` layer — with a playback
 * timeline — rather than a plain geojson or point layer. The provisioned
 * "trips" panel feeds two trips of 40 pings each.
 */
test('renders a trip query as an animated Trip layer', async ({
  gotoPanelEditPage,
  readProvisionedDashboard,
  page,
}) => {
  const dashboard = await readProvisionedDashboard({ fileName: 'dashboard.json' });
  const panelEditPage = await gotoPanelEditPage({ dashboard, id: '1' });

  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 60_000 });

  // kepler only labels a layer `trip` once it finds timestamped LineStrings —
  // which means the grouping and the [lng, lat, alt, ts] shape both worked.
  // The panel deliberately carries a point layer alongside (table trip mode
  // keeps one row per ping), so the assertion is "a trip layer exists", not
  // "the only layer is a trip".
  await expect(panelEditPage.panel.locator.locator('.layer__title__type', { hasText: 'trip' })).toBeVisible({
    timeout: 60_000,
  });

  // The Trip layer brings a playback timeline; a static geojson layer would
  // not. The panel shows two of them — the trip animation's and the time
  // filter's — so the assertion is that a playback timeline exists at all.
  await expect(panelEditPage.panel.locator.locator('[class*="playback-controls"]').first()).toBeVisible({
    timeout: 60_000,
  });
});
