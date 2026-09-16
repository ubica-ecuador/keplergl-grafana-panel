import { test, expect } from '@grafana/plugin-e2e';

import { projectRows, readSymbolLayer, settle } from './keplerHelpers';

/** A full kepler map under swiftshader: see `flowfield.spec.ts` for the budget. */
test.describe.configure({ timeout: 180_000 });

test(
  'draws a symbol per station, turned by the direction column',
  async ({ gotoPanelEditPage, readProvisionedDashboard, page }) => {
    test.slow();
    const dashboard = await readProvisionedDashboard({ fileName: 'symbols.json' });
    const panelEditPage = await gotoPanelEditPage({ dashboard, id: '1' });

    const map = panelEditPage.panel.locator.locator('canvas').first();
    await expect(map).toBeVisible({ timeout: 60_000 });
    await settle(page);

    // One per station, and the layer is born already drawing: before this, a
    // scattered station query built a flow field that drew nothing.
    await expect.poll(async () => (await readSymbolLayer(map))?.symbols ?? 0, { timeout: 60_000 }).toBe(8);

    const drawn = (await readSymbolLayer(map))!;
    expect(drawn.channels.angleField).toBe('wind_direction');
    expect(drawn.channels.sizeField).toBe('wind_speed');

    // A meteorological direction says where the wind comes from, so the arrow
    // points the other way: 90° in the column is a deck angle of -270.
    expect(drawn.angles[0]).toBeCloseTo(-270, 5);
    // Eight different bearings, eight different angles: nothing collapsed.
    expect(new Set(drawn.angles.map((a) => Math.round(a))).size).toBe(8);
  }
);

test('shows the station under the pointer', async ({ gotoPanelEditPage, readProvisionedDashboard, page }) => {
  test.slow();
  const dashboard = await readProvisionedDashboard({ fileName: 'symbols.json' });
  const panelEditPage = await gotoPanelEditPage({ dashboard, id: '1' });

  const map = panelEditPage.panel.locator.locator('canvas').first();
  await expect(map).toBeVisible({ timeout: 60_000 });
  await settle(page);
  await expect.poll(async () => (await readSymbolLayer(map))?.symbols ?? 0, { timeout: 60_000 }).toBe(8);

  // The tooltip is what a row-based layer buys: the vector field cannot have
  // one, because its symbols are samples of a grid and no row of anything.
  //
  // The eight stations are scattered across Ecuador on purpose (that is the
  // fork this whole feature turns on -- see the fixture), which also means
  // hovering the map's bounding-box centre is not reliable: no station sits
  // anywhere near the centroid or the midpoint of the bounding box of eight
  // points spread across the whole country. `projectRows` (already used by
  // `clickEntity.spec.ts` to click an exact row) gives the real screen
  // position of a station instead of guessing one.
  const rows = await projectRows(map);
  expect(rows.length).toBeGreaterThan(0);
  const target = rows[0];
  await page.mouse.move(target.x, target.y);
  await page.mouse.move(target.x + 2, target.y + 2);
  await expect(page.locator('.map-popover').first()).toBeVisible({ timeout: 30_000 });
});
