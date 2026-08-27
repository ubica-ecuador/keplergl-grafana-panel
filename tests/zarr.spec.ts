import { test, expect } from '@grafana/plugin-e2e';
import type { Page } from '@playwright/test';

import { settle } from './keplerHelpers';

/**
 * A Zarr store is drawn as tiles, and the map's clock chooses which slice.
 *
 * kepler has no notion of a Zarr at all — its raster path is wired to STAC and
 * PMTiles — so what is pinned here is the whole chain the panel adds: a query
 * naming a store and a variable becomes a tileset, the moments it offers become
 * the map's time domain, and the label of the chosen moment reaches TiTiler as
 * its `sel` parameter.
 *
 * The tile server is stubbed, so the suite makes no outbound call and needs no
 * TiTiler running.
 */

test.use({ viewport: { width: 1600, height: 1000 } });

// Loading kepler and drawing a tile does not fit in playwright's default half minute.
test.describe.configure({ timeout: 120_000 });

const LABELS = [
  '2026-08-23T09:00:00.000000000',
  '2026-08-24T09:00:00.000000000',
  '2026-08-25T09:00:00.000000000',
];

/** A 1×1 transparent PNG — deck parses the body, so it has to be a real image. */
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

/** What one tile request asked for. */
interface Asked {
  z: string;
  group: string | null;
  sels: string[];
  sel: string | null;
  variable: string | null;
  url: string | null;
  rescale: string | null;
  colormap: string | null;
}

/** Serves the tiles from the test, and records what was asked of it. */
async function stubTiler(page: Page, status = 200): Promise<Asked[]> {
  const asked: Asked[] = [];

  await page.route(/titiler\.test\/zarr\/tiles\//, (route) => {
    const url = new URL(route.request().url());
    const params = url.searchParams;
    asked.push({
      z: url.pathname.split('/')[4],
      group: params.get('group'),
      sels: params.getAll('sel'),
      sel: params.get('sel'),
      variable: params.get('variable'),
      url: params.get('url'),
      rescale: params.get('rescale'),
      colormap: params.get('colormap_name'),
    });
    return status === 200
      ? route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL })
      : route.fulfill({ status, contentType: 'application/json', body: '{"detail":"nope"}' });
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

test('asks for the newest moment the query offered, by the store’s own label', async ({
  gotoDashboardPage,
  readProvisionedDashboard,
  page,
}) => {
  const asked = await stubTiler(page);

  const dashboard = await readProvisionedDashboard({ fileName: 'zarr.json' });
  await gotoDashboardPage(dashboard);
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
  await settle(page);
  await expect.poll(() => asked.length, { timeout: 60_000 }).toBeGreaterThan(0);

  // The label is the query's, not a rendering of the timestamp beside it: the
  // rows are stamped at midnight and the store answers to 09:00. TiTiler
  // compares literally and offers no nearest-neighbour fallback, so getting
  // this wrong is a 500 on every tile.
  expect(asked[asked.length - 1].sel).toBe(`time=${LABELS[2]}`);
});

test('carries the store, the variable and the panel’s colouring', async ({
  gotoDashboardPage,
  readProvisionedDashboard,
  page,
}) => {
  const asked = await stubTiler(page);

  const dashboard = await readProvisionedDashboard({ fileName: 'zarr.json' });
  await gotoDashboardPage(dashboard);
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => asked.length, { timeout: 60_000 }).toBeGreaterThan(0);

  expect(asked[0]).toMatchObject({
    url: 'https://example.test/gpcp.zarr',
    variable: 'precip',
    rescale: '0,30',
    colormap: 'blues',
  });
});

test('asks for a different moment when the clock moves, without rebuilding', async ({
  gotoDashboardPage,
  readProvisionedDashboard,
  page,
}) => {
  const asked = await stubTiler(page);

  const dashboard = await readProvisionedDashboard({ fileName: 'zarr.json' });
  await gotoDashboardPage(dashboard);
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => asked.length, { timeout: 60_000 }).toBeGreaterThan(0);
  await quiet(page, asked);
  expect(asked[asked.length - 1].sel).toBe(`time=${LABELS[2]}`);

  // Narrowing the dashboard range moves the map's window over a calendar that
  // does not change — the rows are a fixed frame — so nothing is rebuilt and
  // only the chosen moment differs.
  //
  // This is the guard for the trap PMTiles set in this repo: deck serves
  // cached tiles unless a trigger it watches changes, so a layer whose url
  // moved on but whose `updateTriggers` did not keeps painting the first date
  // for ever, and the only tell is requests that are never tiles.
  await page.goto(
    `${page.url().split('?')[0]}?from=2026-08-22T00:00:00.000Z&to=2026-08-23T12:00:00.000Z`
  );
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
  await settle(page);

  await expect
    .poll(() => asked[asked.length - 1].sel, { timeout: 60_000 })
    .toBe(`time=${LABELS[0]}`);
});

test('survives a tile server that answers with an error', async ({
  gotoDashboardPage,
  readProvisionedDashboard,
  page,
}) => {
  const asked = await stubTiler(page, 500);
  const crashes: string[] = [];
  page.on('pageerror', (e) => crashes.push(e.message));

  const dashboard = await readProvisionedDashboard({ fileName: 'zarr.json' });
  await gotoDashboardPage(dashboard);
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => asked.length, { timeout: 60_000 }).toBeGreaterThan(0);
  await settle(page);

  // A label the store does not hold answers 500, and a tile that failed arrives
  // as null. The map has to keep standing: throwing there takes the whole
  // panel down, and a dashboard is not a place to lose the other layers over
  // one bad raster.
  await expect(page.locator('canvas').first()).toBeVisible();
  expect(crashes).toEqual([]);
});

test('asks each zoom for its own pyramid level, and stops at the deepest', async ({
  gotoDashboardPage,
  readProvisionedDashboard,
  page,
}) => {
  const asked = await stubTiler(page);

  const dashboard = await readProvisionedDashboard({ fileName: 'zarrPyramid.json' });
  await gotoDashboardPage(dashboard);
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
  await settle(page);
  await expect.poll(() => asked.length, { timeout: 60_000 }).toBeGreaterThan(0);
  await quiet(page, asked);

  // `titiler.xarray` does not read the `multiscales` convention, so the level
  // is the panel's to choose: the template carries `group={z}` and deck
  // substitutes the zoom into the query string, not only into the path.
  for (const tile of asked) {
    expect(tile.group).toBe(tile.z);
  }

  // The pyramid has six levels, so nothing may be asked beyond group 5 — a
  // group the store does not hold is a 500 on every tile, for ever.
  expect(Math.max(...asked.map((tile) => Number(tile.group)))).toBeLessThanOrEqual(5);

  // Both non-spatial axes travel, each as its own `sel`: the band the query
  // pinned, and the month the clock chose. The store holds its temporal axis as
  // integers under a dimension called `month`, not as dates — so the clock
  // walks an axis whose name and labels the query had to supply.
  expect(asked[asked.length - 1].sels).toEqual(['band=tavg', 'month=3']);
});

test('walks a temporal axis that is neither called time nor spelled as dates', async ({
  gotoDashboardPage,
  readProvisionedDashboard,
  page,
}) => {
  const asked = await stubTiler(page);

  const dashboard = await readProvisionedDashboard({ fileName: 'zarrPyramid.json' });
  await gotoDashboardPage(dashboard);
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
  await settle(page);
  await expect.poll(() => asked.length, { timeout: 60_000 }).toBeGreaterThan(0);
  await quiet(page, asked);
  expect(asked[asked.length - 1].sels).toContain('month=3');

  // Narrowing the range moves the clock to an earlier month. Nothing about the
  // request is a date: the store answers to `1`, and a timestamp sent there
  // would be a 500 on every tile.
  await page.goto(
    `${page.url().split('?')[0]}?from=2019-12-15T00:00:00.000Z&to=2020-01-15T00:00:00.000Z`
  );
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
  await settle(page);

  await expect
    .poll(() => asked[asked.length - 1].sels.join('&'), { timeout: 60_000 })
    .toBe('band=tavg&month=1');
});
