import { test, expect } from '@grafana/plugin-e2e';
import type { Locator } from '@playwright/test';

import { settle } from './keplerHelpers';

/** A full kepler map under swiftshader: see `flowfield.spec.ts` for the budget. */
test.describe.configure({ timeout: 180_000 });

/**
 * Two panels whose layers share an id must not drive each other's controls.
 *
 * The symbols dashboard opens with two maps that auto-add their symbol layer on
 * a `grafana-A` dataset, so both layers are `symbol-grafana-A`, and kepler's
 * switches find their input by an id built from that. A click on the second
 * map's switch used to toggle the first map's.
 */

/** The `upright` setting of the map's symbol layer, from its own kepler store. */
async function upright(panel: Locator): Promise<unknown> {
  return panel.locator('.maplibregl-map').evaluate((node) => {
    const fiberKey = Object.keys(node).find((k) => k.startsWith('__reactFiber$'));
    let fiber = fiberKey ? (node as unknown as Record<string, any>)[fiberKey] : null;
    while (fiber && !(fiber.memoizedProps?.store && typeof fiber.memoizedProps.store.getState === 'function')) {
      fiber = fiber.return;
    }
    const visState = (Object.values(fiber.memoizedProps.store.getState().keplerGl ?? {})[0] as any)?.visState;
    return visState?.layers.find((l: { type?: string }) => l.type === 'symbol')?.config.visConfig.upright;
  });
}

test('a switch in one panel changes that panel, not another with the same layer id', async ({
  gotoDashboardPage,
  readProvisionedDashboard,
  page,
}) => {
  test.slow();
  // Tall enough for both maps: Grafana does not mount a panel until it is in view.
  await page.setViewportSize({ width: 1400, height: 1600 });
  const dashboard = await readProvisionedDashboard({ fileName: 'symbols.json' });
  await gotoDashboardPage({
    ...dashboard,
    queryParams: new URLSearchParams({
      from: '2025-07-23T06:30:00.000Z',
      to: '2025-07-23T07:30:00.000Z',
      timezone: 'utc',
    }),
  });

  const upper = page.getByTestId('data-testid Panel header Wind stations');
  const lower = page.getByTestId('data-testid Panel header Wind stations, hourly');
  for (const panel of [upper, lower]) {
    await expect(panel.locator('.maplibregl-map')).toBeVisible({ timeout: 60_000 });
    await expect.poll(() => upright(panel), { timeout: 60_000 }).toBe(false);
  }

  // Layer panels are opened by dispatch (see `symbols.spec.ts`); the switch is
  // flipped by its label, which is what a person clicks.
  // Both layer panels open: with the upper one closed its input is not in the
  // page, and the id is not ambiguous at all.
  await upper.locator('.layer-panel__header__content').first().dispatchEvent('click');
  await expect(upper.locator('label[for$="-upright-switch"]')).toBeVisible({ timeout: 30_000 });
  await lower.locator('.layer-panel__header__content').first().dispatchEvent('click');
  const label = lower.locator('label[for$="-upright-switch"]');
  await expect(label).toBeVisible({ timeout: 30_000 });
  await label.click();
  await settle(page);

  await expect.poll(() => upright(lower), { timeout: 10_000 }).toBe(true);
  expect(await upright(upper)).toBe(false);
});
