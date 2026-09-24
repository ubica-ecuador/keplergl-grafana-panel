import { FieldType, toDataFrame } from '@grafana/data';
import { fitBounds, registerEntry, updateMap, wrapTo } from '@kepler.gl/actions';
import type { Store } from 'redux';

import { framesToDatasets } from '../data/framesToDatasets';
import { KEPLER_INSTANCE_ID } from './constants';
import { loadDatasets, readLayerBoundsUnion, readMapState, sizeMapForFit } from './keplerAdapter';
import { createKeplerStore } from './keplerStore';

/**
 * A first load that centres on its data frames the bounds to the size kepler's
 * map state holds at that moment. kepler learns the real size from a
 * ResizeObserver, and until it answers the state holds the 800 × 800 it starts
 * with — so a load that gets there first is framed for a map of the wrong shape,
 * and the viewport guard later refits it, moving the map a moment after it
 * appeared. With MapLibre 6 the observer answers later, and on a map with
 * viewport variables the refit went out as a second bbox.
 */

/** kepler's data pipeline settles on the task middleware's promises. */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/** Points spread wider than they are tall, like the cross-filter fixture's. */
function datasets() {
  const lats = [-2.9, -2.895, -2.89, -2.885, -2.88];
  return framesToDatasets([
    toDataFrame({
      refId: 'A',
      fields: [
        { name: 'latitude', type: FieldType.number, values: lats },
        { name: 'longitude', type: FieldType.number, values: [-79.03, -79.02, -79.01, -79.0, -78.99] },
      ],
    }),
  ]);
}

function freshStore(): Store {
  const store = createKeplerStore();
  store.dispatch(registerEntry({ id: KEPLER_INSTANCE_ID }) as never);
  return store;
}

/** A panel-sized map: wider than tall, unlike kepler's 800 × 800 default. */
const WIDTH = 930;
const HEIGHT = 550;

describe('sizeMapForFit', () => {
  it('frames the first load for the panel, the zoom the guard would refit to', async () => {
    const store = freshStore();
    sizeMapForFit(store, store.dispatch, WIDTH, HEIGHT);
    loadDatasets(store.dispatch, datasets(), { centerMap: true });
    await settle();
    const loaded = readMapState(store)!;

    // What the viewport guard does once the real size is known: fit again.
    store.dispatch(wrapTo(KEPLER_INSTANCE_ID, fitBounds(readLayerBoundsUnion(store)!)) as never);
    const refitted = readMapState(store)!;

    expect(loaded.width).toBe(WIDTH);
    expect(loaded.height).toBe(HEIGHT);
    expect(loaded.zoom).toBeCloseTo(refitted.zoom!, 6);
    expect(loaded.latitude).toBeCloseTo(refitted.latitude!, 6);
    expect(loaded.longitude).toBeCloseTo(refitted.longitude!, 6);
  });

  it('is what the unsized load gets wrong', async () => {
    const store = freshStore();
    loadDatasets(store.dispatch, datasets(), { centerMap: true });
    await settle();
    const loaded = readMapState(store)!;

    // The observer answers late: the size arrives, then the guard refits.
    store.dispatch(wrapTo(KEPLER_INSTANCE_ID, updateMap({ width: WIDTH, height: HEIGHT } as never, 0)) as never);
    store.dispatch(wrapTo(KEPLER_INSTANCE_ID, fitBounds(readLayerBoundsUnion(store)!)) as never);
    const refitted = readMapState(store)!;

    expect(Math.abs(loaded.zoom! - refitted.zoom!)).toBeGreaterThan(0.1);
  });

  it('dispatches nothing when the state already holds that size', () => {
    const store = freshStore();
    sizeMapForFit(store, store.dispatch, WIDTH, HEIGHT);
    const dispatch = jest.fn();
    sizeMapForFit(store, dispatch, WIDTH, HEIGHT);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('dispatches nothing for a panel with no size yet', () => {
    const store = freshStore();
    const dispatch = jest.fn();
    sizeMapForFit(store, dispatch, 0, HEIGHT);
    sizeMapForFit(store, dispatch, WIDTH, 0);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
