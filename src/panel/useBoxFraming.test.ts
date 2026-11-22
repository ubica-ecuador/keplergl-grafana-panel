import { renderHook } from '@testing-library/react';
import type { Store } from 'redux';

import type { EsriDataset } from '../data/esriDataset';
import type { SavedMapConfig } from '../data/mapConfig';
import type { WmsDataset } from '../data/wmsDataset';
import type { XyzDataset } from '../data/xyzDataset';
import { KEPLER_INSTANCE_ID } from './constants';
import { boxedEsri, boxedWms, boxedXyz, useBoxFraming } from './useBoxFraming';

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

  it('leaves the view when a query’s tiles change style: another template of the layer its frame names', async () => {
    const germany: [number, number, number, number] = [5.8, 47.2, 15.1, 55.1];
    const style = (name: string): XyzDataset => ({
      id: 'grafana-B-tiles',
      label: 'Länder',
      url: `https://maps.dwd.de/geoserver/gwc/service/wmts/rest/dwd:Laender/${name}/EPSG:900913/{z}/{y}/{x}`,
      bbox: germany,
      layerKey: 'dwd:Laender',
    });
    // No saved view: a layer seen for the first time is framed whatever the map shows.
    const { store, dispatched, emit } = fakeStore({ latitude: 48.85, longitude: 2.35, zoom: 8 }, ['grafana-B-tiles']);
    const { rerender } = renderHook(
      (layers: XyzDataset[]) =>
        useBoxFraming({ store, isReady: true, mapConfig: null, onFramed: jest.fn(), layers: layers.map(boxedXyz) }),
      { initialProps: [style('Laender_ocker')] }
    );
    await settle();
    expect(fits(dispatched)).toEqual([germany]);

    rerender([style('Laender_grau')]);
    emit();
    await settle();
    expect(fits(dispatched)).toEqual([germany]);

    // Another layer is framed again.
    rerender([{ ...style('Laender_grau'), layerKey: 'dwd:Kreise' }]);
    emit();
    await settle();
    expect(fits(dispatched)).toEqual([germany, germany]);
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

  it('frames an ArcGIS service on its box, once per endpoint', async () => {
    const zeeland: [number, number, number, number] = [3.7539, 51.638, 5.0329, 52.3354];
    const esri = (more: Partial<EsriDataset> = {}): EsriDataset => ({
      id: 'grafana-C-esri',
      label: 'services',
      serviceUrl: 'https://geo.example.nl/arcgis/rest/services/Zeeland/MapServer',
      bbox: zeeland,
      ...more,
    });
    // kepler's default view, San Francisco: the map has no view of its own.
    const { store, dispatched, emit } = fakeStore({ latitude: 37.75, longitude: -122.35, zoom: 9 }, ['grafana-C-esri']);
    const { rerender } = renderHook(
      (layers: EsriDataset[]) =>
        useBoxFraming({ store, isReady: true, layers: layers.map(boxedEsri), mapConfig: null, onFramed: jest.fn() }),
      { initialProps: [esri()] }
    );
    await settle();
    expect(fits(dispatched)).toEqual([zeeland]);

    // Another year of the same service is the same layer.
    rerender([esri({ mosaicRule: '{"where":"Year=2023"}' })]);
    emit();
    await settle();
    expect(fits(dispatched)).toEqual([zeeland]);
  });

  it('leaves an ArcGIS service the saved view shows, and one with no box', async () => {
    const { store, dispatched } = fakeStore({ latitude: 52, longitude: 4.4, zoom: 9 }, ['grafana-C-esri']);
    const service: EsriDataset = { id: 'grafana-C-esri', label: 'services', serviceUrl: 'https://x/MapServer' };
    renderHook(() =>
      useBoxFraming({
        store,
        isReady: true,
        layers: [boxedEsri({ ...service, bbox: [3.7539, 51.638, 5.0329, 52.3354] })],
        mapConfig: savedOver(52, 4.4, 9),
        onFramed: jest.fn(),
      })
    );
    renderHook(() =>
      useBoxFraming({ store, isReady: true, layers: [boxedEsri(service)], mapConfig: null, onFramed: jest.fn() })
    );
    await settle();

    expect(fits(dispatched)).toEqual([]);
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

describe('box framing identities', () => {
  it('is the same layer in another style, so a style change does not reframe', () => {
    expect(boxedWms(wms({ style: 'rain_contours' })).identity).toBe(boxedWms(wms({ style: 'rain_classes' })).identity);
  });

  it('is the same tiles layer under another template when its frame names the layer, and another without', () => {
    const tiles = (url: string, layerKey?: string): XyzDataset => ({
      id: 'grafana-A-tiles',
      label: 'Länder',
      url,
      bbox: null,
      ...(layerKey ? { layerKey } : {}),
    });
    const ocker = 'https://maps.dwd.test/Laender_ocker/{z}/{y}/{x}';
    const grau = 'https://maps.dwd.test/Laender_grau/{z}/{y}/{x}';

    expect(boxedXyz(tiles(ocker, 'dwd:Laender')).identity).toBe(boxedXyz(tiles(grau, 'dwd:Laender')).identity);
    expect(boxedXyz(tiles(ocker)).identity).not.toBe(boxedXyz(tiles(grau)).identity);
  });

  it('is the same service under another rendering rule, so a rule change does not reframe', () => {
    const service: EsriDataset = {
      id: 'grafana-A-esri',
      label: 'Landsat',
      serviceUrl: 'https://landsat2.arcgis.com/arcgis/rest/services/Landsat/MS/ImageServer',
      bbox: FRANCE,
    };

    expect(boxedEsri({ ...service, renderingRule: '{"rasterFunction":"NDVI Colorized"}' }).identity).toBe(
      boxedEsri(service).identity
    );
  });
});
