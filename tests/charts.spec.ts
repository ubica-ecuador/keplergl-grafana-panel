import { test, expect } from '@grafana/plugin-e2e';
import type { Locator, Page } from '@playwright/test';

import { projectRows, settle } from './keplerHelpers';

/**
 * kepler's charts panel, as this panel wires it: the button and the pinned
 * chart, the tooltip chart on hover, compare mode with its Select, a refresh,
 * and Save. The fixture (`charts.json`) holds three sites with six hourly rows
 * each, a tooltip time series keyed on `site`, and a pinned line chart.
 *
 * Every assertion about a popup is preceded by proof that the pointer reached
 * kepler (`hoverInfo` or `clicked`): a hover deck never picked looks exactly
 * like a feature that does nothing — see `deck-clicks-swiftshader`.
 */

interface ChartState {
  charts: string[];
  hovered: boolean;
}

async function readCharts(map: Locator): Promise<ChartState> {
  return map.evaluate((node) => {
    const fiberKey = Object.keys(node).find((k) => k.startsWith('__reactFiber$'));
    let fiber = fiberKey ? (node as unknown as Record<string, any>)[fiberKey] : null;
    while (fiber) {
      const store = fiber.memoizedProps && fiber.memoizedProps.store;
      if (store && typeof store.getState === 'function') {
        const visState = (Object.values(store.getState().keplerGl ?? {})[0] as any)?.visState;
        return {
          charts: (visState?.charts ?? []).map((c: { id: string }) => c.id).sort(),
          hovered: Boolean(visState?.hoverInfo?.picked),
        };
      }
      fiber = fiber.return;
    }
    throw new Error('kepler store not found from map node');
  });
}

/** Remembers the dataset object, so a later call can tell a refresh replaced it. */
async function markDataset(map: Locator): Promise<void> {
  await map.evaluate((node) => {
    const fiberKey = Object.keys(node).find((k) => k.startsWith('__reactFiber$'));
    let fiber = fiberKey ? (node as unknown as Record<string, any>)[fiberKey] : null;
    while (fiber) {
      const store = fiber.memoizedProps && fiber.memoizedProps.store;
      if (store && typeof store.getState === 'function') {
        const visState = (Object.values(store.getState().keplerGl ?? {})[0] as any)?.visState;
        (window as any).__chartsSpecDataset = visState?.datasets?.['grafana-A'];
        return;
      }
      fiber = fiber.return;
    }
  });
}

async function datasetReplaced(map: Locator): Promise<boolean> {
  return map.evaluate((node) => {
    const fiberKey = Object.keys(node).find((k) => k.startsWith('__reactFiber$'));
    let fiber = fiberKey ? (node as unknown as Record<string, any>)[fiberKey] : null;
    while (fiber) {
      const store = fiber.memoizedProps && fiber.memoizedProps.store;
      if (store && typeof store.getState === 'function') {
        const visState = (Object.values(store.getState().keplerGl ?? {})[0] as any)?.visState;
        const now = visState?.datasets?.['grafana-A'];
        return Boolean(now) && now !== (window as any).__chartsSpecDataset;
      }
      fiber = fiber.return;
    }
    return false;
  });
}

const PANEL = 'data-testid Panel header Kepler.gl — tooltip charts';

async function gotoChartsPanel(
  gotoDashboardPage: (args: { uid: string }) => Promise<unknown>,
  readProvisionedDashboard: (args: { fileName: string }) => Promise<{ uid: string }>,
  page: Page
): Promise<Locator> {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const dashboard = await readProvisionedDashboard({ fileName: 'charts.json' });
  await gotoDashboardPage(dashboard);
  const map = page.getByTestId(PANEL).locator('.maplibregl-map');
  await expect(map).toBeVisible({ timeout: 60_000 });
  await expect.poll(async () => (await readCharts(map)).charts, { timeout: 60_000 }).toEqual(['curvas', 'serie']);
  await settle(page);
  return map;
}

/** One screen point per site, from the rows kepler draws. */
async function sitePoints(map: Locator): Promise<Record<string, { x: number; y: number }>> {
  const points: Record<string, { x: number; y: number }> = {};
  for (const row of await projectRows(map)) {
    const site = String(row.values.site);
    points[site] ??= { x: row.x, y: row.y };
  }
  return points;
}

async function hover(page: Page, map: Locator, point: { x: number; y: number }): Promise<void> {
  await page.mouse.move(point.x + 3, point.y);
  await page.mouse.move(point.x, point.y);
  await expect.poll(async () => (await readCharts(map)).hovered, { timeout: 10_000 }).toBe(true);
}

/** Reads `interactionConfig.tooltip.config.compareMode` straight off the store. */
async function tooltipCompareMode(map: Locator): Promise<boolean> {
  return map.evaluate((node) => {
    const fiberKey = Object.keys(node).find((k) => k.startsWith('__reactFiber$'));
    let fiber = fiberKey ? (node as unknown as Record<string, any>)[fiberKey] : null;
    while (fiber) {
      const store = fiber.memoizedProps && fiber.memoizedProps.store;
      if (store && typeof store.getState === 'function') {
        const visState = (Object.values(store.getState().keplerGl ?? {})[0] as any)?.visState;
        return Boolean(visState?.interactionConfig?.tooltip?.config?.compareMode);
      }
      fiber = fiber.return;
    }
    throw new Error('kepler store not found from map node');
  });
}

test('the pinned chart is on the map, and the charts button opens the panel with both', async ({
  gotoDashboardPage,
  readProvisionedDashboard,
  page,
}) => {
  test.slow();
  await gotoChartsPanel(gotoDashboardPage, readProvisionedDashboard, page);
  const panel = page.getByTestId(PANEL);

  // Pinned: drawn with the panel closed, and read-only, with no header to add charts from.
  await expect(panel.locator('.chart-manager')).toBeVisible();
  await expect(panel.getByText('Sum over sites')).toBeVisible();
  await expect(panel.locator('.chart-panel-header')).toHaveCount(0);

  await panel.locator('button.toggle-chart-panel').click();
  await expect(panel.locator('.chart-panel-header')).toBeVisible();
  // Open, each chart's title is an editable input (readOnly turns off), not
  // plain text: getByText would not see it. Match the control's value.
  await expect(panel.locator('input[value="Site series"]')).toBeVisible();
});

test('hovering a site draws its whole series in the popup', async ({
  gotoDashboardPage,
  readProvisionedDashboard,
  page,
}) => {
  test.slow();
  const map = await gotoChartsPanel(gotoDashboardPage, readProvisionedDashboard, page);
  const { north } = await sitePoints(map);
  expect(north).toBeDefined();

  await hover(page, map, north);

  const chart = page.locator('.map-popover__layer-chart');
  await expect(chart).toHaveCount(1, { timeout: 10_000 });
  await expect(chart).toContainText('Site series');
  await expect(chart.locator('svg').first()).toBeVisible();
});

test('compare mode: pinned and hovered sites each draw their series, and only the pinned popup offers Select', async ({
  gotoDashboardPage,
  readProvisionedDashboard,
  page,
}) => {
  test.slow();
  const map = await gotoChartsPanel(gotoDashboardPage, readProvisionedDashboard, page);
  const { north, south } = await sitePoints(map);

  // The fixture's `interactionConfig.tooltip.compareMode: true` — this is the
  // product fix under test, not test setup: see `savedTooltipCompare` and
  // `loadDatasets` in `keplerAdapter.ts`.
  expect(await tooltipCompareMode(map)).toBe(true);

  await page.mouse.click(north.x, north.y);
  await settle(page);
  // The button exists only while kepler holds a clicked entity: proof the click landed.
  await expect(page.locator('.panel-select-entity')).toHaveCount(1, { timeout: 10_000 });

  await hover(page, map, south);

  await expect(page.locator('.map-popover__layer-chart')).toHaveCount(2, { timeout: 10_000 });
  await expect(page.locator('.panel-select-entity')).toHaveCount(1);
});

test('the charts come back after a refresh, the tooltip chart included', async ({
  gotoDashboardPage,
  readProvisionedDashboard,
  page,
}) => {
  test.slow();
  const map = await gotoChartsPanel(gotoDashboardPage, readProvisionedDashboard, page);
  await markDataset(map);

  await page.getByTestId('data-testid RefreshPicker run button').click();
  // Proof the refresh landed: kepler holds a new dataset object.
  await expect.poll(() => datasetReplaced(map), { timeout: 30_000 }).toBe(true);
  await settle(page);

  await expect.poll(async () => (await readCharts(map)).charts, { timeout: 30_000 }).toEqual(['curvas', 'serie']);
  const { centre } = await sitePoints(map);
  await hover(page, map, centre);
  await expect(page.locator('.map-popover__layer-chart svg').first()).toBeVisible({ timeout: 10_000 });
});

test('Save current map keeps the charts', async ({ gotoPanelEditPage, readProvisionedDashboard, page }) => {
  // Save → apply → remount, the heaviest flow; same call as mapConfig.spec.
  test.slow();
  const dashboard = await readProvisionedDashboard({ fileName: 'charts.json' });
  const panelEditPage = await gotoPanelEditPage({ dashboard, id: '1' });
  const map = page.locator('.maplibregl-map').first();
  await expect(map).toBeVisible({ timeout: 60_000 });
  await expect.poll(async () => (await readCharts(map)).charts, { timeout: 60_000 }).toEqual(['curvas', 'serie']);

  await page.getByTestId('save-map-config').click();
  await expect(page.getByText(/Saved: \d+ layer/)).toBeVisible({ timeout: 10_000 });

  // The remount reads the options Save just wrote, so the charts coming back
  // prove the capture carried them.
  await panelEditPage.apply();
  const remounted = page.locator('.maplibregl-map').first();
  await expect.poll(async () => (await readCharts(remounted)).charts, { timeout: 60_000 }).toEqual(['curvas', 'serie']);
});
