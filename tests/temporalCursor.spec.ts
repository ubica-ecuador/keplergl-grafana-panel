import { test, expect } from '@grafana/plugin-e2e';
import type { Locator } from '@playwright/test';

test.use({ viewport: { width: 1600, height: 1100 } });

async function cursor(map: Locator) {
  return map.evaluate((node) => {
    const key = Object.keys(node).find((key) => key.startsWith('__reactFiber$'));
    let fiber = key ? (node as any)[key] : null;
    while (fiber) {
      const deck = fiber.stateNode?._deck;
      if (deck) {
        const overlay = deck.props.layers.find((layer: any) => layer.id.startsWith('panel-temporal-cursor-'));
        return (overlay?.props.data ?? []).map((point: any) => point.position);
      }
      fiber = fiber.return;
    }
    return null;
  });
}

test('graph hover moves Point and both Trip formats without new queries, then clears', async ({
  gotoDashboardPage,
  readProvisionedDashboard,
  page,
}) => {
  test.setTimeout(120_000);
  const dashboard = await gotoDashboardPage(await readProvisionedDashboard({ fileName: 'temporalCursor.json' }));
  const maps = ['GPS points', 'GPS trip table', 'GPS trip geojson'].map((title) =>
    dashboard.getPanelByTitle(title).locator.locator('.maplibregl-map').first()
  );
  for (const map of maps) {
    await expect(map).toBeVisible({ timeout: 60_000 });
    await expect.poll(() => cursor(map), { timeout: 60_000 }).toEqual([]);
  }
  const plot = dashboard.getPanelByTitle('Speed').locator.locator('.u-over');
  await expect(plot).toBeVisible();
  const box = (await plot.boundingBox())!;
  let queries = 0;
  page.on('request', (request) => {
    if (request.url().includes('/api/ds/query')) {
      queries++;
    }
  });
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height / 2);
  for (const map of maps) {
    await expect.poll(async () => (await cursor(map))?.length, { timeout: 30_000 }).toBeGreaterThan(0);
  }
  const before = await cursor(maps[0]);
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height / 2);
  await expect.poll(() => cursor(maps[0])).not.toEqual(before);
  const expected = await cursor(maps[0]);
  for (const map of maps.slice(1)) {
    await expect.poll(() => cursor(map)).toEqual(expected);
  }
  await page.mouse.move(box.x, box.y - 30);
  for (const map of maps) {
    await expect.poll(() => cursor(map)).toEqual([]);
  }
  expect(queries).toBe(0);
});

// Reverse-direction spike: a real pointer pick must move the Time series crosshair.
test('Point hover drives the graph and other maps, then releases the cursor without queries', async ({
  gotoDashboardPage,
  readProvisionedDashboard,
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const fixture = await readProvisionedDashboard({ fileName: 'temporalCursor.json' });
  const dashboard = await gotoDashboardPage(fixture);
  const map = dashboard.getPanelByTitle('GPS points').locator.locator('.maplibregl-map').first();
  await expect(map).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => cursor(map), { timeout: 60_000 }).toEqual([]);
  const plot = dashboard.getPanelByTitle('Speed').locator.locator('.u-over');
  const crosshair = dashboard.getPanelByTitle('Speed').locator.locator('.u-cursor-x');
  await expect(plot).toBeVisible();
  const box = (await plot.boundingBox())!;
  const { projectRows, emptyPoint } = await import('./keplerHelpers');
  await expect.poll(async () => (await projectRows(map)).length, { timeout: 60_000 }).toBeGreaterThan(2);
  const rows = await projectRows(map);
  const targets = [rows[2], rows[rows.length - 3]];
  let queries = 0;
  page.on('request', (request) => {
    if (request.url().includes('/api/ds/query')) {
      queries++;
    }
  });
  for (const target of targets) {
    await page.mouse.move(target.x, target.y);
    const time = Number(target.values.time);
    // The fixture graph spans exactly 08:00–09:10 UTC.
    const expectedX = box.x + (box.width * (time - Date.parse('2025-07-23T08:00:00Z'))) / (70 * 60 * 1000);
    await expect
      .poll(async () => Math.abs((await crosshair.evaluate((el) => el.getBoundingClientRect().left)) - expectedX), {
        timeout: 30_000,
      })
      .toBeLessThan(3);
    const follower = dashboard.getPanelByTitle('GPS trip geojson').locator.locator('.maplibregl-map').first();
    await expect.poll(() => cursor(follower)).toEqual([[target.values.longitude, target.values.latitude, 0]]);
  }
  await page.screenshot({ path: testInfo.outputPath('map-to-graph.png') });
  const empty = await emptyPoint(map, 25);
  await page.mouse.move(empty.x, empty.y);
  await expect.poll(() => cursor(map)).toEqual([]);
  await expect.poll(() => crosshair.evaluate((el) => el.getBoundingClientRect().left)).toBeLessThan(box.x);
  // Hand control back to the graph: clearing the old map pick must not erase it.
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height / 2);
  await expect.poll(async () => (await cursor(map))?.length).toBe(1);
  expect(queries).toBe(0);
});

// The map's own time bar joins the shared cursor, both ways. A round trip, so
// the test holds for either widget size: where a graph's cursor lands on the
// bar is where hovering the bar must put the graph's cursor back.
test('the time bar draws a graph’s cursor and publishes its hovered time back', async ({
  gotoDashboardPage,
  readProvisionedDashboard,
  page,
}) => {
  test.setTimeout(120_000);
  // Tall enough that the time widget at the foot of the map is on screen.
  await page.setViewportSize({ width: 1920, height: 1300 });
  const dashboard = await gotoDashboardPage(await readProvisionedDashboard({ fileName: 'gpsTruckTrack.json' }));
  const panel = dashboard.getPanelByTitle('GPS position').locator;
  const map = panel.locator('.maplibregl-map').first();
  await expect(map).toBeVisible({ timeout: 60_000 });
  const line = panel.locator('.panel-time-bar-cursor').first();
  await expect(line).toBeAttached({ timeout: 60_000 });
  const bar = line.locator('..');
  const plot = dashboard.getPanelByTitle('Speed (km/h)').locator.locator('.u-over');
  const crosshair = dashboard.getPanelByTitle('Speed (km/h)').locator.locator('.u-cursor-x');
  await expect(plot).toBeVisible();
  const plotBox = (await plot.boundingBox())!;
  let queries = 0;
  page.on('request', (request) => {
    if (request.url().includes('/api/ds/query')) {
      queries++;
    }
  });

  // Graph → bar and map.
  const graphX = plotBox.x + plotBox.width / 4;
  await page.mouse.move(graphX, plotBox.y + plotBox.height / 2);
  await expect(line).toBeVisible();
  await expect.poll(async () => (await cursor(map))?.length).toBe(1);
  const lineBox = (await line.boundingBox())!;
  const barBox = (await bar.boundingBox())!;

  // Bar → graph: hovering the bar at the line puts the graph's cursor back where it was.
  await page.mouse.move(lineBox.x + lineBox.width / 2, barBox.y + barBox.height / 2);
  await expect
    .poll(async () => Math.abs((await crosshair.evaluate((el) => el.getBoundingClientRect().left)) - graphX), {
      timeout: 30_000,
    })
    .toBeLessThan(3);
  await expect.poll(async () => (await cursor(map))?.length).toBe(1);

  // Off every panel's plot: over the map the track itself would publish its own time.
  await page.mouse.move(plotBox.x, plotBox.y - 30);
  await expect(line).toBeHidden();
  await expect.poll(() => cursor(map)).toEqual([]);
  expect(queries).toBe(0);
});
