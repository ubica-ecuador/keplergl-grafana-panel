import { expect, test } from '@grafana/plugin-e2e';

import { readDatasetIds } from './keplerHelpers';

// Needs Chaski beside the panel: scripts/chaski-e2e-grafana.sh, then
// CHASKI_E2E=1 GRAFANA_URL=http://localhost:3011 npx playwright test tests/explorerToMap.spec.ts
test.skip(!process.env.CHASKI_E2E, 'needs the Chaski Grafana from scripts/chaski-e2e-grafana.sh');

/** Publishes on Grafana's app event bus from the page, as the explorer will. */
async function publish(page: import('@playwright/test').Page, payload: object): Promise<void> {
  await page.evaluate(async (payload) => {
    const runtime = await (window as any).System.import('@grafana/runtime');
    runtime.getAppEvents().publish({ type: 'ubica-explorer-to-map', payload });
  }, payload);
}

test('an explorer result lands on the map and survives a refresh', async ({ gotoDashboardPage, page }) => {
  const dashboard = await gotoDashboardPage({ uid: 'kepler-explorer-map' });
  const map = dashboard.getPanelByTitle('Map').locator.locator('.kepler-gl').first();
  await expect.poll(() => readDatasetIds(map), { timeout: 60_000 }).toEqual(['grafana-A']);

  await publish(page, {
    sql: 'SELECT id, ST_Point(longitude, latitude) AS geom FROM datasets.points WHERE id < 10',
    label: 'First ten',
    geometryColumn: 'geom',
    mode: 'add',
  });
  await expect.poll(() => readDatasetIds(map), { timeout: 60_000 }).toEqual(['explore-first-ten', 'grafana-A']);

  await page.getByTestId('data-testid RefreshPicker run button').click();
  await page.waitForTimeout(2_000);
  expect(await readDatasetIds(map)).toEqual(['explore-first-ten', 'grafana-A']);
});
