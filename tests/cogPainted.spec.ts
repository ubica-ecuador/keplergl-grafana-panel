import { test, expect } from '@grafana/plugin-e2e';
import type { Page } from '@playwright/test';

import { settle } from './keplerHelpers';

/**
 * A COG drawn by the tile server rather than by the browser.
 *
 * kepler's own raster layer asks for `.npy` and colours the pixels in a shader,
 * which is right for imagery and cannot draw a *classified* raster at all: with
 * nine classes numbered 1-11 the shader rescales them over the whole `uint8`
 * range and every class lands on one colour, so the map draws a flat slab.
 * What is pinned here is the path that avoids it end to end — the panel option
 * turns a `raster_url` query into a tileset whose requests are `.png` on the
 * `/cog` router, and the map's clock moves between scenes without a rebuild.
 *
 * The tile server is stubbed, so the suite makes no outbound call and needs no
 * TiTiler running.
 */

test.use({ viewport: { width: 1600, height: 1000 } });

// Loading kepler and drawing a tile does not fit in playwright's default half minute.
test.describe.configure({ timeout: 120_000 });

const SCENES = ['https://example.test/lulc-2022.tif', 'https://example.test/lulc-2023.tif'];

/** A 1×1 transparent PNG — deck parses the body, so it has to be a real image. */
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

/** What one tile request asked for. */
interface Asked {
  extension: string;
  url: string | null;
}

/** Serves the tiles from the test, and records what was asked of it. */
async function stubTiler(page: Page): Promise<Asked[]> {
  const asked: Asked[] = [];

  await page.route(/titiler\.test\/cog\/tiles\//, (route) => {
    const url = new URL(route.request().url());
    asked.push({
      extension: url.pathname.slice(url.pathname.lastIndexOf('.')),
      url: url.searchParams.get('url'),
    });
    return route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL });
  });

  return asked;
}

/**
 * Waits until the tile server has been left alone for a moment.
 *
 * Counting requests only means something once a load has stopped asking, and
 * "stopped" is not an event anyone emits — deck refines a tile pyramid over
 * several rounds. Two quiet seconds is the cheapest honest definition.
 */
async function quiet(page: Page, asked: Asked[]): Promise<number> {
  let seen = -1;
  while (seen !== asked.length) {
    seen = asked.length;
    await page.waitForTimeout(2000);
  }
  return asked.length;
}

test('asks the server for a finished picture, never for raw values', async ({
  gotoDashboardPage,
  readProvisionedDashboard,
  page,
}) => {
  const asked = await stubTiler(page);
  // Anything reaching the `.npy` route would mean the stock raster layer took
  // the query — the exact failure this path exists to avoid.
  const raw: string[] = [];
  await page.route(/titiler\.test\/cog\/tiles\/.*\.npy/, (route) => {
    raw.push(route.request().url());
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });

  const dashboard = await readProvisionedDashboard({ fileName: 'cogPainted.json' });
  await gotoDashboardPage(dashboard);
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
  await settle(page);
  await expect.poll(() => asked.length, { timeout: 60_000 }).toBeGreaterThan(0);

  expect(asked.every((one) => one.extension === '.png')).toBe(true);
  expect(raw).toHaveLength(0);
});

test('carries the image the query named, whole', async ({ gotoDashboardPage, readProvisionedDashboard, page }) => {
  const asked = await stubTiler(page);

  const dashboard = await readProvisionedDashboard({ fileName: 'cogPainted.json' });
  await gotoDashboardPage(dashboard);
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => asked.length, { timeout: 60_000 }).toBeGreaterThan(0);

  // The newest scene is the one a map opens on, the same rule the COG and Zarr
  // paths follow.
  expect(asked[asked.length - 1].url).toBe(SCENES[1]);
});

test('draws the other scene when the clock moves, without rebuilding the layer', async ({
  gotoDashboardPage,
  readProvisionedDashboard,
  page,
}) => {
  const asked = await stubTiler(page);

  const dashboard = await readProvisionedDashboard({ fileName: 'cogPainted.json' });
  await gotoDashboardPage(dashboard);
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
  await settle(page);
  await expect.poll(() => asked.length, { timeout: 60_000 }).toBeGreaterThan(0);
  await quiet(page, asked);

  // Narrowing the dashboard range moves the map's window over a calendar that
  // does not change — the rows are a fixed frame — so nothing is rebuilt and
  // only the chosen scene differs. Driven from the range rather than by
  // dragging the widget's 3px handle, which is what the Zarr spec settled on.
  //
  // This is the guard for the trap PMTiles set in this repo: deck serves cached
  // tiles unless a trigger it watches changes, so a layer whose url moved on but
  // whose `updateTriggers` did not keeps painting the first scene for ever, and
  // the only tell is requests that are never tiles.
  await page.goto(`${page.url().split('?')[0]}?from=2026-08-22T00:00:00.000Z&to=2026-08-23T12:00:00.000Z`);
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
  await settle(page);

  await expect.poll(() => asked[asked.length - 1].url, { timeout: 60_000 }).toBe(SCENES[0]);
});
