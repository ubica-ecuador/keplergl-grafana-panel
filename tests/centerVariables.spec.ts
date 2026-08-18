import { test, expect } from '@grafana/plugin-e2e';
import type { Locator, Page } from '@playwright/test';

import { emptyPoint, readKepler, settle, urlVariable } from './keplerHelpers';

/**
 * The centre mapping: the lat/lng pair read back into the viewport
 * (`source: 'center'`, zoom 13 on the provisioned cross-filter dashboard).
 *
 * What these pin, from the channel's design: editing the pair from outside
 * the map — here through the variable textboxes, the same path a table's
 * data link takes — centres the map at the mapping's zoom; and the echo of
 * the map's own click, which the coordinate mapping writes into the very
 * same pair, never re-centres.
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
  await page.waitForTimeout(3000);
  return map;
}

/**
 * Fills a textbox dashboard variable and commits it.
 *
 * The input's accessible name is its placeholder ("Enter value"), not the
 * variable's label — the label is a sibling text node — so the locator walks
 * from the exact label text to the textbox inside the same container.
 */
async function fillVariable(page: Page, label: string, value: string): Promise<void> {
  const input = page.getByText(label, { exact: true }).locator('..').getByRole('textbox');
  await input.fill(value);
  await input.press('Enter');
}

test('writing the pair from outside centres the map at the mapping zoom', async ({
  gotoDashboardPage,
  readProvisionedDashboard,
  page,
}) => {
  test.slow();
  const map = await gotoCrossFilterPanel(gotoDashboardPage, readProvisionedDashboard, page);

  // Off-data coordinates, distinct from the auto-centred viewport.
  await fillVariable(page, 'Lng', '-78.5');
  await fillVariable(page, 'Lat', '-1.25');

  await expect
    .poll(
      async () => {
        const { mapState } = await readKepler(map);
        return [+mapState.latitude.toFixed(2), +mapState.longitude.toFixed(2), Math.round(mapState.zoom)];
      },
      { timeout: 15_000 }
    )
    .toEqual([-1.25, -78.5, 13]);
});

test("the map's own click publishes the pair but never re-centres", async ({
  gotoDashboardPage,
  readProvisionedDashboard,
  page,
}) => {
  test.slow();
  const map = await gotoCrossFilterPanel(gotoDashboardPage, readProvisionedDashboard, page);

  const before = (await readKepler(map)).mapState;
  const p = await emptyPoint(map);
  await page.mouse.click(p.x, p.y);
  await settle(page);

  // The click reached the coordinate channel…
  await expect.poll(() => urlVariable(page, 'lat'), { timeout: 10_000 }).toMatch(/^-?\d+(\.\d+)?$/);

  // …and the centre mapping recognised it as the map talking to itself: give
  // the echo a beat to (not) arrive, then confirm the viewport never moved.
  await page.waitForTimeout(1500);
  const after = (await readKepler(map)).mapState;
  expect(after.latitude).toBeCloseTo(before.latitude, 6);
  expect(after.longitude).toBeCloseTo(before.longitude, 6);
  expect(after.zoom).toBeCloseTo(before.zoom, 6);
});
