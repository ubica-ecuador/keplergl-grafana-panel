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
 * This first test asserts the geometry the layer traced rather than a picture
 * of it: what is at stake here is which layers the panel built and how many
 * lines came out, and a screenshot would answer neither. The test below does
 * take pictures, because what it asks — does this move on its own? — is a
 * question about pixels.
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

// The suite runs with `prefers-reduced-motion: reduce` so the software renderer
// is not pegged by a field nobody is watching — see `playwright.config.ts`. This
// test is the exception, because movement is what it asks about.
test.describe('with motion allowed', () => {
  test.use({ reducedMotion: 'no-preference' });

  test('animates itself, and leaves kepler\'s clock alone', async ({
    gotoPanelEditPage,
    readProvisionedDashboard,
    page,
  }) => {
    test.slow();
    // What this replaces: the field used to be stretched over kepler's own clock,
    // so it drew nothing until someone pressed play — and it spent the map's one
    // time axis on a phase that says nothing about the weather.
    const dashboard = await readProvisionedDashboard({ fileName: 'flowfield.json' });
    const panelEditPage = await gotoPanelEditPage({ dashboard, id: '1' });

    const map = panelEditPage.panel.locator.locator('canvas').first();
    await expect(map).toBeVisible({ timeout: 60_000 });
    await settle(page);
    await expect.poll(async () => (await readFlowField(map))?.lines ?? 0, { timeout: 60_000 }).toBeGreaterThan(100);

    const field = await readFlowField(map);
    // kepler hands every layer `animation: {enabled: false}` (`base-layer.ts`), so
    // the claim is not that the key is absent but that this layer never switches
    // it on — and that the map's clock is left with no window at all, which is
    // what keeps the time widget off a map whose only layer is a field.
    expect(field!.animation?.enabled).not.toBe(true);
    expect(field!.animationDomain).toBeNull();

    // Nobody presses play, and the picture has to change anyway. Two shots of the
    // same canvas a second apart: equal bytes would mean a still map, and a still
    // map is what this whole change exists to end.
    const first = await map.screenshot();
    await page.waitForTimeout(1_500);
    const second = await map.screenshot();

    expect(Buffer.compare(first, second)).not.toBe(0);
  });
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

test('shows its colour ramp in the legend, and follows a range set by hand', async ({
  gotoPanelEditPage,
  readProvisionedDashboard,
  page,
}) => {
  test.slow();
  // The legend button is the last in kepler's control column. At the default
  // 1280×720 the panel editor of Grafana 13.0 leaves the map 214 px tall, the
  // column runs past the panel's bottom edge and the button is clipped: still
  // "visible" to Playwright, but a click at its centre lands on Grafana's
  // layout. Same fix as `effects.spec.ts`, only for the test that needs it.
  await page.setViewportSize({ width: 1920, height: 1080 });
  // The legend reads a layer's colours through keys it looks up on the layer's
  // config. A flow field's colour is the speed of lines that are no column of
  // its dataset, so until the layer offered keys of its own the legend showed
  // one swatch for a map painted in six colours.
  const dashboard = await readProvisionedDashboard({ fileName: 'flowfield.json' });
  const panelEditPage = await gotoPanelEditPage({ dashboard, id: '1' });

  const map = panelEditPage.panel.locator.locator('canvas').first();
  await expect(map).toBeVisible({ timeout: 60_000 });
  await settle(page);
  await expect.poll(async () => (await readFlowField(map))?.lines ?? 0, { timeout: 60_000 }).toBeGreaterThan(100);

  // Looked for on the page, not inside the panel: kepler mounts the legend only
  // while its control is active, and on a narrow map portals it to the body.
  // One kepler panel on this dashboard, so there is no other legend to find.
  const legend = page.locator('.map-legend');
  if ((await legend.count()) === 0) {
    // Through the mouse, like `effects.spec.ts`: under software WebGL the render
    // loop keeps a map-control button from ever reporting itself stable. And
    // only when closed, because the button toggles.
    const button = panelEditPage.panel.locator.locator('button.show-legend');
    await expect(button).toBeVisible({ timeout: 30_000 });
    const box = await button.boundingBox();
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
  }

  // The provisioned vortex runs from 3.864 to 8.411 m/s across the whole field —
  // the whole field, not the lines on screen, which span much less of it.
  //
  // The bins are read as input values, not text: kepler draws each label as an
  // editable box, and a box's value is no part of the legend's text content.
  const firstBin = legend.locator('input').first();
  await expect(legend).toContainText('Speed', { timeout: 30_000 });
  await expect(firstBin).toHaveValue(/^3\.864 to /);
  await expect(legend.locator('input')).toHaveCount(6);

  // Switched on, the range starts at the field's own, rounded outwards to the
  // slider's step: 3.84 to 8.44.
  await page.locator('.layer-panel__header__content').first().dispatchEvent('click');
  const fixedRange = page.locator('label[for$="-fixedSpeedRange-switch"]');
  await expect(fixedRange).toBeVisible({ timeout: 30_000 });
  await fixedRange.click();

  await expect
    .poll(async () => (await readFlowField(map))?.visConfig.speedRange, { timeout: 30_000 })
    .toEqual([3.84, 8.44]);
  await expect(firstBin).toHaveValue(/^3\.84 to /, { timeout: 30_000 });
});

/**
 * What this layer would hand deck right now, asked of the layer itself.
 *
 * Not measured off the canvas, though that was the first instinct: a hidden
 * layer and a layer drawn in a colour close to the basemap's look the same to a
 * pixel count, and what is at issue here is the decision, not the paint. (The
 * test above does read pixels, because *movement* is a thing only pixels can
 * show, and the field's clock runs in real time whatever the renderer manages.)
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
