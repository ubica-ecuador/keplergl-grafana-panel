import { test, expect } from '@grafana/plugin-e2e';

import { readKepler } from './keplerHelpers';

/**
 * The load-window viewport guard, on its data-fit path.
 *
 * kepler's internal view-state context is seeded with the default viewport at
 * mount, and its debounced write-back races the load — which used to leave a
 * config-less map sitting on kepler's default San Francisco instead of the
 * centre-on-data frame `addDataToMap` intended. The guard re-fits the data
 * bounds whenever the map lands exactly on the default triple during the
 * load window; this pins that a config-less dashboard actually opens framed
 * on its data.
 */
test('a config-less map opens framed on its data, not on the default viewport', async ({
  gotoDashboardPage,
  readProvisionedDashboard,
  page,
}) => {
  test.slow();
  const dashboard = await readProvisionedDashboard({ fileName: 'varsync.json' });
  await gotoDashboardPage(dashboard);

  const panel = page.getByTestId('data-testid Panel header Kepler.gl — cross-filter');
  const map = panel.locator('.maplibregl-map');
  await expect(map).toBeVisible({ timeout: 60_000 });
  await expect(panel.locator('.dataset-name')).toHaveText('Query A', { timeout: 60_000 });

  // The provisioned data sits around Cuenca (-2.89, -79.01); kepler's default
  // is San Francisco (37.75, -122.35). Framed-on-data means the centre lands
  // near the data — anywhere close counts, the exact fit is kepler's business.
  await expect
    .poll(
      async () => {
        const { mapState } = await readKepler(map);
        return [Math.abs(mapState.latitude - -2.89) < 0.5, Math.abs(mapState.longitude - -79.01) < 0.5];
      },
      { timeout: 20_000 }
    )
    .toEqual([true, true]);
});
