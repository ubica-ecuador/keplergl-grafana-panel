import { test, expect } from '@grafana/plugin-e2e';
import type { Locator } from '@playwright/test';

import {
  CITY_BOX_GROUND,
  CITY_REGION_GROUND,
  ELSEWHERE_URL,
  ION_ASSET,
  ION_TOKEN,
  routeTiles3d,
} from './tile3dFixtures';

/**
 * 3D tilesets that span the whole world, shaped like the real ones that drew
 * nothing on 2026-09-28 (see tile3dFixtures.ts), over Cuenca at 2 550 m with the
 * camera at street level:
 *
 * - Cesium OSM Buildings' regions round the whole world were culled away by
 *   loaders.gl, and its empty first tile switched the layer off in luma.gl;
 * - Google's globe was "grounded" by a base 7 600 km underground and shoved
 *   out of view;
 * - an ion asset served from elsewhere was asked of ion, and refused;
 * - and a tileset round the whole world, left at its real altitude, sat above a
 *   street-level camera over Cuenca: it is now lowered by the ground under the
 *   centre of the view.
 */

test.use({ viewport: { width: 1920, height: 1080 } });

const REGIONS_PANEL = 'A world of regions · like Cesium OSM Buildings';
const BOX_PANEL = 'A world in one box · like Google Photorealistic 3D Tiles';
const ION_PANEL = 'An ion asset served from elsewhere · like Google through Cesium ion';

/** How far deck has lowered the panel's tileset, in metres, or null before it has loaded. */
async function tilesetShift(map: Locator): Promise<number | null> {
  return map.evaluate((node) => {
    const fiberKey = Object.keys(node).find((k) => k.startsWith('__reactFiber$'));
    let fiber = fiberKey ? (node as unknown as Record<string, any>)[fiberKey] : null;
    let deck: any = null;
    while (fiber) {
      const instance = fiber.stateNode;
      if (instance && instance._deck && instance._deck.layerManager) {
        deck = instance._deck;
        break;
      }
      fiber = fiber.return;
    }
    if (!deck) {
      throw new Error('deck.gl instance not found from map node');
    }
    const layer = deck.layerManager.getLayers().find((candidate: any) => candidate.state?.tileset3d);
    const matrix = layer?.state?.tileset3d?.modelMatrix;
    return matrix ? Math.hypot(matrix[12], matrix[13], matrix[14]) : null;
  });
}

test('a world of regions with an empty first tile draws, lowered by the ground under the view', async ({
  page,
  gotoDashboardPage,
  readProvisionedDashboard,
}) => {
  test.slow();
  const requests = await routeTiles3d(page);
  const dashboard = await gotoDashboardPage(await readProvisionedDashboard({ fileName: 'tile3dGlobal.json' }));
  const panel = dashboard.getPanelByTitle(REGIONS_PANEL).locator;
  const map = panel.locator('.maplibregl-map');

  // Past the world and the western hemisphere: loaders.gl's two-corner box for a
  // region round the world held none of it, and nothing below the root loaded.
  await expect
    .poll(() => requests.map((request) => request.path), { timeout: 60_000 })
    .toContain('/world-regions/city.b3dm');
  await expect.poll(() => tilesetShift(map), { timeout: 30_000 }).toBeGreaterThan(CITY_REGION_GROUND - 30);
  expect(await tilesetShift(map)).toBeLessThan(CITY_REGION_GROUND + 30);
  // The empty first tile no longer switches the layer off.
  await expect(panel.getByText(/An error in deck\.gl/)).toHaveCount(0);
});

test('a world in one box centred on the Earth is lowered by the ground under the view, not by its centre', async ({
  page,
  gotoDashboardPage,
  readProvisionedDashboard,
}) => {
  test.slow();
  const requests = await routeTiles3d(page);
  const dashboard = await gotoDashboardPage(await readProvisionedDashboard({ fileName: 'tile3dGlobal.json' }));
  const panel = dashboard.getPanelByTitle(BOX_PANEL).locator;
  const map = panel.locator('.maplibregl-map');

  await expect
    .poll(() => requests.map((request) => request.path), { timeout: 60_000 })
    .toContain('/world-box/city.glb');
  await expect.poll(() => tilesetShift(map), { timeout: 30_000 }).toBeGreaterThan(CITY_BOX_GROUND - 30);
  expect(await tilesetShift(map)).toBeLessThan(CITY_BOX_GROUND + 30);
  await expect(panel.getByText(/An error in deck\.gl/)).toHaveCount(0);
});

test('an ion asset served from elsewhere is loaded from there, and the ion token stays with ion', async ({
  page,
  gotoDashboardPage,
  readProvisionedDashboard,
}) => {
  test.slow();
  const requests = await routeTiles3d(page);
  await gotoDashboardPage(await readProvisionedDashboard({ fileName: 'tile3dGlobal.json' }));

  await expect
    .poll(() => requests.map((request) => request.path), { timeout: 60_000 })
    .toContain('/elsewhere/city.glb');

  const ion = requests.filter((request) => request.url.includes(`/v1/assets/${ION_ASSET}`));
  expect(ion.length).toBeGreaterThan(0);
  expect(ion.every((request) => request.authorization === `Bearer ${ION_TOKEN}`)).toBe(true);

  const elsewhere = requests.filter((request) => request.path.startsWith('/elsewhere/'));
  expect(elsewhere.find((request) => request.path === '/elsewhere/root.json')?.query).toBe(
    new URL(ELSEWHERE_URL).search
  );
  // Whoever serves the asset gets its own key, never ion's token.
  expect(elsewhere.filter((request) => request.authorization)).toEqual([]);
  // ion's own URL for the asset, which answered 401, is no longer asked at all.
  expect(requests.filter((request) => request.url.startsWith('https://assets.ion.cesium.com/'))).toEqual([]);
});
