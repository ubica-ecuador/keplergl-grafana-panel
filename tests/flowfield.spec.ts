import { test, expect } from '@grafana/plugin-e2e';

import { readFlowField, readKepler, settle } from './keplerHelpers';

/**
 * The default thirty seconds is not enough here: a full kepler map under
 * swiftshader takes most of it to appear, and the field is only traced once the
 * layer has been added on top of a dataset kepler has finished ingesting.
 */
test.describe.configure({ timeout: 120_000 });

/**
 * A velocity grid must become a flow field layer, and nothing else.
 *
 * The provisioned "flow field" panel feeds a 7 × 7 quarter-degree lattice over
 * the southern Ecuadorian Andes carrying a vortex, as `u`/`v` components. The
 * rows are that lattice; the streamlines are computed by the layer, from the
 * viewport, and exist nowhere in the data.
 *
 * The map is deliberately not screenshotted. At the start of the animation
 * window every trail has zero length, so a paused field draws nothing at all —
 * a picture would assert where the playhead is rather than what the layer did.
 * What is asserted is the geometry the layer traced.
 */
test('draws a velocity grid as a flow field, superseding the point layer', async ({
  gotoPanelEditPage,
  readProvisionedDashboard,
  page,
}) => {
  const dashboard = await readProvisionedDashboard({ fileName: 'flowfield.json' });
  const panelEditPage = await gotoPanelEditPage({ dashboard, id: '1' });

  const map = panelEditPage.panel.locator.locator('canvas').first();
  await expect(map).toBeVisible({ timeout: 60_000 });
  await settle(page);

  await expect
    .poll(async () => (await readKepler(map)).layers.map((l) => l.type), { timeout: 60_000 })
    // The Point layer kepler guesses from the same coordinates is removed: the
    // dots are the grid itself, which is not what the query is about.
    .toEqual(['flowfield']);

  // Polled, not read once: the layer is added before it has traced, so a layer
  // list that already says `flowfield` says nothing yet about its geometry.
  await expect.poll(async () => (await readFlowField(map))?.lines ?? 0, { timeout: 60_000 }).toBeGreaterThan(100);
});

test('runs the streamlines on a clock kepler agrees with', async ({
  gotoPanelEditPage,
  readProvisionedDashboard,
  page,
}) => {
  // `layerVisConfigChange` recomputes a layer's data but never republishes the
  // animation domain, so without the nudge in `useFlowFieldAnimationDomain` the
  // window the lines were traced in is one the clock knows nothing about — and
  // on first load the time widget does not appear at all.
  const dashboard = await readProvisionedDashboard({ fileName: 'flowfield.json' });
  const panelEditPage = await gotoPanelEditPage({ dashboard, id: '1' });

  const map = panelEditPage.panel.locator.locator('canvas').first();
  await expect(map).toBeVisible({ timeout: 60_000 });
  await settle(page);

  await expect.poll(async () => (await readFlowField(map))?.animationDomain, { timeout: 60_000 }).not.toBeNull();
  await expect.poll(async () => (await readFlowField(map))?.lines ?? 0, { timeout: 60_000 }).toBeGreaterThan(100);

  const field = await readFlowField(map);
  const [start, end] = field!.domain!;
  // The default cycle, in the window the layer traced.
  expect(end - start).toBe(60_000);
  expect(field!.animationDomain).toEqual(field!.domain);
});

test('re-traces the field when the layer panel asks for fewer lines', async ({
  gotoPanelEditPage,
  readProvisionedDashboard,
  page,
}) => {
  const dashboard = await readProvisionedDashboard({ fileName: 'flowfield.json' });
  const panelEditPage = await gotoPanelEditPage({ dashboard, id: '1' });

  const map = panelEditPage.panel.locator.locator('canvas').first();
  await expect(map).toBeVisible({ timeout: 60_000 });
  await settle(page);
  await expect.poll(async () => (await readFlowField(map))?.lines ?? 0, { timeout: 60_000 }).toBeGreaterThan(100);

  const before = (await readFlowField(map))!.lines;

  // The density lives on the layer, not in the panel options — which is the
  // whole point of the layer having a panel of its own.
  //
  // Found by its label rather than by position: the panel's knobs are ordered
  // for the person reading them, and that order is allowed to change.
  const density = page
    .locator('label.side-panel-panel__label', { hasText: 'Lines per screen' })
    .locator('xpath=following::input[1]');

  // Dispatched rather than clicked. The header is mostly the layer's name
  // field, so a real pointer lands in that input and only focuses it; kepler's
  // expand handler sits on the container around it.
  await page.locator('.layer-panel__header__content').first().dispatchEvent('click');
  await expect(density).toHaveValue('9000', { timeout: 30_000 });
  await density.fill('1500');
  await density.press('Enter');

  await expect.poll(async () => (await readFlowField(map))?.lines ?? 0, { timeout: 30_000 }).toBeLessThan(before / 2);
});
