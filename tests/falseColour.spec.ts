import { test, expect } from '@grafana/plugin-e2e';
import type { Page } from '@playwright/test';

import { settle } from './keplerHelpers';

/**
 * The band combination a dashboard variable chooses, as tile requests.
 *
 * What is pinned here is the routing, which is the part that can silently go
 * wrong: a composite must reach the `/stac` router with its assets repeated —
 * a comma-separated list answers 404 on a real server — and true colour must
 * keep taking the `/cog` path it has always taken. The indices are verified
 * live instead: they need kepler to fetch a STAC item, and a stubbed document
 * would make the test pass for reasons the product does not depend on.
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
    const url = route.request().url();
    asked.push(url);
    if (url.includes('/cog/stac')) {
      // Enough of a STAC document for kepler to accept the scene.
      await route.fulfill({ json: stacDocument() });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL });
  });
  return asked;
}

/** The `/cog/stac` answer TiTiler gives, trimmed to what kepler reads. */
function stacDocument() {
  return {
    stac_version: '1.0.0',
    stac_extensions: [
      'https://stac-extensions.github.io/eo/v1.1.0/schema.json',
      'https://stac-extensions.github.io/raster/v1.1.0/schema.json',
    ],
    id: 'scene-visual',
    type: 'Feature',
    bbox: [-1, -1, 1, 1],
    geometry: { type: 'Polygon', coordinates: [[[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]]] },
    properties: { datetime: '2026-09-13T00:00:00Z' },
    assets: {
      data: {
        href: 'https://example.test/scene-visual.tif',
        'eo:bands': [{ name: 'b1', common_name: 'red' }, { name: 'b2', common_name: 'green' }, { name: 'b3', common_name: 'blue' }],
        'raster:bands': [{ data_type: 'uint8' }, { data_type: 'uint8' }, { data_type: 'uint8' }],
      },
    },
    links: [],
  };
}

test('a composite is composed by the server, with its assets repeated', async ({ gotoDashboardPage, page }) => {
  test.slow();
  const asked = await collectRequests(page);
  await gotoDashboardPage({ uid: 'falsecolour' });
  await page.locator('.maplibregl-map').first().waitFor({ state: 'visible', timeout: 90_000 });
  await settle(page);
  await expect.poll(() => asked.filter((url) => url.includes('/stac/tiles/')).length, { timeout: 60_000 }).toBeGreaterThan(0);

  const tile = asked.find((url) => url.includes('/stac/tiles/'))!;
  expect(tile.match(/[?&]assets=/g)).toHaveLength(3);
  expect(tile).toContain('assets=swir22');
  expect(tile).toContain(encodeURIComponent('https://example.test/items/scene-1'));
  expect(asked.some((url) => url.includes('/cog/tiles/'))).toBe(false);
});

test('true colour keeps taking the /cog path, from the composed image', async ({ gotoDashboardPage, page }) => {
  test.slow();
  const asked = await collectRequests(page);
  await gotoDashboardPage({ uid: 'falsecolour', queryParams: new URLSearchParams({ 'var-bands': 'trueColor' }) });
  await page.locator('.maplibregl-map').first().waitFor({ state: 'visible', timeout: 90_000 });
  await settle(page);
  await expect.poll(() => asked.some((url) => url.includes('/cog/stac')), { timeout: 60_000 }).toBe(true);
  expect(asked.every((url) => !url.includes('/stac/tiles/'))).toBe(true);
  expect(asked.some((url) => url.includes(encodeURIComponent('https://example.test/scene-visual.tif')))).toBe(true);
});

test('switching combination changes what is asked for', async ({ gotoDashboardPage, page }) => {
  test.slow();
  const asked = await collectRequests(page);
  await gotoDashboardPage({ uid: 'falsecolour', queryParams: new URLSearchParams({ 'var-bands': 'infrared' }) });
  await page.locator('.maplibregl-map').first().waitFor({ state: 'visible', timeout: 90_000 });
  await settle(page);
  await expect.poll(() => asked.some((url) => url.includes('assets=nir')), { timeout: 60_000 }).toBe(true);
  expect(asked.some((url) => url.includes('assets=swir22'))).toBe(false);
});
