import { test, expect } from '@grafana/plugin-e2e';
import type { Page } from '@playwright/test';

import { readRasterLayer, settle } from './keplerHelpers';

/**
 * A band combination on a map whose layer was saved before the dropdown existed.
 *
 * `falseColour.spec.ts` pins the routing on a panel kepler builds from scratch,
 * which is the easy half. This pins the half that actually failed on a real
 * dashboard: the layer already exists, saved into the panel's map config, and
 * kepler binds it to whatever dataset carries its `dataId` without ever asking
 * whether that layer can draw it (`validateLayerWithData` checks the type is
 * registered and the columns exist, and nothing else). A composite then keeps a
 * `rasterTile` layer that has no STAC document to fetch and requests nothing at
 * all — a blank map, no error — and an index keeps the saved `trueColor`
 * preset, so the right tiles arrive and the wrong picture is drawn.
 *
 * The scene query here returns a single row with **no time column**, like the
 * live one: the dressing that applies a preset used to sit behind a check for
 * dated scenes, which is the second half of the same failure.
 *
 * The tile server is stubbed, so the suite makes no outbound call.
 */

test.use({ viewport: { width: 1600, height: 1000 } });
test.describe.configure({ timeout: 120_000 });

const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

/** Every path the map asked the tile server for, in order. */
async function collectRequests(page: Page): Promise<string[]> {
  const asked: string[] = [];
  await page.route('**titiler.test/**', async (route) => {
    asked.push(route.request().url());
    await route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL });
  });
  // The STAC item an index is drawn from. Stubbed so the suite stays offline;
  // what is asserted about the index is what the panel dispatched, not what
  // the item says.
  await page.route('**example.test/items/**', async (route) => {
    asked.push(route.request().url());
    await route.fulfill({ json: stacItem() });
  });
  return asked;
}

/** A Sentinel-like STAC item, trimmed to the assets an index names. */
function stacItem() {
  const band = (name: string) => ({
    href: `https://example.test/${name}.tif`,
    'eo:bands': [{ name, common_name: name }],
    'raster:bands': [{ data_type: 'uint16' }],
  });
  return {
    stac_version: '1.0.0',
    stac_extensions: [
      'https://stac-extensions.github.io/eo/v1.1.0/schema.json',
      'https://stac-extensions.github.io/raster/v1.1.0/schema.json',
    ],
    id: 'scene-1',
    type: 'Feature',
    bbox: [-1, -1, 1, 1],
    geometry: { type: 'Polygon', coordinates: [[[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]]] },
    properties: { datetime: '2026-09-13T00:00:00Z' },
    assets: { nir: band('nir'), swir22: band('swir22'), swir16: band('swir16'), red: band('red'), green: band('green') },
    links: [],
  };
}

test('a composite retypes the saved layer, so the server is asked to paint it', async ({
  gotoDashboardPage,
  page,
}) => {
  test.slow();
  const asked = await collectRequests(page);
  await gotoDashboardPage({ uid: 'savedrasterlayer' });
  const map = page.locator('.maplibregl-map').first();
  await map.waitFor({ state: 'visible', timeout: 90_000 });
  await settle(page);

  await expect
    .poll(() => asked.filter((url) => url.includes('/stac/tiles/')).length, { timeout: 60_000 })
    .toBeGreaterThan(0);
  // The layer kepler kept is the panel's own, not the saved `rasterTile` one.
  expect(await readRasterLayer(map, 'grafana-A-raster')).toMatchObject({
    type: 'cogPainted',
    datasetType: 'cogPainted',
  });
});

test('an index dresses the saved layer, on a series with no dates at all', async ({ gotoDashboardPage, page }) => {
  test.slow();
  await collectRequests(page);
  await gotoDashboardPage({ uid: 'savedrasterlayer', queryParams: new URLSearchParams({ 'var-bands': 'nbr' }) });
  const map = page.locator('.maplibregl-map').first();
  await map.waitFor({ state: 'visible', timeout: 90_000 });
  await settle(page);

  // The saved config says `trueColor`/`cfastie`; the combination says NBR.
  await expect.poll(() => readRasterLayer(map, 'grafana-A-raster'), { timeout: 60_000 }).toMatchObject({
    type: 'rasterTile',
    preset: 'nbr',
    colormapId: 'rdylgn',
  });
});
