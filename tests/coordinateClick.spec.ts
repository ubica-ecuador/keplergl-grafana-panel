import { test, expect } from '@grafana/plugin-e2e';
import type { Locator, Page } from '@playwright/test';

import { emptyPoint, readKepler, settle, urlVariable } from './keplerHelpers';

/**
 * The coordinate channel: a click on the map publishes the place clicked as
 * a `$lat`/`$lng` variable pair (`source: 'coordinate'` mapping).
 *
 * What these pin, from the map-click spike and the channel's design:
 * the panel switches kepler's coordinate interaction on by itself; kepler's
 * pin *toggles* — a second click unpins on the map but the variables keep the
 * last spot, so a consuming spatial query never loses its centre; and both
 * the pin and the pair survive a data refresh.
 */

async function gotoCrossFilterPanel(
  gotoDashboardPage: (args: { uid: string }) => Promise<unknown>,
  readProvisionedDashboard: (args: { fileName: string }) => Promise<{ uid: string }>,
  page: Page
): Promise<Locator> {
  const dashboard = await readProvisionedDashboard({ fileName: 'varsync.json' });
  await gotoDashboardPage(dashboard);

  const panel = page.getByTestId('data-testid Panel header Kepler.gl — cross-filter');
  const map = panel.locator('.maplibregl-map');
  await expect(map).toBeVisible({ timeout: 60_000 });
  await expect(panel.locator('.dataset-name')).toHaveText('Query A', { timeout: 60_000 });
  // Let deck finish mounting its layers; a click during setup is dropped.
  await page.waitForTimeout(3000);
  return map;
}

test('a map click publishes the clicked place as the lat/lng pair', async ({
  gotoDashboardPage,
  readProvisionedDashboard,
  page,
}) => {
  test.slow();
  const map = await gotoCrossFilterPanel(gotoDashboardPage, readProvisionedDashboard, page);

  // The panel enables kepler's coordinate interaction on its own — it ships
  // disabled, and without it a click pins nothing.
  await expect.poll(async () => (await readKepler(map)).coordEnabled, { timeout: 10_000 }).toBe(true);

  // Nothing is published before the user clicks.
  expect(urlVariable(page, 'lat')).toBe('');

  const p = await emptyPoint(map);
  await page.mouse.click(p.x, p.y);
  await settle(page);

  await expect.poll(() => urlVariable(page, 'lat'), { timeout: 10_000 }).toMatch(/^-?\d+(\.\d+)?$/);
  expect(urlVariable(page, 'lng')).toMatch(/^-?\d+(\.\d+)?$/);

  // The pair is the pinned place itself, in kepler's [lng, lat] order.
  const state = await readKepler(map);
  expect(Array.isArray(state.pinned)).toBe(true);
  const [lng, lat] = state.pinned as [number, number];
  expect(Number(urlVariable(page, 'lat'))).toBeCloseTo(lat, 4);
  expect(Number(urlVariable(page, 'lng'))).toBeCloseTo(lng, 4);
});

test('the unpin toggle and a data refresh both keep the published pair', async ({
  gotoDashboardPage,
  readProvisionedDashboard,
  page,
}) => {
  test.slow();
  const map = await gotoCrossFilterPanel(gotoDashboardPage, readProvisionedDashboard, page);
  await expect.poll(async () => (await readKepler(map)).coordEnabled, { timeout: 10_000 }).toBe(true);

  const p = await emptyPoint(map);
  await page.mouse.click(p.x, p.y);
  await expect.poll(() => urlVariable(page, 'lat'), { timeout: 10_000 }).toMatch(/^-?\d+(\.\d+)?$/);
  const published = { lat: urlVariable(page, 'lat'), lng: urlVariable(page, 'lng') };

  // Second click on the same spot: kepler unpins, the variables hold — the
  // coverage query keeps its centre until the user pins somewhere else.
  await page.mouse.click(p.x, p.y);
  await expect.poll(async () => (await readKepler(map)).pinned, { timeout: 10_000 }).toBe('null');
  expect(urlVariable(page, 'lat')).toBe(published.lat);
  expect(urlVariable(page, 'lng')).toBe(published.lng);

  // Pin again so the refresh has both a pin and a pair to preserve.
  await page.mouse.click(p.x, p.y);
  await expect.poll(async () => Array.isArray((await readKepler(map)).pinned), { timeout: 10_000 }).toBe(true);
  const repinned = { lat: urlVariable(page, 'lat'), lng: urlVariable(page, 'lng') };

  await page.getByTestId('data-testid RefreshPicker run button').click();
  // The refresh replaces the dataset rows; wait for the map to settle back.
  await page.waitForTimeout(2000);
  await settle(page);

  expect(urlVariable(page, 'lat')).toBe(repinned.lat);
  expect(urlVariable(page, 'lng')).toBe(repinned.lng);
  expect(Array.isArray((await readKepler(map)).pinned)).toBe(true);
});
