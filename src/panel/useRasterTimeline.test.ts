import { act, renderHook } from '@testing-library/react';
import type { Store } from 'redux';

import type { RasterDataset } from '../data/rasterDataset';
import { applyRasterStyle, ensureTimeFilter, reconcileRasterLayerType } from './keplerAdapter';
import { rasterDressKey, useRasterTimeline } from './useRasterTimeline';

// The whole kepler side stubbed: what these tests are about is which of it the
// reconcile reaches for a series with no dates, not what kepler then does.
jest.mock('./keplerAdapter', () => ({
  applyRasterStyle: jest.fn(() => true),
  ensureTimeFilter: jest.fn(() => false),
  isTimeFilterAnimating: jest.fn(() => false),
  pushTimeRange: jest.fn(),
  readSyncSlices: jest.fn(() => ({})),
  readTimeDomain: jest.fn(() => null),
  readTimeRange: jest.fn(() => null),
  reconcileRasterLayerType: jest.fn(() => false),
  refreshRasters: jest.fn(),
  setRasterLayerVisible: jest.fn(() => true),
  swapRasterScene: jest.fn(() => false),
}));

jest.mock('@grafana/runtime', () => ({
  locationService: { partial: jest.fn(), getSearch: () => new URLSearchParams() },
}));

function raster(overrides: Partial<RasterDataset>): RasterDataset {
  return {
    id: 'grafana-A-raster',
    label: 'A',
    kind: 'stac',
    sourceUrl: 'https://item',
    metadataUrl: 'https://item',
    tileServerUrls: ['https://titiler.test'],
    scenes: [],
    ...overrides,
  };
}

describe('rasterDressKey', () => {
  it('gives no key before the layer exists yet, so nothing is dispatched too early', () => {
    expect(rasterDressKey(raster({ preset: 'nbr', colormap: 'rdylgn' }), null)).toBeNull();
  });

  it('gives no key for a raster with no style of its own — true colour, nothing to dress', () => {
    expect(rasterDressKey(raster({ kind: 'cog', preset: undefined, colormap: undefined }), 'layer-1')).toBeNull();
  });

  it('gives no key for an archive, even one that somehow carried a colormap', () => {
    // Archives arrive as finished pictures; kepler's colormap has nothing to
    // act on regardless of what the raster's own fields say.
    expect(rasterDressKey(raster({ kind: 'pmtiles', colormap: 'blues' }), 'layer-1')).toBeNull();
  });

  it('gives no key for a painted composite, even one that somehow carried a colormap', () => {
    expect(rasterDressKey(raster({ kind: 'painted', colormap: 'blues' }), 'layer-1')).toBeNull();
  });

  it('gives a key once a layer exists and the raster carries a style', () => {
    expect(rasterDressKey(raster({ preset: 'nbr', colormap: 'rdylgn' }), 'layer-1')).toBe('layer-1|nbr|rdylgn');
  });

  it('gives the same key again for the same raster and layer, so a reconcile with nothing changed does not redress', () => {
    const nbr = raster({ preset: 'nbr', colormap: 'rdylgn' });

    const dressed = new Set<string>();
    const first = rasterDressKey(nbr, 'layer-1');
    expect(first).not.toBeNull();
    dressed.add(first as string);

    // A later reconcile, same raster, same layer — the ordinary case, which
    // happens on every store change until something actually moves.
    const second = rasterDressKey(nbr, 'layer-1');
    expect(second).toBe(first);
    expect(dressed.has(second as string)).toBe(true);
  });

  it('gives a different key when the band combination changes the preset and ramp, so the new style is not skipped as already dressed', () => {
    const dressed = new Set<string>();
    const nbrKey = rasterDressKey(raster({ preset: 'nbr', colormap: 'rdylgn' }), 'layer-1');
    dressed.add(nbrKey as string);

    // The user (or a dashboard variable) switches the dropdown from NBR to
    // NDMI on the same query: same layer, different style.
    const ndmiKey = rasterDressKey(raster({ preset: 'ndmi', colormap: 'rdylbu' }), 'layer-1');

    expect(ndmiKey).not.toBe(nbrKey);
    expect(dressed.has(ndmiKey as string)).toBe(false);
  });
});

/** A store holding one layer for the raster, which is all the hook reads here. */
function fakeStore(layers: Array<{ id: string; dataId: string }>): Store {
  return {
    getState: () => ({
      keplerGl: {
        grafana: {
          visState: {
            layers: layers.map((layer) => ({ id: layer.id, config: { dataId: layer.dataId } })),
            datasets: {},
          },
        },
      },
    }),
    subscribe: () => () => undefined,
    dispatch: jest.fn(),
  } as unknown as Store;
}

/** One reconcile: the hook schedules it on a microtask, never synchronously. */
async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('useRasterTimeline — the layer is reconciled whether or not the series is dated', () => {
  beforeEach(() => jest.clearAllMocks());

  // The live failure this exists for: the Sentinel-2 scene query emits its
  // dates as text on purpose (a time-typed field would give kepler a second,
  // conflicting scene selector), so its series is undated by design — and the
  // styling used to sit behind the dated check, so every index drew true
  // colour: the right tiles were requested, with the saved layer's preset.
  it('dresses an undated raster with the preset and ramp its band combination asks for', async () => {
    const store = fakeStore([{ id: 's2scene', dataId: 'grafana-A-raster' }]);
    const nbr = raster({
      preset: 'nbr',
      colormap: 'rdylgn',
      scenes: [{ time: null, sourceUrl: 'https://item', itemUrl: 'https://item' }],
    });

    renderHook(() => useRasterTimeline({ store, isReady: true, rasters: [nbr], timeVariables: null }));
    await settle();

    expect(applyRasterStyle).toHaveBeenCalledWith(store, store.dispatch, 'grafana-A-raster', {
      colormapId: 'rdylgn',
      preset: 'nbr',
    });
  });

  it('asks for the layer type to be reconciled too, dates or no dates', async () => {
    const store = fakeStore([{ id: 's2scene', dataId: 'grafana-A-raster' }]);
    const painted = raster({
      kind: 'painted',
      assets: ['swir22', 'nir', 'blue'],
      scenes: [{ time: null, sourceUrl: 'https://item', itemUrl: 'https://item' }],
    });

    renderHook(() => useRasterTimeline({ store, isReady: true, rasters: [painted], timeVariables: null }));
    await settle();

    expect(reconcileRasterLayerType).toHaveBeenCalledWith(store, store.dispatch, 'grafana-A-raster');
  });

  // The other half of the same change: the clock is still for dated series
  // only. An undated query is a single answer, and giving kepler a time filter
  // for it would put a widget on the map with one notch on it.
  it('leaves the map clock alone for an undated series', async () => {
    const store = fakeStore([{ id: 's2scene', dataId: 'grafana-A-raster' }]);
    const undated = raster({
      preset: 'nbr',
      colormap: 'rdylgn',
      scenes: [{ time: null, sourceUrl: 'https://item', itemUrl: 'https://item' }],
    });

    renderHook(() => useRasterTimeline({ store, isReady: true, rasters: [undated], timeVariables: null }));
    await settle();

    expect(ensureTimeFilter).not.toHaveBeenCalled();
  });

  it('still reaches the clock for a dated series', async () => {
    const store = fakeStore([{ id: 's2scene', dataId: 'grafana-A-raster' }]);
    const dated = raster({
      scenes: [{ time: 1_757_000_000_000, sourceUrl: 'https://item', itemUrl: 'https://item' }],
    });

    renderHook(() => useRasterTimeline({ store, isReady: true, rasters: [dated], timeVariables: null }));
    await settle();

    expect(ensureTimeFilter).toHaveBeenCalled();
  });
});
