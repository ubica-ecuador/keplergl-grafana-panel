import { test, expect, type DashboardPage } from '@grafana/plugin-e2e';
import type { Locator, Page } from '@playwright/test';

import { readKepler } from './keplerHelpers';

/**
 * Playing the time slider survives the map's own queries being answered.
 *
 * Each answer replaces the rows behind the time filter, and kepler rebuilds the
 * filter from its saved form, which has no play state: it used to come back
 * paused, whatever set the query off. The provisioned map's query reads
 * `$radius`, so both triggers are here — the variable, as a Radius box or a
 * click on another map would set it, and the dashboard's Refresh, as
 * auto-refresh does.
 */

const PLAY = '.time-range-slider .playback-control-button';

/** Opens the map, shows its time filter and presses play. */
async function playing(
  gotoDashboardPage: (args: { uid: string }) => Promise<DashboardPage>,
  readProvisionedDashboard: (args: { fileName: string }) => Promise<{ uid: string }>,
  page: Page
): Promise<{ dashboardPage: DashboardPage; panel: Locator; map: Locator }> {
  const dashboard = await readProvisionedDashboard({ fileName: 'playRefresh.json' });
  const dashboardPage = await gotoDashboardPage(dashboard);

  const panel = page.getByTestId('data-testid Panel header Kepler.gl — plays through its own refresh');
  const map = panel.locator('.maplibregl-map');
  await expect(map).toBeVisible({ timeout: 60_000 });
  // kepler's Filters tab (the tabs are layer, filter, interaction, base map).
  await panel.locator('.side-panel__tab').nth(1).click();
  const play = panel.locator(PLAY).first();
  await expect(play).toBeVisible({ timeout: 60_000 });

  await play.click();
  await expect(panel.locator(`${PLAY}.active`)).toBeVisible();
  return { dashboardPage, panel, map };
}

/** The time filter's window, as kepler holds it. */
async function timeWindow(map: Locator): Promise<unknown> {
  return (await readKepler(map)).filters.find((filter) => filter.type === 'timeRange')?.value;
}

/**
 * How many times a dataset replace has parked the map's filters so far.
 *
 * The one sure sign that an answer reached kepler: testdata answers a raw frame
 * in the browser, so there is no request to wait for. Counted from a store
 * subscription installed on the first call — observing only, since replacing
 * the store's `dispatch` makes kepler re-register and wipe the map.
 */
async function parks(map: Locator): Promise<number> {
  return map.evaluate((node) => {
    const counter = window as unknown as { __filterParks?: number };
    if (counter.__filterParks === undefined) {
      const fiberKey = Object.keys(node).find((k) => k.startsWith('__reactFiber$'));
      let fiber = fiberKey ? (node as unknown as Record<string, any>)[fiberKey] : null;
      while (fiber && typeof fiber.memoizedProps?.store?.getState !== 'function') {
        fiber = fiber.return;
      }
      if (!fiber) {
        throw new Error('kepler store not found from map node');
      }
      const store = fiber.memoizedProps.store;
      const parked = () =>
        ((Object.values(store.getState().keplerGl ?? {})[0] as any)?.visState?.filterToBeMerged?.length ?? 0) > 0;
      let wasParked = parked();
      counter.__filterParks = 0;
      store.subscribe(() => {
        const isParked = parked();
        if (isParked && !wasParked) {
          counter.__filterParks! += 1;
        }
        wasParked = isParked;
      });
    }
    return counter.__filterParks;
  });
}

/** Runs `trigger`, waits for its answer to replace the map's rows, then lets the clock run on. */
async function answered(map: Locator, trigger: () => Promise<void>): Promise<void> {
  const before = await parks(map);
  await trigger();
  await expect.poll(() => parks(map), { timeout: 15_000 }).toBeGreaterThan(before);
  await map.page().waitForTimeout(2000);
}

test('keeps playing when a variable the map reads changes', async ({
  gotoDashboardPage,
  readProvisionedDashboard,
  page,
}) => {
  test.slow();
  const { panel, map } = await playing(gotoDashboardPage, readProvisionedDashboard, page);
  const before = await timeWindow(map);

  await answered(map, async () => {
    // The input's accessible name is its placeholder, so it is found from the label.
    const radius = page.getByText('Radius', { exact: true }).locator('..').getByRole('textbox');
    await radius.fill('8');
    await radius.press('Enter');
  });

  await expect(panel.locator(`${PLAY}.active`)).toBeVisible();
  expect(await timeWindow(map)).not.toEqual(before);
});

test('keeps playing through a dashboard refresh', async ({ gotoDashboardPage, readProvisionedDashboard, page }) => {
  test.slow();
  const { dashboardPage, panel, map } = await playing(gotoDashboardPage, readProvisionedDashboard, page);
  const before = await timeWindow(map);

  await answered(map, () => dashboardPage.refreshDashboard());

  await expect(panel.locator(`${PLAY}.active`)).toBeVisible();
  expect(await timeWindow(map)).not.toEqual(before);
});
