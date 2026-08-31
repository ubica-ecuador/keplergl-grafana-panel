import { test, expect } from '@grafana/plugin-e2e';

import { readFlowField, readKepler, settle } from './keplerHelpers';

/**
 * The default thirty seconds is nowhere near enough: a full kepler map under
 * swiftshader takes most of it just to appear, the field is only traced once the
 * layer has been added on top of a dataset kepler has finished ingesting, and
 * the seamless loop draws every line that crosses the seam a second time — about
 * half as much geometry again for the software renderer to get through.
 */
test.describe.configure({ timeout: 180_000 });

/**
 * Every test below also calls `test.slow()`, tripling that budget again on top
 * of the 180s above. The flow field traces thousands of streamlines per frame
 * under software rendering and is the first test in the bench to starve when
 * the machine is under load: measured 2026-08-31, a full suite run at a single
 * worker was otherwise green and this file's first test was the only failure,
 * while the same spec run alone passed 5/5. The fixed timeout was enough on an
 * idle machine but not once something else was competing for the CPU these
 * maps share, which is exactly the condition a two-core CI runner puts every
 * test in.
 */

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
  test.slow();
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
  test.slow();
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
  test.slow();
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

/**
 * What this layer would hand deck right now, asked of the layer itself.
 *
 * Not measured off the canvas, though that was the first instinct. Under the
 * software renderer the animation advances about a tenth of a second of its own
 * clock per second of real time, so the playhead never leaves the start of the
 * window — where every trail has zero length and the map is legitimately blank.
 * A pixel count there measures the renderer's speed, not the layer's decision.
 */
async function deckVisibility(map: import('@playwright/test').Locator): Promise<boolean | undefined> {
  return map.evaluate((node) => {
    const fiberKey = Object.keys(node).find((k) => k.startsWith('__reactFiber$'));
    let fiber = fiberKey ? (node as unknown as Record<string, any>)[fiberKey] : null;
    let store = null;
    while (fiber) {
      const candidate = fiber.memoizedProps && fiber.memoizedProps.store;
      if (candidate && typeof candidate.getState === 'function') {
        store = candidate;
        break;
      }
      fiber = fiber.return;
    }
    const entry = Object.values(store.getState().keplerGl ?? {})[0] as any;
    const visState = entry?.visState;
    const index = (visState?.layers ?? []).findIndex((l: { type?: string }) => l.type === 'flowfield');
    const built = visState.layers[index].renderLayer({
      data: visState.layerData[index],
      animationConfig: visState.animationConfig,
    });
    return built[0]?.props?.visible;
  });
}

test('is switched off by the eye in the layer panel', async ({
  gotoPanelEditPage,
  readProvisionedDashboard,
  page,
}) => {
  test.slow();
  // kepler hands deck every layer, visible or not — `prepareLayersForDeck` says
  // so upstream in as many words — and expects each one to read the `visible`
  // prop that `getDefaultDeckLayerProps` sets. A layer building its deck props
  // by hand, as this one does, silently ignores the eye until it reads it too.
  const dashboard = await readProvisionedDashboard({ fileName: 'flowfield.json' });
  const panelEditPage = await gotoPanelEditPage({ dashboard, id: '1' });

  const map = panelEditPage.panel.locator.locator('canvas').first();
  await expect(map).toBeVisible({ timeout: 60_000 });
  await settle(page);
  await expect.poll(async () => (await readFlowField(map))?.lines ?? 0, { timeout: 60_000 }).toBeGreaterThan(100);

  expect(await deckVisibility(map)).toBe(true);

  // A real click, not a dispatched one: the handler is on an inner node, so an
  // event fired at the container never reaches it. Nothing is animating here,
  // so the panel holds still enough for the pointer.
  const eye = page.locator('.layer__visibility-toggle').first();
  await page.locator('.layer-panel__header').first().hover();
  await eye.click();
  await expect.poll(() => deckVisibility(map), { timeout: 30_000 }).toBe(false);

  await page.locator('.layer-panel__header').first().hover();
  await eye.click();
  await expect.poll(() => deckVisibility(map), { timeout: 30_000 }).toBe(true);
});
