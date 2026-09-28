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

/**
 * The loaded tiles with something to draw: the height of the origin deck draws
 * each one round, and how far that origin has drifted from where the tile's
 * bounding volume now is, in metres.
 *
 * loaders.gl works out a tile's drawing origin once, when its content loads.
 * Lowering the tileset afterwards moved the volumes the traversal culls against
 * and left the drawn geometry where it had been: over Cuenca, 2 500 m up, above
 * a street-level camera.
 */
async function drawnTiles(map: Locator): Promise<Array<{ url: string; height: number; drift: number }>> {
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
    const tiles: any[] = layer?.state?.tileset3d?.tiles ?? [];
    return tiles
      .filter((tile) => tile.content?.cartographicOrigin && tile.content?.gltf?.meshes?.length)
      .map((tile) => {
        const origin = tile.content.cartesianOrigin;
        const centre = tile.boundingVolume.center;
        return {
          url: String(tile.contentUrl ?? tile.url ?? ''),
          height: tile.content.cartographicOrigin[2],
          drift: Math.hypot(origin[0] - centre[0], origin[1] - centre[1], origin[2] - centre[2]),
        };
      });
  });
}

/**
 * The tiles deck has built a sublayer for: the height of the origin their
 * content says to draw round, and the one the sublayer actually draws round.
 *
 * Moving a loaded tile's content is half of it: deck builds a tile's sublayer
 * once, and draws the old origin until told to build it again.
 */
async function sublayerOrigins(map: Locator): Promise<Array<{ url: string; content: number; drawn: number }>> {
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
    const tiles: any[] = layer?.state?.tileset3d?.tiles ?? [];
    const layerMap = layer?.state?.layerMap ?? {};
    return tiles
      .filter((tile) => tile.selected && tile.content?.cartographicOrigin && layerMap[tile.id]?.layer)
      .map((tile) => ({
        url: String(tile.contentUrl ?? tile.url ?? ''),
        content: tile.content.cartographicOrigin[2],
        drawn: layerMap[tile.id].layer.props.coordinateOrigin[2],
      }));
  });
}

/** Waits until deck draws every tile round the origin its content now says, and there is at least one. */
async function expectSublayersFollow(map: Locator): Promise<void> {
  await expect
    .poll(
      async () => {
        const origins = await sublayerOrigins(map);
        return origins.length === 0
          ? Infinity
          : Math.max(...origins.map(({ content, drawn }) => Math.abs(content - drawn)));
      },
      { timeout: 30_000 }
    )
    .toBeLessThan(0.01);
}

/**
 * Has the tree say the ground under the city is higher, as a deeper tile
 * arriving would, and has deck update the layer — a change of ground with no
 * change of props, which is what panning or a tile loading brings. deck
 * rebuilds a tile's sublayer on a change of props by itself; on this, only if
 * told to.
 */
async function raiseCityGround(map: Locator, metres: number): Promise<void> {
  await map.evaluate((node, rise) => {
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
    const stack: any[] = Object.values(layer.state.tileset3d.roots ?? {});
    while (stack.length > 0) {
      const tile = stack.pop();
      stack.push(...(tile.children ?? []));
      const box = tile.header?.boundingVolume?.box;
      if (box && /city\.glb/.test(String(tile.contentUrl ?? ''))) {
        const length = Math.hypot(box[9], box[10], box[11]);
        [0, 1, 2].forEach((axis) => (box[axis] += (box[9 + axis] / length) * rise));
      }
    }
    layer.setNeedsUpdate();
  }, metres);
}

/**
 * Sets the panel's 3D tile layer's Height adjustment, the way kepler's layer
 * panel does: through its store, with the action `wrapTo` builds (see
 * `narrowTimeFilterToMiddleHour` in flowfield.spec.ts).
 */
async function setHeightAdjustment(map: Locator, metres: number): Promise<void> {
  await map.evaluate((node, altitudeOffset) => {
    const fiberKey = Object.keys(node).find((k) => k.startsWith('__reactFiber$'));
    let fiber = fiberKey ? (node as unknown as Record<string, any>)[fiberKey] : null;
    let store: any = null;
    while (fiber) {
      const candidate = fiber.memoizedProps && fiber.memoizedProps.store;
      if (candidate && typeof candidate.getState === 'function') {
        store = candidate;
        break;
      }
      fiber = fiber.return;
    }
    if (!store) {
      throw new Error('kepler store not found from map node');
    }
    const state = store.getState();
    const instanceId = Object.keys(state.keplerGl ?? {})[0];
    const layer = (state.keplerGl?.[instanceId]?.visState?.layers ?? []).find(
      (candidate: { type?: string }) => candidate.type === 'tile3d'
    );
    if (!layer) {
      throw new Error('no 3D tile layer in the store');
    }
    const action = {
      type: '@@kepler.gl/LAYER_VIS_CONFIG_CHANGE',
      oldLayer: layer,
      newVisConfig: { altitudeOffset },
    };
    store.dispatch({
      type: action.type,
      payload: { ...action, meta: { _id_: instanceId } },
      meta: { _forward_: '@redux-forward/FORWARD', _addr_: `@@KG_${instanceId.toUpperCase()}` },
    });
  }, metres);
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
  // And what is drawn has come down with it: loaders.gl fixes a tile's drawing
  // origin when its content loads, so a tile loaded before the tileset was
  // lowered stayed 2 500 m up, above the camera.
  await expect.poll(async () => (await drawnTiles(map)).length, { timeout: 30_000 }).toBeGreaterThan(0);
  for (const tile of await drawnTiles(map)) {
    expect(tile.height, tile.url).toBeGreaterThan(-100);
    expect(tile.height, tile.url).toBeLessThan(400);
    expect(tile.drift, tile.url).toBeLessThan(1);
  }
  await expectSublayersFollow(map);
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
  // And what is drawn has come down with it: loaders.gl fixes a tile's drawing
  // origin when its content loads, so a tile loaded before the tileset was
  // lowered stayed 2 500 m up, above the camera.
  await expect.poll(async () => (await drawnTiles(map)).length, { timeout: 30_000 }).toBeGreaterThan(0);
  for (const tile of await drawnTiles(map)) {
    expect(tile.height, tile.url).toBeGreaterThan(-100);
    expect(tile.height, tile.url).toBeLessThan(400);
    expect(tile.drift, tile.url).toBeLessThan(1);
  }
  await expectSublayersFollow(map);

  // Lifted by a Height adjustment once its tiles have loaded, the drawn tiles
  // go up with the tileset rather than staying where they were drawn first.
  const [before] = await drawnTiles(map);
  await setHeightAdjustment(map, 500);
  await expect.poll(() => tilesetShift(map), { timeout: 30_000 }).toBeLessThan(CITY_BOX_GROUND - 500 + 30);
  await expect
    .poll(async () => Math.max(...(await drawnTiles(map)).map((tile) => tile.drift)), { timeout: 30_000 })
    .toBeLessThan(1);
  const [after] = await drawnTiles(map);
  expect(after.height - before.height).toBeCloseTo(500, 0);
  await expectSublayersFollow(map);

  // And when the ground under the view changes with nothing else, the drawn
  // tiles follow too.
  await raiseCityGround(map, 300);
  await expect.poll(() => tilesetShift(map), { timeout: 30_000 }).toBeGreaterThan(CITY_BOX_GROUND + 300 - 500 - 1);
  expect(await tilesetShift(map)).toBeLessThan(CITY_BOX_GROUND + 300 - 500 + 1);
  await expectSublayersFollow(map);
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
