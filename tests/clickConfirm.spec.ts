import { test, expect } from '@grafana/plugin-e2e';
import type { Locator, Page } from '@playwright/test';

import { emptyPoint, projectRows, settle, urlVariable } from './keplerHelpers';

/**
 * The panel option that moves the selection from the click to the popup.
 *
 * With it on, a click only opens kepler's popup: no variable moves until the
 * button in that popup is pressed. What these pin is the whole gesture — the
 * click that publishes nothing, the Select that publishes and closes, the
 * Clear that empties, and the empty-map click that now leaves the selection
 * where it is.
 *
 * Every assertion about "nothing was published" is preceded by proof that the
 * click actually reached kepler: the button only exists while kepler holds a
 * clicked entity, so seeing it is that proof. A click deck never picked looks
 * exactly like a feature that does nothing — see the note in
 * `deck-clicks-swiftshader`.
 */

/** How many figures kepler's editor holds — drawn by hand or placed by a click. */
async function figureCount(map: Locator): Promise<number> {
  return map.evaluate((node) => {
    const fiberKey = Object.keys(node).find((k) => k.startsWith('__reactFiber$'));
    let fiber = fiberKey ? (node as unknown as Record<string, any>)[fiberKey] : null;
    while (fiber) {
      const store = fiber.memoizedProps && fiber.memoizedProps.store;
      if (store && typeof store.getState === 'function') {
        const visState = (Object.values(store.getState().keplerGl ?? {})[0] as any)?.visState;
        return visState?.editor?.features?.length ?? -1;
      }
      fiber = fiber.return;
    }
    return -1;
  });
}

async function gotoConfirmPanel(
  gotoDashboardPage: (args: { uid: string }) => Promise<unknown>,
  readProvisionedDashboard: (args: { fileName: string }) => Promise<{ uid: string }>,
  page: Page
): Promise<{ map: Locator; button: Locator }> {
  const dashboard = await readProvisionedDashboard({ fileName: 'clickConfirm.json' });
  await gotoDashboardPage(dashboard);

  const panel = page.getByTestId('data-testid Panel header Kepler.gl — select from the popup');
  const map = panel.locator('.maplibregl-map');
  await expect(map).toBeVisible({ timeout: 60_000 });
  await expect(panel.locator('.dataset-name')).toHaveText('Query A', { timeout: 60_000 });
  await page.waitForTimeout(3000);

  return { map, button: page.locator('.panel-select-entity') };
}

test('a click shows the entity, and the popup’s button is what publishes it', async ({
  gotoDashboardPage,
  readProvisionedDashboard,
  page,
}) => {
  test.slow();
  const { map, button } = await gotoConfirmPanel(gotoDashboardPage, readProvisionedDashboard, page);

  expect(urlVariable(page, 'site')).toBe('');

  const rows = await projectRows(map);
  expect(rows.length).toBeGreaterThan(0);
  const target = rows[0];
  await page.mouse.click(target.x, target.y);
  await settle(page);

  // The button exists only while kepler holds a clicked entity: this is the
  // proof the click landed, and it comes before the claim that it published
  // nothing.
  await expect(button).toHaveText('Select', { timeout: 10_000 });
  await page.waitForTimeout(1500);
  expect(urlVariable(page, 'site')).toBe('');

  await button.click();

  await expect.poll(() => urlVariable(page, 'site'), { timeout: 10_000 }).toBe(String(target.values.site));
  // Select is done with the popup: it closes, the way kepler's own
  // "Select Geometry" does.
  await expect(button).toHaveCount(0, { timeout: 10_000 });
  // And it did only what this panel's click used to do. The panel does not
  // set an area by clicking, so no search square may appear.
  expect(await figureCount(map)).toBe(0);
});

test('the entity already selected offers Clear, which empties the variable', async ({
  gotoDashboardPage,
  readProvisionedDashboard,
  page,
}) => {
  test.slow();
  const { map, button } = await gotoConfirmPanel(gotoDashboardPage, readProvisionedDashboard, page);

  const rows = await projectRows(map);
  const target = rows[0];
  const site = String(target.values.site);

  await page.mouse.click(target.x, target.y);
  await settle(page);
  await expect(button).toHaveText('Select', { timeout: 10_000 });
  await button.click();
  await expect.poll(() => urlVariable(page, 'site'), { timeout: 10_000 }).toBe(site);

  // Clicking it again: the popup now knows this entity is the selection.
  await page.mouse.click(target.x, target.y);
  await settle(page);
  await expect(button).toHaveText('Clear selection', { timeout: 10_000 });

  await button.click();

  await expect.poll(() => urlVariable(page, 'site'), { timeout: 10_000 }).toBe('');
  // The same rule the empty-map click obeys: a variable every query needs is
  // never emptied by a deselect, whichever gesture asks for it.
  expect(urlVariable(page, 'siteKept')).toBe(site);
  await expect(button).toHaveCount(0, { timeout: 10_000 });
});

test('clicking empty map leaves the selection where the button put it', async ({
  gotoDashboardPage,
  readProvisionedDashboard,
  page,
}) => {
  test.slow();
  const { map, button } = await gotoConfirmPanel(gotoDashboardPage, readProvisionedDashboard, page);

  const rows = await projectRows(map);
  const target = rows[0];
  await page.mouse.click(target.x, target.y);
  await settle(page);
  await expect(button).toHaveText('Select', { timeout: 10_000 });
  await button.click();
  await expect.poll(() => urlVariable(page, 'site'), { timeout: 10_000 }).toBe(String(target.values.site));

  // Dismissing the popup to look elsewhere must not re-query the dashboard.
  const empty = await emptyPoint(map);
  await page.mouse.click(empty.x, empty.y);
  await settle(page);
  await page.waitForTimeout(1500);

  expect(urlVariable(page, 'site')).toBe(String(target.values.site));
});
