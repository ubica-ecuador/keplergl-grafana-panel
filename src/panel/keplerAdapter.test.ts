import type { Store } from 'redux';

import type { RasterDataset } from '../data/rasterDataset';
import { KEPLER_INSTANCE_ID } from './constants';
import { reconcileRasterLayerType, refreshRasters, swapRasterScene } from './keplerAdapter';

const ITEM = 'https://earth-search.aws.element84.com/v1/collections/sentinel-2-l2a/items/S2C_10SEJ_20260913_0_L2A';

function raster(overrides: Partial<RasterDataset>): RasterDataset {
  return {
    id: 'grafana-A-raster',
    label: 'A',
    kind: 'cog',
    sourceUrl: 'https://bucket.example/scene.tif',
    metadataUrl: 'https://titiler.test/cog/stac?url=…',
    tileServerUrls: ['https://titiler.test'],
    scenes: [],
    ...overrides,
  };
}

/**
 * A store minimal enough for `swapRasterScene`'s `painted` branch, which reads
 * only `visState.layers` looking for the layer drawing `dataId` — see
 * `applyLayerVisConfig` in `keplerAdapter.ts`. `datasets` is included empty so
 * the same shape can be reused where a function reads both.
 */
function fakeStore(opts: {
  layers?: Array<{ id: string; type?: string; dataId?: string; visConfig?: Record<string, unknown> }>;
  datasets?: Record<string, { type?: string; metadata?: Record<string, unknown> }>;
}): Store {
  return {
    getState: () => ({
      keplerGl: {
        [KEPLER_INSTANCE_ID]: {
          visState: {
            layers: (opts.layers ?? []).map((layer) => ({
              id: layer.id,
              type: layer.type,
              config: { dataId: layer.dataId, visConfig: layer.visConfig ?? {} },
            })),
            datasets: opts.datasets ?? {},
          },
        },
      },
    }),
  } as unknown as Store;
}

describe('swapRasterScene', () => {
  // The point the review traced: an item's scenes differ in every asset href
  // and often in bbox, so no in-place patch can express the change — only a
  // rebuild draws the scene actually asked for. A future edit that lets
  // `stac` fall through to the COG branch below must fail this.
  it('refuses the in-place swap for a stac raster, so the caller rebuilds instead', () => {
    const dispatch = jest.fn();
    // A store that *would* satisfy the COG branch if `stac` fell through to
    // it, so the assertion is meaningful: nothing here should be reached.
    const store = fakeStore({
      layers: [{ id: 'layer-1', dataId: 'grafana-A-raster' }],
      datasets: { 'grafana-A-raster': { metadata: { assets: { visual: { href: 'https://old' } } } } },
    });

    const result = swapRasterScene(store, dispatch, raster({ kind: 'stac', sourceUrl: `${ITEM}-2` }));

    expect(result).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });

  // Kept beside the stac case on purpose: an archive refuses for a different
  // reason (deck's PMTiles branch has no trigger this module can move), but
  // the two must stand or fall together in the reader's mind, and in a diff.
  // Rigged with the same store the stac case uses, for the same reason: a
  // store with nothing in it would pass this even if the guard vanished,
  // because the COG branch below would then fail on its own missing dataset.
  it('refuses the in-place swap for a pmtiles raster too', () => {
    const dispatch = jest.fn();
    const store = fakeStore({
      layers: [{ id: 'layer-1', dataId: 'grafana-A-raster' }],
      datasets: { 'grafana-A-raster': { metadata: { assets: { visual: { href: 'https://old' } } } } },
    });

    const result = swapRasterScene(store, dispatch, raster({ kind: 'pmtiles' }));

    expect(result).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('swaps a painted composite in place by parking the new scene in visConfig', () => {
    const dispatch = jest.fn();
    const store = fakeStore({ layers: [{ id: 'layer-1', dataId: 'grafana-A-raster' }] });

    const result = swapRasterScene(store, dispatch, raster({ kind: 'painted', sourceUrl: `${ITEM}-2` }));

    expect(result).toBe(true);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });
});

describe('reconcileRasterLayerType', () => {
  // The live failure this exists for: a dashboard saved its Sentinel-2 map with
  // a `rasterTile` layer over the true-colour scene, then the band dropdown
  // asked for a composite the tile server paints — a `cogPainted` dataset. The
  // saved layer merged onto it without complaint (kepler's
  // `validateLayerWithData` never checks that a layer can draw the dataset it
  // is bound to) and then requested nothing at all: no tiles, no item, no
  // error. A blank map.
  it('retypes a saved rasterTile layer once its dataset became a painted composite', () => {
    const dispatch = jest.fn();
    const store = fakeStore({
      layers: [{ id: 's2scene', type: 'rasterTile', dataId: 'grafana-B-raster' }],
      datasets: { 'grafana-B-raster': { type: 'cogPainted' } },
    });

    const result = reconcileRasterLayerType(store, dispatch, 'grafana-B-raster');

    expect(result).toBe(true);
    expect(dispatch).toHaveBeenCalledTimes(1);
    // `wrapTo` parcels the action into `payload`, addressed to this panel's
    // kepler instance; the retype itself is what the assertion is about.
    expect(dispatch.mock.calls[0][0].payload).toMatchObject({ newType: 'cogPainted', oldLayer: { id: 's2scene' } });
  });

  // The way back matters as much: switching the dropdown from a composite to
  // true colour or to an index leaves a `cogPainted` layer over a dataset
  // kepler itself must draw, which is the same silence in the other direction.
  it('retypes a painted layer back to kepler own raster layer when the dataset is a scene again', () => {
    const dispatch = jest.fn();
    const store = fakeStore({
      layers: [{ id: 's2scene', type: 'cogPainted', dataId: 'grafana-B-raster' }],
      datasets: { 'grafana-B-raster': { type: 'raster-tile' } },
    });

    const result = reconcileRasterLayerType(store, dispatch, 'grafana-B-raster');

    expect(result).toBe(true);
    expect(dispatch.mock.calls[0][0].payload).toMatchObject({ newType: 'rasterTile' });
  });

  // This runs on every store change, so the ordinary case must be silent:
  // retyping a layer mints a new one, and doing that in a loop would rebuild
  // the map forever.
  it('dispatches nothing when the layer already draws what the dataset is', () => {
    const dispatch = jest.fn();
    const store = fakeStore({
      layers: [{ id: 's2scene', type: 'rasterTile', dataId: 'grafana-B-raster' }],
      datasets: { 'grafana-B-raster': { type: 'raster-tile' } },
    });

    expect(reconcileRasterLayerType(store, dispatch, 'grafana-B-raster')).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('leaves alone a dataset kepler holds under neither raster type', () => {
    const dispatch = jest.fn();
    // A tileset the user added by hand, or a dataset of rows: the panel has no
    // opinion about which layer should draw it.
    const store = fakeStore({
      layers: [{ id: 'someone-elses', type: 'vectorTile', dataId: 'grafana-B-raster' }],
      datasets: { 'grafana-B-raster': { type: 'vector-tile' } },
    });

    expect(reconcileRasterLayerType(store, dispatch, 'grafana-B-raster')).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('waits rather than acting before kepler has built the layer', () => {
    const dispatch = jest.fn();
    const store = fakeStore({ datasets: { 'grafana-B-raster': { type: 'cogPainted' } } });

    expect(reconcileRasterLayerType(store, dispatch, 'grafana-B-raster')).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });
});

describe('refreshRasters — the no-op the review traced', () => {
  // `splitRasterRefresh` (loadDecision.ts) compares `metadataUrl`, not object
  // identity, so a re-query that hands back the very same scene lands in
  // `keep` and nothing is dispatched — which is what makes the repeated
  // `swapRasterScene` -> `refreshRasters` fallback harmless on every
  // reconcile of an unchanged stac raster, rather than a redraw loop.
  it('dispatches nothing for a stac raster whose scene has not changed', () => {
    const dispatch = jest.fn();
    // 'raster-tile' mirrors keplerAdapter's own (unexported) RASTER_TILE_TYPE
    // — the type a `stac` raster's dataset is stored under.
    const store = fakeStore({
      datasets: { 'grafana-A-raster': { type: 'raster-tile', metadata: { metadataUrl: ITEM } } },
    });

    refreshRasters(store, dispatch, [raster({ kind: 'stac', sourceUrl: ITEM, metadataUrl: ITEM })]);

    expect(dispatch).not.toHaveBeenCalled();
  });
});
