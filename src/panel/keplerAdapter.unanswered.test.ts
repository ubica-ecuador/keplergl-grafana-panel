import { FieldType, toDataFrame } from '@grafana/data';
import { registerEntry, wrapTo, updateMap } from '@kepler.gl/actions';
import type { Store } from 'redux';

import { framesToDatasets } from '../data/framesToDatasets';
import type { SavedMapConfig } from '../data/mapConfig';
import { KEPLER_INSTANCE_ID } from './constants';
import { captureMapConfig, loadDatasets, refreshDatasets } from './keplerAdapter';
import { createKeplerStore } from './keplerStore';

/**
 * A saved map whose only query failed, or answered no rows, is built from its
 * config all the same, so it opens on its saved view rather than on kepler's
 * default (`shouldBuildMap`). When the query answers later, its rows come in
 * on the refresh path and take the layers the config saved for them. Run on
 * kepler's real store.
 */

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

const [STATIONS] = framesToDatasets([
  toDataFrame({
    refId: 'A',
    fields: [
      { name: 'latitude', type: FieldType.number, values: [-2.9, -2.8] },
      { name: 'longitude', type: FieldType.number, values: [-79, -79.1] },
    ],
  }),
]);

function newMap(): Store {
  const store = createKeplerStore();
  store.dispatch(registerEntry({ id: KEPLER_INSTANCE_ID }) as never);
  return store;
}

type Instance = {
  mapState: { latitude: number; longitude: number; zoom: number };
  visState: { layers: Array<{ config: { dataId: string; label: string } }> };
};
const instanceOf = (store: Store) =>
  (store.getState() as { keplerGl: Record<string, Instance> }).keplerGl[KEPLER_INSTANCE_ID];

/** A map of the stations saved over Cuenca, its layer renamed. */
async function savedOverCuenca(): Promise<SavedMapConfig> {
  const store = newMap();
  loadDatasets(store, store.dispatch, [STATIONS]);
  await settle();
  store.dispatch(wrapTo(KEPLER_INSTANCE_ID, updateMap({ latitude: -2.95, longitude: -79.1, zoom: 8.6 })));
  const saved = captureMapConfig(store)!;
  const layers = (saved.config.visState as { layers: Array<{ config: { label: string } }> }).layers;
  layers[0].config.label = 'Stations';
  return saved;
}

describe('a saved map whose query answered nothing', () => {
  it('opens on its saved view, and takes its layers when the rows come', async () => {
    const saved = await savedOverCuenca();

    const store = newMap();
    loadDatasets(store, store.dispatch, [], {}, saved);
    await settle();
    expect(instanceOf(store).mapState).toMatchObject({ latitude: -2.95, longitude: -79.1, zoom: 8.6 });

    refreshDatasets(store, store.dispatch, [STATIONS]);
    await settle();
    const { mapState, visState } = instanceOf(store);
    expect(visState.layers.map((layer) => [layer.config.dataId, layer.config.label])).toEqual([
      ['grafana-A', 'Stations'],
    ]);
    expect(mapState).toMatchObject({ latitude: -2.95, longitude: -79.1, zoom: 8.6 });
  });
});
