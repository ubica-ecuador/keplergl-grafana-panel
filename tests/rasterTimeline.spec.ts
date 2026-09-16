import { test, expect } from '@grafana/plugin-e2e';
import type { Page } from '@playwright/test';

import { readRasterLayer, settle } from './keplerHelpers';

/**
 * A dated catalogue of scenes drawn by kepler's own raster layer, and its style.
 *
 * `cogPainted.spec.ts` already pins a dated series on the *painted* path, where
 * the panel draws the tiles itself. This pins the other one — kepler's raster
 * layer, over a series of three passes, with a colour ramp configured in the
 * panel — because that is the combination where the map's clock and the
 * panel's own styling meet: the timeline dresses the layer once and then leaves
 * it alone, and it swaps the scene in place so the dressed layer survives.
 *
 * Both halves are asserted against real kepler rather than a mock, which is the
 * point of the fixture: the reconcile does its two jobs in one pass — put the
 * layer in step with the query, then follow the clock — and only a real store
 * can show that neither interferes with the other.
 *
 * The tile server is stubbed, so the suite makes no outbound call.
 */

test.use({ viewport: { width: 1600, height: 1000 } });
test.describe.configure({ timeout: 120_000 });

const SCENES = [
  'https://example.test/scene-2026-08-21.tif',
  'https://example.test/scene-2026-08-24.tif',
  'https://example.test/scene-2026-08-27.tif',
];

/** A 1×1 transparent PNG — deck parses the body, so it has to be a real image. */
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

/** The scene each tile request named, in order. */
async function stubTiler(page: Page): Promise<string[]> {
  const asked: string[] = [];
  await page.route('**titiler.test/**', async (route) => {
    const url = new URL(route.request().url());
    const scene = url.searchParams.get('url');
    if (url.pathname.includes('/cog/stac')) {
      // TiTiler answers about whichever COG was asked for, so the document
      // carries that scene's href — which is what the dataset then holds.
      await route.fulfill({ json: stacDocument(scene ?? '') });
      return;
    }
    if (url.pathname.includes('/cog/tiles/')) {
      asked.push(scene ?? '');
    }
    await route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL });
  });
  return asked;
}

/**
 * Moves the dashboard's time range without reloading the page.
 *
 * Grafana reads the range from the URL, and `history.pushState` plus a
 * `popstate` is what makes it notice a change from a script — the same trick
 * the panel's own variable specs use.
 */
async function moveRange(page: Page, from: string, to: string): Promise<void> {
  await page.evaluate(([f, t]) => {
    const url = new URL(location.href);
    url.searchParams.set('from', f);
    url.searchParams.set('to', t);
    history.pushState(history.state, '', url.toString());
    dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
  }, [from, to]);
}

/** The `/cog/stac` answer, trimmed to what kepler reads. */
function stacDocument(href: string) {
  return {
    stac_version: '1.0.0',
    stac_extensions: [
      'https://stac-extensions.github.io/eo/v1.1.0/schema.json',
      'https://stac-extensions.github.io/raster/v1.1.0/schema.json',
    ],
    id: href.slice(href.lastIndexOf('/') + 1),
    type: 'Feature',
    bbox: [-1, -1, 1, 1],
    geometry: { type: 'Polygon', coordinates: [[[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]]] },
    properties: { datetime: '2026-08-27T00:00:00Z' },
    assets: {
      data: {
        href,
        'eo:bands': [{ name: 'b1', common_name: 'red' }],
        'raster:bands': [{ data_type: 'uint8' }],
      },
    },
    links: [],
  };
}

test('opens on the newest pass, wearing the ramp the panel configured', async ({
  gotoDashboardPage,
  readProvisionedDashboard,
  page,
}) => {
  test.slow();
  const asked = await stubTiler(page);

  const dashboard = await readProvisionedDashboard({ fileName: 'rasterTimeline.json' });
  await gotoDashboardPage(dashboard);
  const map = page.locator('.maplibregl-map').first();
  await map.waitFor({ state: 'visible', timeout: 90_000 });
  await settle(page);

  // The dressing and the clock in one pass: the layer must end up on the
  // newest scene *and* on `greens`, not on kepler's default ramp.
  await expect.poll(() => readRasterLayer(map, 'grafana-A-raster'), { timeout: 60_000 }).toMatchObject({
    type: 'rasterTile',
    colormapId: 'greens',
    scene: SCENES[2],
  });
  expect(asked.every((scene) => scene === SCENES[2])).toBe(true);
});

test('the clock still chooses between passes, and the style survives the change', async ({
  gotoDashboardPage,
  readProvisionedDashboard,
  page,
}) => {
  test.slow();
  await stubTiler(page);

  const dashboard = await readProvisionedDashboard({ fileName: 'rasterTimeline.json' });
  await gotoDashboardPage(dashboard);
  const map = page.locator('.maplibregl-map').first();
  await map.waitFor({ state: 'visible', timeout: 90_000 });
  await settle(page);
  await expect.poll(() => readRasterLayer(map, 'grafana-A-raster'), { timeout: 60_000 }).toMatchObject({
    scene: SCENES[2],
  });
  const opened = await readRasterLayer(map, 'grafana-A-raster');

  // Narrowing the dashboard range moves the map's window over a calendar that
  // does not change. Driven from the range rather than by dragging the
  // widget's 3px handle, the way `cogPainted.spec.ts` settled it — but pushed
  // into the URL rather than navigated to, because a navigation remounts the
  // panel and a remounted layer proves nothing about a swap in place.
  await moveRange(page, '2026-08-20T00:00:00.000Z', '2026-08-22T00:00:00.000Z');
  await settle(page);

  // The oldest pass is the only one left inside the window.
  await expect.poll(() => readRasterLayer(map, 'grafana-A-raster'), { timeout: 60_000 }).toMatchObject({
    scene: SCENES[0],
    // Dressed once and left alone: the ramp survives a scene the clock chose.
    colormapId: 'greens',
    type: 'rasterTile',
  });
  // Swapped in place, not rebuilt — a rebuilt layer would come back with
  // kepler's default styling and a different id.
  expect((await readRasterLayer(map, 'grafana-A-raster'))?.id).toBe(opened?.id);
});
