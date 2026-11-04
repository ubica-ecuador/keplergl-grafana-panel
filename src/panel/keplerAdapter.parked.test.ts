import { FieldType, toDataFrame } from '@grafana/data';
import { registerEntry, removeLayer, wrapTo } from '@kepler.gl/actions';
import type { Store } from 'redux';

import { framesToDatasets, type PanelDataset } from '../data/framesToDatasets';
import type { SavedMapConfig } from '../data/mapConfig';
import { KEPLER_INSTANCE_ID } from './constants';
import { captureMapConfig, loadDatasets } from './keplerAdapter';
import { createKeplerStore } from './keplerStore';
import { insertInOrder } from './parkedConfig';

/**
 * A save made while part of the map waits for its data — a raster scene a
 * click resolves, a query that has not answered — keeps that part. Run against
 * kepler's real store: the truth is what kepler saves once everything is there.
 */

/** kepler's data pipeline settles on the task middleware's promises. */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

const [STATIONS, QUAKES] = framesToDatasets([
  toDataFrame({
    refId: 'A',
    fields: [
      { name: 'latitude', type: FieldType.number, values: [-2.9, -2.8] },
      { name: 'longitude', type: FieldType.number, values: [-79, -79.1] },
      { name: 'speed', type: FieldType.number, values: [1, 2] },
    ],
  }),
  toDataFrame({
    refId: 'B',
    fields: [
      { name: 'latitude', type: FieldType.number, values: [-2.7, -2.6] },
      { name: 'longitude', type: FieldType.number, values: [-79.2, -79.3] },
      { name: 'depth', type: FieldType.number, values: [3, 12] },
    ],
  }),
]);

async function mapOf(datasets: PanelDataset[], config?: SavedMapConfig): Promise<Store> {
  const store = createKeplerStore();
  store.dispatch(registerEntry({ id: KEPLER_INSTANCE_ID }) as never);
  loadDatasets(store, store.dispatch, datasets, {}, config);
  await settle();
  return store;
}

const visStateOf = (config: SavedMapConfig | null) => (config?.config as { visState: any }).visState;
const visStateIn = (store: Store) => (store.getState() as any).keplerGl[KEPLER_INSTANCE_ID].visState;

/**
 * A map of both queries as a dashboard saves it: the quakes coloured by depth
 * on top, a depth filter, a split with the quakes on the left only, and
 * tooltip fields for both.
 */
async function savedMap(): Promise<SavedMapConfig> {
  const base = captureMapConfig(await mapOf([STATIONS, QUAKES]))!;
  const visState = visStateOf(base);
  const quakes = visState.layers.find((l: any) => l.config.dataId === QUAKES.id);
  const stations = visState.layers.find((l: any) => l.config.dataId === STATIONS.id);
  quakes.id = 'quakes';
  quakes.visualChannels.colorField = { name: 'depth', type: 'real' };
  quakes.visualChannels.colorScale = 'quantize';
  stations.id = 'stations';
  visState.layers = [quakes, stations];
  visState.layerOrder = ['quakes', 'stations'];
  visState.filters = [
    { dataId: [QUAKES.id], id: 'depth', name: ['depth'], type: 'range', value: [0, 10], view: 'side', enabled: true },
  ];
  visState.splitMaps = [{ layers: { quakes: true, stations: true } }, { layers: { stations: true } }];
  visState.interactionConfig.tooltip.fieldsToShow = {
    [STATIONS.id]: [{ name: 'speed', format: null }],
    [QUAKES.id]: [{ name: 'depth', format: null }],
  };
  // What kepler itself writes for that map once both queries have answered.
  return captureMapConfig(await mapOf([STATIONS, QUAKES], base))!;
}

describe('a save while a query has not answered', () => {
  it('keeps its layer, filter, split side and tooltip fields as kepler saves them with the data there', async () => {
    const full = await savedMap();
    const waiting = await mapOf([STATIONS], full);
    expect(visStateIn(waiting).layerToBeMerged.map((l: any) => l.id)).toEqual(['quakes']);

    const saved = visStateOf(captureMapConfig(waiting));
    const expected = visStateOf(full);

    expect(saved.layers).toEqual(expected.layers);
    expect(saved.layerOrder).toEqual(expected.layerOrder);
    expect(saved.filters).toEqual(expected.filters);
    expect(saved.splitMaps).toEqual(expected.splitMaps);
    expect(saved.interactionConfig.tooltip.fieldsToShow).toEqual(expected.interactionConfig.tooltip.fieldsToShow);
  });

  it('gives a map that draws the waiting layer once its query answers', async () => {
    const full = await savedMap();
    const savedWaiting = captureMapConfig(await mapOf([STATIONS], full))!;

    const reloaded = visStateOf(captureMapConfig(await mapOf([STATIONS, QUAKES], savedWaiting)));
    expect(reloaded.layers).toEqual(visStateOf(full).layers);
    expect(reloaded.splitMaps).toEqual(visStateOf(full).splitMaps);
  });

  it('keeps a map whose queries have none answered', async () => {
    const full = await savedMap();
    const saved = visStateOf(captureMapConfig(await mapOf([], full)));

    expect(saved.layers.map((l: any) => l.id)).toEqual(['quakes', 'stations']);
    expect(saved.splitMaps).toEqual(visStateOf(full).splitMaps);
  });

  it('leaves out a layer the user deleted while another waits', async () => {
    const full = await savedMap();
    const waiting = await mapOf([STATIONS], full);
    waiting.dispatch(wrapTo(KEPLER_INSTANCE_ID, removeLayer('stations')) as never);
    await settle();

    expect(visStateOf(captureMapConfig(waiting)).layers.map((l: any) => l.id)).toEqual(['quakes']);
  });

  it('changes nothing when nothing waits', async () => {
    const full = await savedMap();
    expect(captureMapConfig(await mapOf([STATIONS, QUAKES], full))).toEqual(full);
  });
});

describe('insertInOrder', () => {
  const id = (s: string) => s;

  it('puts each pending item before the first live one the order puts after it', () => {
    expect(insertInOrder(['b', 'd'], ['c', 'a', 'e'], id, ['a', 'b', 'c', 'd', 'e'])).toEqual([
      'a',
      'b',
      'c',
      'd',
      'e',
    ]);
  });

  it('skips live items the order does not name, and appends pending ones it does not name', () => {
    expect(insertInOrder(['new', 'b'], ['a', 'x'], id, ['a', 'b'])).toEqual(['new', 'a', 'b', 'x']);
  });
});
