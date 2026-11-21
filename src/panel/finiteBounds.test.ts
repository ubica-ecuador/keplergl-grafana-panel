import { FieldType, toDataFrame } from '@grafana/data';
import { registerEntry, updateMap, wrapTo } from '@kepler.gl/actions';
import type { Store } from 'redux';

import { framesToDatasets } from '../data/framesToDatasets';
import { KEPLER_INSTANCE_ID } from './constants';
import { isFiniteBounds } from './finiteBounds';
import { captureMapConfig, loadDatasets, readLayerBoundsUnion, readMapState } from './keplerAdapter';
import { createKeplerStore } from './keplerStore';

/**
 * A query with nothing to frame leaves the view where it is. A GeoParquet read
 * by an area holding nothing answered no rows, its GeoJSON layer measured
 * turf's infinite box, and kepler's centring on the data took the map to
 * latitude 0, longitude 0. Run on kepler's real store.
 */

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function newMap(): Store {
  const store = createKeplerStore();
  store.dispatch(registerEntry({ id: KEPLER_INSTANCE_ID }) as never);
  store.dispatch(wrapTo(KEPLER_INSTANCE_ID, updateMap({ width: 800, height: 600 } as never, 0)));
  return store;
}

const geometries = (values: unknown[]) =>
  framesToDatasets([
    toDataFrame({
      refId: 'A',
      fields: [
        { name: 'name', type: FieldType.string, values: values.map((_, i) => `feature ${i}`) },
        { name: 'geometry', type: FieldType.string, values },
      ],
    }),
  ]);

describe('isFiniteBounds', () => {
  it('takes four finite numbers west to east and south to north, and nothing else', () => {
    expect(isFiniteBounds([-5.15, 41.33, 9.57, 51.1])).toBe(true);
    expect(isFiniteBounds([2, 48, 2, 48])).toBe(true);
    expect(isFiniteBounds([Infinity, Infinity, -Infinity, -Infinity])).toBe(false);
    expect(isFiniteBounds([180, 90, -180, -90])).toBe(false);
    expect(isFiniteBounds([0, 0, NaN, 1])).toBe(false);
    expect(isFiniteBounds(null)).toBe(false);
    expect(isFiniteBounds([0, 0, 1])).toBe(false);
  });
});

describe('a map with nothing to frame', () => {
  const view = (store: Store) => {
    const { latitude, longitude, zoom } = readMapState(store)!;
    return { latitude, longitude, zoom };
  };

  it('stays where it is when its query answers no rows', async () => {
    const store = newMap();
    const before = view(store);
    loadDatasets(store, store.dispatch, geometries([]));
    await settle();

    expect(view(store)).toEqual(before);
    expect(readLayerBoundsUnion(store)).toBeNull();
  });

  it('stays where it is when its rows have no geometry', async () => {
    const store = newMap();
    const before = view(store);
    loadDatasets(store, store.dispatch, geometries([null, null]));
    await settle();

    expect(view(store)).toEqual(before);
  });

  it('stays where it is when a map saved with a GeoJSON layer and no view answers no rows', async () => {
    const first = newMap();
    loadDatasets(first, first.dispatch, geometries(['{"type":"Point","coordinates":[2,48]}']));
    await settle();
    const saved = captureMapConfig(first)!;
    delete (saved.config as { mapState?: unknown }).mapState;

    const store = newMap();
    const before = view(store);
    loadDatasets(store, store.dispatch, geometries([]), {}, saved);
    await settle();

    expect(view(store)).toEqual(before);
  });

  it('is still framed on rows that say where they are', async () => {
    const store = newMap();
    const stations = framesToDatasets([
      toDataFrame({
        refId: 'A',
        fields: [
          { name: 'latitude', type: FieldType.number, values: [-2.9, -2.8] },
          { name: 'longitude', type: FieldType.number, values: [-79, -79.1] },
        ],
      }),
    ]);
    loadDatasets(store, store.dispatch, stations);
    await settle();

    expect(view(store).latitude).toBeCloseTo(-2.85, 1);
    expect(view(store).longitude).toBeCloseTo(-79.05, 1);
  });
});
