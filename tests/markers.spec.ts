import { test, expect } from '@grafana/plugin-e2e';
import type { Locator, Page } from '@playwright/test';

import { readMarkers, settle, urlVariable } from './keplerHelpers';

/**
 * The markers layer: reference points the user drags, each bound to a lat/lng
 * variable pair (`markers.json` binds Origin to `lat`/`lng` and Destination to
 * `lat2`/`lng2`).
 *
 * What these pin: a drag that starts on a marker moves the marker and not the
 * map, and writes its pair once on release; a drag that starts anywhere else
 * pans the map and writes nothing; and a pair changed from outside moves its
 * marker.
 */

async function gotoMarkers(
  gotoDashboardPage: (args: { uid: string }) => Promise<unknown>,
  readProvisionedDashboard: (args: { fileName: string }) => Promise<{ uid: string }>,
  page: Page
): Promise<Locator> {
  const dashboard = await readProvisionedDashboard({ fileName: 'markers.json' });
  await gotoDashboardPage(dashboard);
  const map = page.getByTestId('data-testid Panel header Markers').locator('.maplibregl-map');
  await expect(map).toBeVisible({ timeout: 60_000 });
  await expect.poll(async () => (await readMarkers(map)).markers.length, { timeout: 60_000 }).toBe(2);
  // Let deck finish mounting its layers; a gesture during setup is dropped.
  await page.waitForTimeout(3000);
  return map;
}

async function drag(page: Page, from: { x: number; y: number }, dx: number, dy: number): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let step = 1; step <= 10; step++) {
    await page.mouse.move(from.x + (dx * step) / 10, from.y + (dy * step) / 10);
  }
  await page.mouse.up();
  await settle(page);
}

test('dragging a marker writes its pair and leaves the map where it was', async ({
  gotoDashboardPage,
  readProvisionedDashboard,
  page,
}) => {
  test.slow();
  const map = await gotoMarkers(gotoDashboardPage, readProvisionedDashboard, page);
  expect(urlVariable(page, 'lat') ?? '-2.897').toBe('-2.897');

  const before = await readMarkers(map);
  const origin = before.markers.find((m) => m.id === 'm1')!;
  await drag(page, origin, 120, 60);

  await expect.poll(() => urlVariable(page, 'lat'), { timeout: 10_000 }).not.toBe('-2.897');
  const after = await readMarkers(map);
  const moved = after.markers.find((m) => m.id === 'm1')!;

  // Down and to the right: further east and further south.
  expect(moved.position[0]).toBeGreaterThan(origin.position[0]);
  expect(moved.position[1]).toBeLessThan(origin.position[1]);
  expect(Number(urlVariable(page, 'lat'))).toBeCloseTo(moved.position[1], 5);
  expect(Number(urlVariable(page, 'lng'))).toBeCloseTo(moved.position[0], 5);
  // Where the pointer let go, within a few pixels.
  expect(Math.hypot(moved.x - (origin.x + 120), moved.y - (origin.y + 60))).toBeLessThan(6);

  // The map did not pan under the marker, and the other marker is untouched.
  expect(after.center[0]).toBeCloseTo(before.center[0], 6);
  expect(after.center[1]).toBeCloseTo(before.center[1], 6);
  expect(urlVariable(page, 'lat2') ?? '-2.905').toBe('-2.905');
});

test('a drag that starts off the markers pans the map and writes nothing', async ({
  gotoDashboardPage,
  readProvisionedDashboard,
  page,
}) => {
  test.slow();
  const map = await gotoMarkers(gotoDashboardPage, readProvisionedDashboard, page);
  const before = await readMarkers(map);
  const box = (await map.boundingBox())!;
  // Bottom right of the map: clear of both markers, the side panel and the controls.
  await drag(page, { x: box.x + box.width * 0.75, y: box.y + box.height * 0.8 }, -150, -40);

  await expect
    .poll(async () => (await readMarkers(map)).center[0], { timeout: 10_000 })
    .not.toBeCloseTo(before.center[0], 4);
  expect(urlVariable(page, 'lat') ?? '-2.897').toBe('-2.897');
  expect(urlVariable(page, 'lng') ?? '-79.004').toBe('-79.004');
});

test('a pair changed from outside moves its marker', async ({ gotoDashboardPage, readProvisionedDashboard, page }) => {
  test.slow();
  const map = await gotoMarkers(gotoDashboardPage, readProvisionedDashboard, page);

  // Grafana names a textbox variable's input "Enter value"; its label is a sibling.
  const lat = page.getByText('Destination lat', { exact: true }).locator('xpath=..').getByRole('textbox');
  await lat.fill('-2.93');
  await lat.press('Enter');

  await expect
    .poll(async () => (await readMarkers(map)).markers.find((m) => m.id === 'm2')?.position[1], { timeout: 10_000 })
    .toBeCloseTo(-2.93, 6);
  // The longitude is kept, and the origin is untouched.
  const { markers } = await readMarkers(map);
  expect(markers.find((m) => m.id === 'm2')!.position[0]).toBeCloseTo(-78.99, 6);
  expect(markers.find((m) => m.id === 'm1')!.position).toEqual([-79.004, -2.897]);
});

test('switching the symbol in the layer panel keeps the markers drawn and draggable', async ({
  gotoDashboardPage,
  readProvisionedDashboard,
  page,
}) => {
  test.slow();
  const map = await gotoMarkers(gotoDashboardPage, readProvisionedDashboard, page);
  const panel = page.getByTestId('data-testid Panel header Markers');

  // Open the markers layer's settings.
  await panel
    .locator('.layer-panel')
    .filter({ has: page.locator('input[value="References"]') })
    .locator('.layer__enable-config')
    .first()
    .click();

  // circle → square: the handles change from a scatterplot to an icon layer,
  // which crashed deck while both used the same sublayer id.
  const symbolSelector = panel
    .locator('.item-selector')
    .filter({ hasText: /^circle$/ })
    .first();
  await symbolSelector.click();
  await page.keyboard.type('square');
  // The option list is portaled out of the panel.
  await page
    .locator('.list__item')
    .filter({ hasText: /^square$/ })
    .first()
    .click();
  await settle(page);
  await page.waitForTimeout(1500);

  await expect(page.getByText('An error in deck.gl')).toHaveCount(0);

  const origin = (await readMarkers(map)).markers.find((m) => m.id === 'm1')!;
  await drag(page, origin, 100, 50);
  await expect.poll(() => urlVariable(page, 'lat'), { timeout: 10_000 }).not.toBe('-2.897');
  await expect(page.getByText('An error in deck.gl')).toHaveCount(0);
});

test('picks a marker symbol by category, and the markers draw with it', async ({
  gotoDashboardPage,
  readProvisionedDashboard,
  page,
}) => {
  test.slow();
  const map = await gotoMarkers(gotoDashboardPage, readProvisionedDashboard, page);
  const panel = page.getByTestId('data-testid Panel header Markers');

  await panel
    .locator('.layer-panel')
    .filter({ has: page.locator('input[value="References"]') })
    .locator('.layer__enable-config')
    .first()
    .click();

  const selector = (label: string) =>
    panel
      .locator('label.side-panel-panel__label', { hasText: new RegExp(`^${label}$`) })
      .first()
      .locator('xpath=following::div[contains(@class,"item-selector__dropdown")][1]');

  // The markers draw circles, one of the shapes.
  await expect(selector('Category')).toContainText('Shapes');
  await selector('Category').click();
  // The option lists are portaled out of the panel.
  await page
    .locator('.list__item')
    .filter({ hasText: /^Emergency & health$/ })
    .first()
    .click();
  await selector('Symbol').click();
  await page.keyboard.type('fire_hydrant');
  await page
    .locator('.list__item')
    .filter({ hasText: /^temaki:fire_hydrant$/ })
    .first()
    .click();
  await settle(page);

  await expect.poll(async () => (await readMarkers(map)).symbol, { timeout: 10_000 }).toBe('temaki:fire_hydrant');
  await expect(selector('Symbol')).toContainText('temaki:fire_hydrant');
  await expect(page.getByText('An error in deck.gl')).toHaveCount(0);
  expect((await readMarkers(map)).markers).toHaveLength(2);
});
