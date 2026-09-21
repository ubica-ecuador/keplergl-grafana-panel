import { test, expect } from '@grafana/plugin-e2e';
import type { Locator, Page } from '@playwright/test';
import { readFileSync } from 'fs';

import { projectRows, readKepler, settle, urlVariable } from './keplerHelpers';

/**
 * The selection halo in the browser: amber rings around the selected points
 * and outlines around the selected shapes, drawn by deck above every kepler
 * layer, only where the row is drawn.
 *
 * The halo is read from what deck was last handed — `MapContainer` keeps its
 * Deck as `_deck` — and its rings projected to page pixels, so a position can
 * be compared with the row it should surround. Every test that clicks proves
 * first that the click registered: a click deck never picked looks exactly
 * like a halo that does not move.
 */

// kepler's side panel is a fixed ~324px overlay regardless of container width.
// "Halo — points" gets a full-width row of its own so its auto-fit point
// layer has room to clear it; this is the suite's usual size (matches
// cogPainted, zarr, esriImage and others), not a size picked for this map.
test.use({ viewport: { width: 1600, height: 1000 } });

const FIXTURE = 'selectionHalo.json';
const fixture = JSON.parse(readFileSync(`provisioning/dashboards/${FIXTURE}`, 'utf8'));

/** The first value of a column in a fixture panel's testdata frame. */
function firstValue(title: string, column: string): string {
  const panel = fixture.panels.find((candidate: { title: string }) => candidate.title === title);
  const [frame] = JSON.parse(panel.targets[0].rawFrameContent);
  const index = frame.schema.fields.findIndex((field: { name: string }) => field.name === column);
  return String(frame.data.values[index][0]);
}

interface HaloReading {
  rings: Array<{ x: number; y: number; radiusPx: number }>;
  outlines: number;
}

/** The halo layers deck was last handed, rings projected to page pixels. */
async function readHalo(map: Locator): Promise<HaloReading> {
  return map.evaluate((node: Element) => {
    const key = Object.keys(node).find((k) => k.startsWith('__reactFiber$'));
    let fiber = key ? (node as any)[key] : null;
    let deck: any = null;
    while (fiber && !deck) {
      deck = fiber.stateNode && fiber.stateNode._deck ? fiber.stateNode._deck : null;
      fiber = fiber.return;
    }
    if (!deck) {
      return { rings: [], outlines: -1 };
    }
    const layers: any[] = deck.props.layers ?? [];
    const rect = deck.canvas.getBoundingClientRect();
    const viewport = deck.getViewports()[0];
    const points = layers.find((layer) => layer.id.startsWith('panel-selection-halo-points'));
    const outlines = layers.find((layer) => layer.id.startsWith('panel-selection-halo-outlines'));
    return {
      rings: (points?.props.data ?? []).map((ring: { position: [number, number]; radiusPx: number }) => {
        const [x, y] = viewport.project(ring.position);
        return { x: rect.left + x, y: rect.top + y, radiusPx: ring.radiusPx };
      }),
      outlines: outlines ? outlines.props.data.length : 0,
    };
  });
}

/** The kepler layer type the last click resolved to, or 'null'/'undefined'. */
async function clickedLayerType(map: Locator): Promise<string> {
  return map.evaluate((node: Element) => {
    const key = Object.keys(node).find((k) => k.startsWith('__reactFiber$'));
    let fiber = key ? (node as any)[key] : null;
    while (fiber) {
      const store = fiber.memoizedProps && fiber.memoizedProps.store;
      if (store && typeof store.getState === 'function') {
        const visState = (Object.values(store.getState().keplerGl)[0] as any).visState;
        const clicked = visState.clicked;
        return clicked ? String(visState.layers[clicked.layer?.props?.idx]?.type) : String(clicked);
      }
      fiber = fiber.return;
    }
    return 'no store';
  });
}

async function openPanel(
  gotoDashboardPage: (args: { uid: string; queryParams?: URLSearchParams }) => Promise<unknown>,
  readProvisionedDashboard: (args: { fileName: string }) => Promise<{ uid: string }>,
  page: Page,
  title: string,
  params: Record<string, string> = {}
): Promise<{ panel: Locator; map: Locator }> {
  const dashboard = await readProvisionedDashboard({ fileName: FIXTURE });
  await gotoDashboardPage({ ...dashboard, queryParams: new URLSearchParams(params) });
  const panel = page.getByTestId(`data-testid Panel header ${title}`);
  const map = panel.locator('.maplibregl-map');
  await expect(map).toBeVisible({ timeout: 60_000 });
  await expect(panel.locator('.dataset-name')).toHaveText('Query A', { timeout: 60_000 });
  await page.waitForTimeout(2000);
  return { panel, map };
}

const near = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.abs(a.x - b.x) < 3 && Math.abs(a.y - b.y) < 3;

test('a shared link shows its selection ringed, with no click at all', async ({
  gotoDashboardPage,
  readProvisionedDashboard,
  page,
}) => {
  test.slow();
  const { map } = await openPanel(gotoDashboardPage, readProvisionedDashboard, page, 'Halo — points', {
    'var-site': 'site-07',
  });

  const target = (await projectRows(map)).find((row) => String(row.values.site) === 'site-07');
  expect(target, 'site-07 must be clickable on the map').toBeDefined();
  await expect.poll(async () => (await readHalo(map)).rings.length, { timeout: 10_000 }).toBe(1);
  const [ring] = (await readHalo(map)).rings;
  expect(near(ring, target!)).toBe(true);
});

test('clicking another entity moves the ring to it', async ({ gotoDashboardPage, readProvisionedDashboard, page }) => {
  test.slow();
  const { map } = await openPanel(gotoDashboardPage, readProvisionedDashboard, page, 'Halo — points');
  const rows = await projectRows(map);

  for (const target of [rows[0], rows[1]]) {
    await page.mouse.click(target.x, target.y);
    await settle(page);
    // The click published: proof it registered, before the claim about the ring.
    await expect.poll(() => urlVariable(page, 'site'), { timeout: 10_000 }).toBe(String(target.values.site));
    await expect
      .poll(
        async () => {
          const { rings } = await readHalo(map);
          return rings.length === 1 && near(rings[0], target);
        },
        { timeout: 10_000 }
      )
      .toBe(true);
  }
});

test('a click on the ringed point still reaches the kepler layer under it', async ({
  gotoDashboardPage,
  readProvisionedDashboard,
  page,
}) => {
  test.slow();
  const { map } = await openPanel(gotoDashboardPage, readProvisionedDashboard, page, 'Halo — points', {
    'var-site': 'site-07',
  });
  const target = (await projectRows(map)).find((row) => String(row.values.site) === 'site-07');
  expect(target, 'site-07 must be clickable on the map').toBeDefined();
  await expect.poll(async () => (await readHalo(map)).rings.length, { timeout: 10_000 }).toBe(1);

  await page.mouse.click(target!.x, target!.y);
  await settle(page);

  await expect.poll(() => clickedLayerType(map), { timeout: 10_000 }).toBe('point');
});

test('hiding the layer hides its ring', async ({ gotoDashboardPage, readProvisionedDashboard, page }) => {
  test.slow();
  const { panel, map } = await openPanel(gotoDashboardPage, readProvisionedDashboard, page, 'Halo — points', {
    'var-site': 'site-07',
  });
  await expect.poll(async () => (await readHalo(map)).rings.length, { timeout: 10_000 }).toBe(1);

  await panel.locator('.layer__visibility-toggle').first().click();

  await expect.poll(async () => (await readHalo(map)).rings.length, { timeout: 10_000 }).toBe(0);
});

test('a range filter that leaves the row out leaves no ring, and one that keeps it does', async ({
  gotoDashboardPage,
  readProvisionedDashboard,
  page,
}) => {
  test.slow();
  // site-07 has value 28.
  for (const [min, max, rings] of [
    ['40', '100', 0],
    ['20', '40', 1],
  ] as const) {
    const { map } = await openPanel(gotoDashboardPage, readProvisionedDashboard, page, 'Halo — points', {
      'var-site': 'site-07',
      'var-valueMin': min,
      'var-valueMax': max,
    });
    // The range filter exists — a GPU filter, the case filteredIndex never shows.
    await expect
      .poll(async () => (await readKepler(map)).filters.some((filter) => filter.type === 'range'), { timeout: 10_000 })
      .toBe(true);
    await expect.poll(async () => (await readHalo(map)).rings.length, { timeout: 10_000 }).toBe(rings);
  }
});

test('a selected polygon and a selected hexagon are outlined, not ringed', async ({
  gotoDashboardPage,
  readProvisionedDashboard,
  page,
}) => {
  test.slow();
  for (const [title, variable, column] of [
    ['Halo — polygons', 'var-zone', 'name'],
    ['Halo — H3', 'var-cell', 'h3'],
  ] as const) {
    const { map } = await openPanel(gotoDashboardPage, readProvisionedDashboard, page, title, {
      [variable]: firstValue(title, column),
    });
    await expect.poll(async () => (await readHalo(map)).outlines, { timeout: 10_000 }).toBe(1);
    expect((await readHalo(map)).rings).toEqual([]);
  }
});
