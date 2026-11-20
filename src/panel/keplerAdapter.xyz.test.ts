import { registerEntry } from '@kepler.gl/actions';

import { KEPLER_INSTANCE_ID } from './constants';
import { captureMapConfig, loadDatasets, loadXyz, refreshXyz } from './keplerAdapter';
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
