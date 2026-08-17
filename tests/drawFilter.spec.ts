import { test, expect } from '@grafana/plugin-e2e';
import { Locator, Page } from '@playwright/test';

/**
 * Drawing a polygon or rectangle to filter — kepler's map-draw feature.
 *
 * The regression this pins: webpack bundled the CommonJS build of
 * `@deck.gl-community/editable-layers`, whose esbuild interop resolves every
 * `@turf/*` default import to the module's exports *object* instead of its
 * function. Every draw mode then threw `TypeError: (0, x.default) is not a
 * function` — the rectangle on its very first click (`bboxPolygon`), the
 * polygon when double-click finishes it (`kinks`) — and the drawn shape never
 * reached kepler's editor state.
 *
 * The dashboard has two kepler panels, so every locator is scoped to one of
 * them — each panel is its own kepler instance with its own store.
 */

/** Reads kepler's editor state through the panel's own redux store. */
async function readEditorState(
  map: Locator
): Promise<{ features: number; mode: string | null; filterTypes: string[] }> {
  return map.evaluate((node) => {
    // The store is not exposed; walk up the React fiber tree from the map node
    // to the redux <Provider store>, the same way react-redux reaches it.
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
    if (!store) {
      return { features: -1, mode: null, filterTypes: [] };
    }
    const instances = store.getState().keplerGl ?? {};
    const visState = (Object.values(instances)[0] as any)?.visState;
    return {
      features: visState?.editor?.features?.length ?? -1,
      mode: visState?.editor?.mode ?? null,
      filterTypes: (visState?.filters ?? []).map((f: { type?: string }) => f.type ?? 'unknown'),
    };
  });
}

/** Opens the panel's map-draw toolbar and selects a drawing mode. */
async function selectDrawMode(panel: Locator, item: 'draw-feature' | 'draw-rectangle'): Promise<void> {
  // The draw control is the map-control button carrying the draw-polygon icon.
  await panel.locator('.map-control button:has(svg[class*="data-ex-icons-draw-polygon"])').click();
  await panel.locator(`.toolbar-item.${item}`).click();
}

/**
 * Three points that land on the map's draw surface, not on the overlays that
 * swallow clicks aimed at the map underneath them: kepler's side panel (open on
 * this dashboard, over the map's left edge), the map controls on the right and
 * the floating time/animation widget at the bottom. Overlay geometry shifts
 * with the viewport, so candidates are probed with elementFromPoint until three
 * land on the bare deck event surface.
 */
async function mapPoints(map: Locator): Promise<Array<{ x: number; y: number }>> {
  const box = await map.boundingBox();
  if (!box) {
    throw new Error('map has no bounding box');
  }
  // fx stops short of the map-control column and the draw toolbar on the
  // right; fy stops short of the animation widget's row, whose floating time
  // display grows and shrinks with the running clock — a point probed as free
  // can be covered by the time it is clicked.
  const candidates: Array<{ x: number; y: number }> = [];
  for (const fy of [0.12, 0.2, 0.28, 0.36]) {
    for (const fx of [0.5, 0.62, 0.74]) {
      candidates.push({ x: box.x + box.width * fx, y: box.y + box.height * fy });
    }
  }
  // The deck event surface is a bare, classless <div> rendered as a *sibling*
  // of .maplibregl-map, so "inside the map node" is not a usable test. A point
  // is safe when it hits that bare div — anything with a class name is one of
  // the overlays (toolbar items, floating time display, side panel, controls).
  const safe = await map.evaluate(
    (_mapNode, points) =>
      points.filter((p) => {
        const el = document.elementFromPoint(p.x, p.y);
        return el instanceof HTMLDivElement && el.className === '';
      }),
    candidates
  );
  if (safe.length < 3) {
    throw new Error(`only ${safe.length} candidate points hit the draw surface`);
  }
  // Spread the triangle out: first, last, and a middle candidate.
  return [safe[0], safe[safe.length - 1], safe[Math.floor(safe.length / 2)]];
}

interface DrawFixture {
  panel: Locator;
  map: Locator;
  errors: string[];
}

async function gotoLoadedTripsPanel(
  gotoDashboardPage: (args: { uid: string }) => Promise<unknown>,
  readProvisionedDashboard: (args: { fileName: string }) => Promise<{ uid: string }>,
  page: Page
): Promise<DrawFixture> {
  const dashboard = await readProvisionedDashboard({ fileName: 'dashboard.json' });
  await gotoDashboardPage(dashboard);

  const panel = page.getByTestId('data-testid Panel header Kepler.gl — trips');
  const map = panel.locator('.maplibregl-map');
  await expect(map).toBeVisible({ timeout: 60_000 });
  await expect(panel.locator('.dataset-name')).toHaveText('Query A', { timeout: 60_000 });
  // Let deck finish mounting its layers; a click during setup is dropped.
  await page.waitForTimeout(3000);

  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return { panel, map, errors };
}

/**
 * Clicks and waits until the page has actually processed each click. Under
 * software WebGL the render loop saturates the main thread and input events
 * queue up; `waitForTimeout` runs in the test process and proves nothing about
 * the page, so instead each click is followed by an in-page round trip that
 * cannot resolve until the event loop has turned and a frame has been
 * scheduled — by which point the queued click handlers have run.
 */
async function clickPoints(page: Page, points: Array<{ x: number; y: number }>): Promise<void> {
  for (const p of points) {
    await page.mouse.click(p.x, p.y);
    await settle(page);
  }
}

async function settle(page: Page): Promise<void> {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0))));
  await page.waitForTimeout(300);
}

test('double-click finishes a drawn polygon and stores it as an editor feature', async ({
  gotoDashboardPage,
  readProvisionedDashboard,
  page,
}) => {
  // A full kepler map under software WebGL, twice in parallel — well past the
  // default 30s budget when the two tests contend for CPU.
  test.slow();
  const { panel, map, errors } = await gotoLoadedTripsPanel(gotoDashboardPage, readProvisionedDashboard, page);

  // The area variable is never written on load — a shared link's value must
  // survive — so before any drawing the URL carries no published figure.
  expect(decodeURIComponent(page.url())).not.toContain('var-area=POLYGON');

  await selectDrawMode(panel, 'draw-feature');
  await expect.poll(async () => (await readEditorState(map)).mode).toBe('DRAW_POLYGON');

  const [a, b, c] = await mapPoints(map);
  await clickPoints(page, [a, b, c]);
  await page.mouse.dblclick(c.x, c.y);

  await expect.poll(async () => (await readEditorState(map)).features, { timeout: 10_000 }).toBe(1);

  // The finished figure reaches the mapped dashboard variable as WKT once it
  // rests (300 ms trailing debounce), even before a layer is chosen for it.
  // Deletion → clear is covered by the pure areaSync tests: kepler's delete
  // path goes through the feature action panel, too fiddly under software GL.
  await expect
    .poll(async () => decodeURIComponent(page.url()), { timeout: 10_000 })
    .toContain('var-area=POLYGON');
  expect(errors).toEqual([]);
});

test('two clicks draw a rectangle that becomes a polygon filter', async ({
  gotoDashboardPage,
  readProvisionedDashboard,
  page,
}) => {
  test.slow();
  const { panel, map, errors } = await gotoLoadedTripsPanel(gotoDashboardPage, readProvisionedDashboard, page);

  await selectDrawMode(panel, 'draw-rectangle');
  await expect.poll(async () => (await readEditorState(map)).mode).toBe('DRAW_RECTANGLE');

  const [a, , c] = await mapPoints(map);
  await page.mouse.click(a.x, a.y);
  await settle(page);
  // The mode builds its tentative rectangle from the last pointer-move it saw,
  // and finishing requires that tentative — so really move there, in steps.
  await page.mouse.move(c.x, c.y, { steps: 8 });
  await settle(page);
  await page.mouse.click(c.x, c.y);

  // A finished rectangle does not stay an editor feature: kepler applies it to
  // every layer right away (`onApplyPolygonFilterAll`), and `setFeaturesUpdater`
  // keeps filter-bound features out of `editor.features`. The filter list is
  // where success shows up.
  await expect
    .poll(async () => (await readEditorState(map)).filterTypes, { timeout: 10_000 })
    .toContain('polygon');

  // The filter-bound figure is published too — the polygon-filter source path.
  await expect
    .poll(async () => decodeURIComponent(page.url()), { timeout: 10_000 })
    .toContain('var-area=POLYGON');
  expect(errors).toEqual([]);
});
