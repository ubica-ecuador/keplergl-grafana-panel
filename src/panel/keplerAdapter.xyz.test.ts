import { registerEntry, updateMap, wrapTo } from '@kepler.gl/actions';

import { KEPLER_INSTANCE_ID } from './constants';
import {
  captureMapConfig,
  fitMapToBox,
  loadDatasets,
  loadXyz,
  readMapState,
  refreshXyz,
  xyzProtoDataset,
} from './keplerAdapter';
import { createKeplerStore } from './keplerStore';
import { xyzSavedDataset } from '../data/xyzTiles';
import type { XyzDataset } from '../data/xyzDataset';

/**
 * A query's tiles on kepler's real store: a dataset of the panel's XYZ type
 * with its layer, rebuilt from the query and so never saved with the map,
 * where a Geomap's XYZ layer of the same type is.
 */

const PDOK: XyzDataset = {
  id: 'grafana-A-tiles',
  label: 'services',
  url: 'https://service.pdok.nl/brt/achtergrondkaart/wmts/v2_0/standaard/EPSG:3857/{z}/{x}/{y}.png',
  maxZoom: 8,
  zoomIds: { 8: '08' },
  bbox: [3.2, 50.7, 7.3, 53.6],
};

/** kepler's data pipeline settles on the task middleware's promises. */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function newMap() {
  const store = createKeplerStore();
  store.dispatch(registerEntry({ id: KEPLER_INSTANCE_ID }));
  return store;
}

type VisState = {
  datasets: Record<string, { type?: string; metadata?: Record<string, unknown> }>;
  layers: Array<{ type: string; config: { dataId: string } }>;
};
const visStateOf = (store: ReturnType<typeof newMap>) =>
  (store.getState() as { keplerGl: Record<string, { visState: VisState }> }).keplerGl[KEPLER_INSTANCE_ID].visState;

describe('a query’s tiles on the map', () => {
  it('become an XYZ dataset carrying the levels’ names and the box, with its layer', async () => {
    const store = newMap();
    loadXyz(store.dispatch, [PDOK]);
    await settle();

    const { datasets, layers } = visStateOf(store);
    expect(datasets['grafana-A-tiles']).toMatchObject({
      type: 'xyz-tiles',
      metadata: { url: PDOK.url, maxZoom: 8, zoomIds: { 8: '08' }, tilesBbox: [3.2, 50.7, 7.3, 53.6] },
    });
    expect(layers.filter((l) => l.config.dataId === 'grafana-A-tiles').map((l) => l.type)).toEqual(['xyz-tiles']);
  });

  it('are left out of a save, and a Geomap’s XYZ layer is not', async () => {
    const store = newMap();
    loadDatasets(
      store,
      store.dispatch,
      [],
      {},
      {
        version: 'v1',
        config: {},
        datasets: [xyzSavedDataset('geomap-xyz-0', 'OSM', { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png' })],
      }
    );
    await settle();
    loadXyz(store.dispatch, [PDOK]);
    await settle();

    expect(captureMapConfig(store)?.datasets?.map((d) => d.data.id)).toEqual(['geomap-xyz-0']);
  });

  it('are rebuilt when the query names another service, and dropped when it names none', async () => {
    const store = newMap();
    loadXyz(store.dispatch, [PDOK]);
    await settle();

    const other = { ...PDOK, url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', zoomIds: undefined };
    refreshXyz(store, store.dispatch, [other]);
    await settle();
    const metadata = visStateOf(store).datasets['grafana-A-tiles'].metadata;
    expect(metadata).toMatchObject({ url: other.url, maxZoom: 8, tilesBbox: PDOK.bbox });
    expect(metadata).not.toHaveProperty('zoomIds');

    refreshXyz(store, store.dispatch, []);
    await settle();
    expect(visStateOf(store).datasets['grafana-A-tiles']).toBeUndefined();
  });
});

describe('a query’s tiles with a legend', () => {
  /** DWD's states as a GeoWebCache WMTS: each style its own template and its own legend. */
  const style = (name: string): XyzDataset => ({
    id: 'grafana-A-tiles',
    label: 'Länder',
    url: `https://maps.dwd.de/geoserver/gwc/service/wmts/rest/dwd:Laender/${name}/EPSG:900913/EPSG:900913:{z}/{y}/{x}?format=image/png`,
    bbox: [5.8, 47.2, 15.1, 55.1],
    legendUrl: `https://maps.dwd.de/geoserver/ows?service=WMS&request=GetLegendGraphic&format=image/png&layer=dwd:Laender&style=${name}`,
    layerKey: 'dwd:Laender',
  });
  type LegendLayer = { id: string; config: { dataId: string }; getLegendImageUrl(): string | null };
  const tilesLayers = (store: ReturnType<typeof newMap>) =>
    (visStateOf(store).layers as unknown as LegendLayer[]).filter((l) => l.config.dataId === 'grafana-A-tiles');

  it('hand kepler’s map legend the picture of their legend_url', async () => {
    const store = newMap();
    loadXyz(store.dispatch, [style('Laender_ocker')]);
    await settle();

    expect(visStateOf(store).datasets['grafana-A-tiles'].metadata).toMatchObject({
      legendUrl: style('Laender_ocker').legendUrl,
    });
    expect(tilesLayers(store).map((l) => l.getLegendImageUrl())).toEqual([style('Laender_ocker').legendUrl]);
  });

  it('draw another style’s tiles with its legend, on the same layer and in the same view', async () => {
    const store = newMap();
    loadXyz(store.dispatch, [style('Laender_ocker')]);
    await settle();
    fitMapToBox(store, store.dispatch, { bounds: [5.8, 47.2, 15.1, 55.1] });
    await settle();
    const [before] = tilesLayers(store);
    const view = readMapState(store);

    refreshXyz(store, store.dispatch, [style('Laender_grau')]);
    await settle();

    expect(visStateOf(store).datasets['grafana-A-tiles'].metadata).toMatchObject({
      url: style('Laender_grau').url,
      legendUrl: style('Laender_grau').legendUrl,
    });
    const after = tilesLayers(store);
    expect(after.map((l) => l.id)).toEqual([before.id]);
    expect(after[0].getLegendImageUrl()).toBe(style('Laender_grau').legendUrl);
    expect(readMapState(store)).toEqual(view);
  });

  it('rebuild on a new legend alone, and carry none without one', async () => {
    const store = newMap();
    loadXyz(store.dispatch, [{ ...style('Laender_ocker'), legendUrl: undefined }]);
    await settle();
    expect(visStateOf(store).datasets['grafana-A-tiles'].metadata).not.toHaveProperty('legendUrl');
    expect(tilesLayers(store)[0].getLegendImageUrl()).toBeNull();

    refreshXyz(store, store.dispatch, [style('Laender_ocker')]);
    await settle();
    expect(tilesLayers(store)[0].getLegendImageUrl()).toBe(style('Laender_ocker').legendUrl);
  });

  it('show no ArcGIS legend JSON as a picture', async () => {
    const store = newMap();
    loadXyz(store.dispatch, [
      {
        ...style('Laender_ocker'),
        legendUrl: 'https://services.arcgisonline.com/arcgis/rest/services/World_Topo_Map/MapServer/legend',
      },
    ]);
    await settle();
    expect(tilesLayers(store)[0].getLegendImageUrl()).toBeNull();
  });
});

describe('a query’s vector tiles and archives on the map', () => {
  const BAG: XyzDataset = {
    id: 'grafana-A-tiles',
    label: '3D BAG',
    url: 'https://tiles.test/3dbag/{z}/{x}/{y}.mvt',
    format: 'mvt',
    metadataUrl: 'https://tiles.test/3dbag.json',
    minZoom: 10,
    maxZoom: 15,
    bbox: [3.2, 50.7, 7.3, 53.6],
  };
  const ARCHIVE: XyzDataset = {
    id: 'grafana-B-tiles',
    label: 'Manzanero',
    url: 'https://data.test/manzanero.pmtiles',
    format: 'pmtiles',
    pmtilesKind: 'vector',
    bbox: [-3.9, 40.3, -3.5, 40.6],
  };
  const realFetch = global.fetch;
  beforeEach(() => {
    // kepler reads the TileJSON and the archive itself: nothing answers here, and it draws without.
    global.fetch = jest.fn().mockRejectedValue(new Error('offline')) as never;
    // kepler logs each read that failed.
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    global.fetch = realFetch;
    jest.restoreAllMocks();
  });

  it('become kepler’s own vector tilesets, with its Vector Tile layer in the look of a query’s tiles', async () => {
    const store = newMap();
    loadXyz(store.dispatch, [BAG, ARCHIVE]);
    await settle();

    const { datasets, layers } = visStateOf(store);
    expect(datasets['grafana-A-tiles']).toMatchObject({
      type: 'vector-tile',
      metadata: {
        remoteTileFormat: 'mvt',
        tilesetDataUrl: BAG.url,
        tilesetMetadataUrl: BAG.metadataUrl,
        tilesBbox: BAG.bbox,
        tilesMinZoom: 10,
        tilesMaxZoom: 15,
      },
    });
    expect(datasets['grafana-B-tiles']).toMatchObject({
      type: 'vector-tile',
      metadata: { remoteTileFormat: 'pmtiles', tilesetDataUrl: ARCHIVE.url, tilesetMetadataUrl: ARCHIVE.url },
    });
    const drawn = layers.filter((l) => l.config.dataId.endsWith('-tiles')) as unknown as Array<{
      type: string;
      config: { visConfig: Record<string, unknown> };
    }>;
    expect(drawn.map((l) => l.type)).toEqual(['vectorTile', 'vectorTile']);
    expect(drawn[0].config.visConfig).toMatchObject({ stroked: true, strokeWidth: 1, radius: 4, opacity: 0.6 });
  });

  it('are left out of a save', async () => {
    const store = newMap();
    loadXyz(store.dispatch, [BAG, ARCHIVE]);
    await settle();
    expect(captureMapConfig(store)?.datasets ?? []).toEqual([]);
  });

  it('draw a picture archive as kepler’s raster tileset, the shape a raster_url archive takes', () => {
    // Not on the store: kepler's raster layer reads the archive as soon as it is built.
    expect(xyzProtoDataset({ ...ARCHIVE, pmtilesKind: 'raster' })).toMatchObject({
      info: { id: 'grafana-B-tiles', type: 'raster-tile' },
      metadata: { metadataUrl: ARCHIVE.url, pmtilesType: 'raster', tilesBbox: ARCHIVE.bbox },
    });
  });

  it('are kept on a refresh that names the same tiles, and rebuilt as another kind when they change', async () => {
    const store = newMap();
    loadXyz(store.dispatch, [BAG]);
    await settle();
    const before = visStateOf(store).datasets['grafana-A-tiles'];

    refreshXyz(store, store.dispatch, [{ ...BAG }]);
    await settle();
    expect(visStateOf(store).datasets['grafana-A-tiles']).toBe(before);

    // The same query now naming pictures: another dataset type, another layer.
    const pictures: XyzDataset = { id: 'grafana-A-tiles', label: '3D BAG', url: PDOK.url, bbox: null };
    refreshXyz(store, store.dispatch, [pictures]);
    await settle();
    const { datasets, layers } = visStateOf(store);
    expect(datasets['grafana-A-tiles'].type).toBe('xyz-tiles');
    expect(layers.filter((l) => l.config.dataId === 'grafana-A-tiles').map((l) => l.type)).toEqual(['xyz-tiles']);

    refreshXyz(store, store.dispatch, []);
    await settle();
    expect(visStateOf(store).datasets['grafana-A-tiles']).toBeUndefined();
  });
});

describe('framing a query’s tiles on their box', () => {
  /** IGN's WMTS of France: its levels start at 6, and a fit of its box lands below that. */
  const IGN: [number, number, number, number] = [-5.15, 41.33, 9.57, 51.1];

  it('goes no further out than the tiles’ first level, on the box’s centre', () => {
    const store = newMap();
    store.dispatch(wrapTo(KEPLER_INSTANCE_ID, updateMap({ width: 800, height: 600 } as never, 0)));
    fitMapToBox(store, store.dispatch, { bounds: IGN });
    expect(readMapState(store)?.zoom).toBeLessThan(6);

    fitMapToBox(store, store.dispatch, { bounds: IGN, minZoom: 6 });
    const view = readMapState(store)!;
    expect(view.zoom).toBe(6);
    expect(view.latitude).toBeCloseTo(46.215, 3);
    expect(view.longitude).toBeCloseTo(2.21, 3);
  });

  it('keeps kepler’s fit when it already shows the first level', () => {
    const store = newMap();
    store.dispatch(wrapTo(KEPLER_INSTANCE_ID, updateMap({ width: 800, height: 600 } as never, 0)));
    fitMapToBox(store, store.dispatch, { bounds: IGN, minZoom: 3 });
    const fitted = readMapState(store)!.zoom!;
    expect(fitted).toBeGreaterThan(3);
    expect(fitted).toBeLessThan(6);
  });
});
