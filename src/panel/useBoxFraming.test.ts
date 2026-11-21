import { renderHook } from '@testing-library/react';
import type { Store } from 'redux';

import type { SavedMapConfig } from '../data/mapConfig';
import type { WmsDataset } from '../data/wmsDataset';
import type { XyzDataset } from '../data/xyzDataset';
import { KEPLER_INSTANCE_ID } from './constants';
import { boxedWms, boxedXyz, useBoxFraming } from './useBoxFraming';

const FRANCE: [number, number, number, number] = [-5.5, 41, 10, 51.5];

const wms = (more: Partial<WmsDataset> = {}): WmsDataset => ({
  id: 'grafana-A-wms',
  label: 'Cassini',
  serviceUrl: 'https://data.geopf.fr/wms-r/wms',
  layerName: 'AN-IGNF_GEOGRAPHICALGRIDSYSTEMS.CASSINI',
  times: [],
  bbox: FRANCE,
  ...more,
});

const savedOver = (latitude: number, longitude: number, zoom: number) =>
  ({ config: { mapState: { latitude, longitude, zoom } } }) as unknown as SavedMapConfig;

/** Cuenca, Ecuador: where the dashboard's view was saved. */
const CUENCA = { latitude: -2.9, longitude: -79, zoom: 12 };

/**
 * A store as far as the hook reads it: kepler's layers (one per dataset id
 * given), the map's view, and every action dispatched.
 */
function fakeStore(mapState: Record<string, number>, layerOn: string[] = ['grafana-A-wms']) {
  const listeners = new Set<() => void>();
  const state = {
    keplerGl: {
      [KEPLER_INSTANCE_ID]: {
        visState: { layers: layerOn.map((dataId) => ({ config: { dataId } })), datasets: {} },
        mapState: { width: 800, height: 600, ...mapState },
      },
    },
  };
  const dispatched: any[] = [];
  const store = {
    getState: () => state,
    dispatch: (action: unknown) => {
      dispatched.push(action);
      return action;
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  } as unknown as Store;
  const emit = () => listeners.forEach((listener) => listener());
  return { store, state, dispatched, emit };
}

/** The bounds of every fitBounds the hook dispatched, through kepler's instance wrapper. */
const fits = (dispatched: any[]) =>
  dispatched.map((action) => action?.payload?.payload ?? action?.payload).filter((p) => Array.isArray(p));

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
}

describe('useBoxFraming', () => {
  it('frames a layer the saved view shows none of, and tells the guard', async () => {
    const { store, dispatched } = fakeStore(CUENCA);
    const onFramed = jest.fn();
    renderHook(() =>
      useBoxFraming({
        store,
        isReady: true,
        layers: [wms()].map(boxedWms),
        mapConfig: savedOver(-2.9, -79, 12),
        onFramed,
      })
    );
    await settle();

    expect(fits(dispatched)).toEqual([FRANCE]);
    expect(onFramed).toHaveBeenCalledWith({ bounds: FRANCE });
  });

  it('leaves a saved view that shows part of the layer', async () => {
    const paris = { latitude: 48.85, longitude: 2.35, zoom: 8 };
    const { store, dispatched } = fakeStore(paris);
    renderHook(() =>
      useBoxFraming({
        store,
        isReady: true,
        layers: [wms()].map(boxedWms),
        mapConfig: savedOver(48.85, 2.35, 8),
        onFramed: jest.fn(),
      })
    );
    await settle();

    expect(fits(dispatched)).toEqual([]);
  });

  it('frames a map with no saved view', async () => {
    const { store, dispatched } = fakeStore({ latitude: 48.85, longitude: 2.35, zoom: 8 });
    renderHook(() =>
      useBoxFraming({ store, isReady: true, layers: [wms()].map(boxedWms), mapConfig: null, onFramed: jest.fn() })
    );
    await settle();

    expect(fits(dispatched)).toEqual([FRANCE]);
  });

  it('frames a layer once: a refresh that brings it back moves nothing', async () => {
    const { store, dispatched, emit } = fakeStore(CUENCA);
    const props = { store, isReady: true, mapConfig: savedOver(-2.9, -79, 12), onFramed: jest.fn() };
    const { rerender } = renderHook(
      (layers: WmsDataset[]) => useBoxFraming({ ...props, layers: layers.map(boxedWms) }),
      {
        initialProps: [wms()],
      }
    );
    await settle();
    // The user pans back to Cuenca; the dashboard refreshes the same layer.
    rerender([wms({ times: [1, 2] })]);
    emit();
    await settle();

    expect(fits(dispatched)).toEqual([FRANCE]);

    // Another layer from the same query is a new layer, and is asked again.
    rerender([wms({ layerName: 'OTHER', bbox: [-9.5, 36, 3.3, 43.8] })]);
    await settle();
    expect(fits(dispatched)).toEqual([FRANCE, [-9.5, 36, 3.3, 43.8]]);
  });

  it('waits for kepler’s own layer, then frames', async () => {
    const { store, state, dispatched, emit } = fakeStore(CUENCA, []);
    renderHook(() =>
      useBoxFraming({
        store,
        isReady: true,
        layers: [wms()].map(boxedWms),
        mapConfig: savedOver(-2.9, -79, 12),
        onFramed: jest.fn(),
      })
    );
    await settle();
    expect(fits(dispatched)).toEqual([]);

    state.keplerGl[KEPLER_INSTANCE_ID].visState.layers = [{ config: { dataId: 'grafana-A-wms' } }];
    emit();
    await settle();
    expect(fits(dispatched)).toEqual([FRANCE]);
  });

  it('does nothing for a layer with no box', async () => {
    const { store, dispatched } = fakeStore(CUENCA);
    renderHook(() =>
      useBoxFraming({
        store,
        isReady: true,
        layers: [wms({ bbox: null })].map(boxedWms),
        mapConfig: null,
        onFramed: jest.fn(),
      })
    );
    await settle();

    expect(fits(dispatched)).toEqual([]);
  });

  it('frames a query’s tiles out of the saved view’s sight, once per template', async () => {
    const netherlands: [number, number, number, number] = [3.2, 50.7, 7.3, 53.6];
    const tiles = (url: string): XyzDataset => ({ id: 'grafana-B-tiles', label: 'PDOK', url, bbox: netherlands });
    const { store, dispatched, emit } = fakeStore(CUENCA, ['grafana-B-tiles']);
    const props = { store, isReady: true, mapConfig: savedOver(-2.9, -79, 12), onFramed: jest.fn() };
    const { rerender } = renderHook(
      (layers: XyzDataset[]) => useBoxFraming({ ...props, layers: layers.map(boxedXyz) }),
      {
        initialProps: [tiles('https://pdok.test/{z}/{x}/{y}.png')],
      }
    );
    await settle();
    expect(fits(dispatched)).toEqual([netherlands]);

    rerender([tiles('https://pdok.test/{z}/{x}/{y}.png')]);
    emit();
    await settle();
    expect(fits(dispatched)).toEqual([netherlands]);
  });

  it('frames tiles no further out than their first level, on the box’s centre', async () => {
    // IGN's WMTS of France starts at 6: kepler's fit of its box lands at 5.35, where it has no tile.
    const ign: [number, number, number, number] = [-5.15, 41.33, 9.57, 51.1];
    const tiles: XyzDataset = {
      id: 'grafana-B-tiles',
      label: 'IGN',
      url: 'https://data.geopf.fr/wmts/{z}/{x}/{y}',
      minZoom: 6,
      maxZoom: 16,
      bbox: ign,
    };
    // The fake store applies no action: it reads as kepler's fit had left it.
    const { store, dispatched } = fakeStore({ latitude: 46.2, longitude: 2.2, zoom: 5.35 }, ['grafana-B-tiles']);
    const onFramed = jest.fn();
    renderHook(() => useBoxFraming({ store, isReady: true, layers: [boxedXyz(tiles)], mapConfig: null, onFramed }));
    await settle();

    expect(fits(dispatched)).toEqual([ign]);
    const views = dispatched.map((action) => action?.payload?.payload?.viewport).filter(Boolean);
    expect(views).toEqual([
      expect.objectContaining({ zoom: 6, latitude: expect.closeTo(46.215, 3), longitude: expect.closeTo(2.21, 3) }),
    ]);
    expect(onFramed).toHaveBeenCalledWith({ bounds: ign, minZoom: 6 });
  });

  it('leaves the zoom of a fit that already shows the first level', async () => {
    const tiles: XyzDataset = {
      id: 'grafana-B-tiles',
      label: 'PDOK',
      url: 'https://t/{z}/{x}/{y}',
      minZoom: 6,
      bbox: [3, 50, 7, 54],
    };
    const { store, dispatched } = fakeStore({ latitude: 52, longitude: 5, zoom: 6.8 }, ['grafana-B-tiles']);
    renderHook(() =>
      useBoxFraming({ store, isReady: true, layers: [boxedXyz(tiles)], mapConfig: null, onFramed: jest.fn() })
    );
    await settle();

    expect(fits(dispatched)).toEqual([[3, 50, 7, 54]]);
    expect(dispatched).toHaveLength(1);
  });

  it('frames a WMS and tiles arriving together on the union of their boxes', async () => {
    const tiles: XyzDataset = {
      id: 'grafana-B-tiles',
      label: 'PDOK',
      url: 'https://t/{z}/{x}/{y}',
      bbox: [3, 50, 7, 54],
    };
    const { store, dispatched } = fakeStore(CUENCA, ['grafana-A-wms', 'grafana-B-tiles']);
    renderHook(() =>
      useBoxFraming({
        store,
        isReady: true,
        layers: [boxedWms(wms()), boxedXyz(tiles)],
        mapConfig: savedOver(-2.9, -79, 12),
        onFramed: jest.fn(),
      })
    );
    await settle();

    expect(fits(dispatched)).toEqual([[-5.5, 41, 10, 54]]);
  });
});
