import { test, expect } from '@grafana/plugin-e2e';

import { settle, urlVariable } from './keplerHelpers';

/**
 * The viewport channel: the bbox of what the map is showing, published to
 * four dashboard variables so another panel can filter to the view.
 *
 * What these pin: the load publish — a consuming panel must not open without
 * a bbox — and that a gesture moves the four edges, once the map rests.
 */
test('publishes the bbox on load and moves it when the map is panned', async ({
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

  // The load publish: all four edges carry a number before anyone touches
  // the map, so a consumer's BETWEEN has bounds from the first render.
  const numeric = /^-?\d+(\.\d+)?$/;
  for (const edge of ['west', 'south', 'east', 'north']) {
    await expect.poll(() => urlVariable(page, edge), { timeout: 30_000 }).toMatch(numeric);
  }

  const before = {
    west: Number(urlVariable(page, 'west')),
    south: Number(urlVariable(page, 'south')),
    east: Number(urlVariable(page, 'east')),
    north: Number(urlVariable(page, 'north')),
  };
  // A sane bbox: west of east, south of north, and inside the world.
  expect(before.west).toBeLessThan(before.east);
  expect(before.south).toBeLessThan(before.north);
  expect(before.west).toBeGreaterThanOrEqual(-180);
  expect(before.north).toBeLessThanOrEqual(90);

  // Drag the map: the edges follow once the gesture rests.
  const box = await map.boundingBox();
  if (!box) {
    throw new Error('map has no bounding box');
  }
  const from = { x: box.x + box.width * 0.7, y: box.y + box.height * 0.6 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x - 160, from.y, { steps: 12 });
  await page.mouse.up();
  await settle(page);

  await expect
    .poll(() => Number(urlVariable(page, 'west')), { timeout: 15_000 })
    .not.toBeCloseTo(before.west, 4);

  const after = {
    west: Number(urlVariable(page, 'west')),
    east: Number(urlVariable(page, 'east')),
    south: Number(urlVariable(page, 'south')),
    north: Number(urlVariable(page, 'north')),
  };
  // Dragging the map leftwards moves the view east; the span is unchanged
  // because the zoom did not, which is what makes this a pan and not a zoom.
  expect(after.west).toBeGreaterThan(before.west);
  expect(after.east).toBeGreaterThan(before.east);
  expect(after.east - after.west).toBeCloseTo(before.east - before.west, 3);
  expect(after.north - after.south).toBeCloseTo(before.north - before.south, 3);
});
