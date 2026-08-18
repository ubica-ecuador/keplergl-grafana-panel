import { test, expect } from '@grafana/plugin-e2e';

import { readKepler } from './keplerHelpers';

/**
 * The range mapping's inbound half: a min/max variable pair applies a numeric
 * range filter on its column (`value` → `$valueMin`/`$valueMax` on the
 * provisioned cross-filter dashboard). The outbound half — the histogram
 * brush publishing the pair, debounced — is covered by the pure
 * `variableSync` unit tests; a brush drag under software WebGL is not a
 * stable e2e gesture.
 */
test('a preset min/max pair filters the map on load', async ({
  gotoDashboardPage,
  readProvisionedDashboard,
  page,
}) => {
  test.slow();
  const dashboard = await readProvisionedDashboard({ fileName: 'varsync.json' });
  await gotoDashboardPage({
    ...dashboard,
    queryParams: new URLSearchParams({ 'var-valueMin': '20', 'var-valueMax': '40' }),
  });

  const panel = page.getByTestId('data-testid Panel header Kepler.gl — cross-filter');
  const map = panel.locator('.maplibregl-map');
  await expect(map).toBeVisible({ timeout: 60_000 });
  await expect(panel.locator('.dataset-name')).toHaveText('Query A', { timeout: 60_000 });

  // The variables win on load — the same "a preset variable drives the map"
  // rule as the scalar cross-filter — so a range filter appears on `value`
  // carrying exactly the pair's window.
  await expect
    .poll(
      async () => {
        const range = (await readKepler(map)).filters.find((f) => f.type === 'range' && f.name === 'value');
        return range ? (range.value as number[]) : null;
      },
      { timeout: 20_000 }
    )
    .toEqual([20, 40]);
});
