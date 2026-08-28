import { test, expect } from '@grafana/plugin-e2e';
import type { Page } from '@playwright/test';

import { settle } from './keplerHelpers';

/**
 * An ArcGIS Image Service drawn as a single layer, at any zoom.
 *
 * kepler has no notion of one: its raster path addresses a *file* through a
 * tile server, and a global collection cut into 200 files needs 200 queries to
 * cover the world. A service is a mosaic dataset — catalogue, choosing rule and
 * a pyramid over the whole thing — so one endpoint answers for any extent.
 *
 * What is pinned here is the chain the panel adds: a query naming a service
 * becomes a tileset, each tile is asked for by its own bounds in Web Mercator,
 * and the mosaic rule that picks the year reaches the service on every request.
 *
 * The service is stubbed, so the suite makes no outbound call.
 */

test.use({ viewport: { width: 1600, height: 1000 } });

// Loading kepler and drawing a tile does not fit in playwright's default half minute.
test.describe.configure({ timeout: 120_000 });

/** A 1×1 transparent PNG — deck parses the body, so it has to be a real image. */
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

/** What one render request asked for. */
interface Asked {
  bbox: number[];
  bboxSR: string | null;
  imageSR: string | null;
  format: string | null;
  transparent: string | null;
  size: string | null;
  mosaicRule: string | null;
}

/** Serves the renders from the test, and records what was asked of it. */
async function stubService(page: Page): Promise<Asked[]> {
  const asked: Asked[] = [];

  await page.route(/imagery\.test\/.*\/exportImage/, (route) => {
    const params = new URL(route.request().url()).searchParams;
    asked.push({
      bbox: (params.get('bbox') ?? '').split(',').map(Number),
      bboxSR: params.get('bboxSR'),
      imageSR: params.get('imageSR'),
      format: params.get('format'),
      transparent: params.get('transparent'),
      size: params.get('size'),
      mosaicRule: params.get('mosaicRule'),
    });
    return route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL });
  });

  return asked;
}

test('asks the service to render each tile by its own bounds', async ({
  gotoDashboardPage,
  readProvisionedDashboard,
  page,
}) => {
  const asked = await stubService(page);

  const dashboard = await readProvisionedDashboard({ fileName: 'esriImage.json' });
  await gotoDashboardPage(dashboard);
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
  await settle(page);
  await expect.poll(() => asked.length, { timeout: 60_000 }).toBeGreaterThan(0);

  const one = asked[0];
  expect(one.bbox).toHaveLength(4);
  expect(one.bbox.every((value) => Number.isFinite(value))).toBe(true);
  // Metres, not degrees: a tile is a square of Web Mercator, and its extent in
  // degrees is not. Any real tile is far outside the ±180 a degree bbox lives in.
  expect(Math.abs(one.bbox[0])).toBeGreaterThan(1000);
  expect(one.bboxSR).toBe('3857');
  expect(one.imageSR).toBe('3857');
  expect(one.size).toBe('256,256');
});

test('asks for a format that carries transparency, so the sea stays clear', async ({
  gotoDashboardPage,
  readProvisionedDashboard,
  page,
}) => {
  const asked = await stubService(page);

  const dashboard = await readProvisionedDashboard({ fileName: 'esriImage.json' });
  await gotoDashboardPage(dashboard);
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => asked.length, { timeout: 60_000 }).toBeGreaterThan(0);

  // Measured against the real service: `format=png` returns nodata as opaque
  // black whatever the flag says, and only `png32` carries an alpha channel.
  expect(asked.every((one) => one.format === 'png32' && one.transparent === 'true')).toBe(true);
});

test('carries the rule that picks which rasters of the mosaic to draw', async ({
  gotoDashboardPage,
  readProvisionedDashboard,
  page,
}) => {
  const asked = await stubService(page);

  const dashboard = await readProvisionedDashboard({ fileName: 'esriImage.json' });
  await gotoDashboardPage(dashboard);
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => asked.length, { timeout: 60_000 }).toBeGreaterThan(0);

  // How the year is chosen. Without it every request would draw the service's
  // default, and the year selector would be decoration.
  expect(asked[asked.length - 1].mosaicRule).toContain('Year=2023');
});

test('lets the map’s clock choose the year, without rebuilding the layer', async ({
  gotoDashboardPage,
  readProvisionedDashboard,
  page,
}) => {
  const asked = await stubService(page);

  const dashboard = await readProvisionedDashboard({ fileName: 'esriImageTime.json' });
  await gotoDashboardPage(dashboard);
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
  await settle(page);
  await expect.poll(() => asked.length, { timeout: 60_000 }).toBeGreaterThan(0);

  // A dated query offers one moment per year, and a map opens on the newest one
  // inside the range — the same rule the raster and Zarr paths follow.
  await expect.poll(() => asked[asked.length - 1].mosaicRule, { timeout: 60_000 }).toContain('Year=2023');

  // Narrowing the dashboard range moves the map's window over a calendar that
  // does not change — the rows are a fixed frame — so nothing is rebuilt and only
  // the chosen rule differs. Driven from the range rather than by dragging the
  // widget's 3px handle, which is what the Zarr spec settled on.
  await page.goto(`${page.url().split('?')[0]}?from=2020-06-01T00:00:00.000Z&to=2022-06-01T00:00:00.000Z`);
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
  await settle(page);

  await expect.poll(() => asked[asked.length - 1].mosaicRule, { timeout: 60_000 }).toContain('Year=2022');
});
