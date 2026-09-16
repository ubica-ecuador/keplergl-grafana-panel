import { renderHook } from '@testing-library/react';
import type { Store } from 'redux';

import { useSplitMapsGuard } from './useSplitMapsGuard';

const CONFIG = {
  version: 'v1',
  config: {
    visState: {
      splitMaps: [
        { layers: { boxoutline: true, 's2scene-before': true, s2scene: false } },
        { layers: { boxoutline: true, 's2scene-before': false, s2scene: true } },
      ],
      layers: [
        { id: 'boxoutline', config: { dataId: 'grafana-A' } },
        { id: 's2scene-before', config: { dataId: 'grafana-D-raster' } },
        { id: 's2scene', config: { dataId: 'grafana-B-raster' } },
      ],
    },
  },
};

function visState(splitMaps: unknown[], layers: Array<{ id: string; dataId: string }>) {
  return {
    keplerGl: {
      grafana: {
        visState: {
          filters: [],
          datasets: {},
          splitMaps,
          layers: layers.map(({ id, dataId }) => ({ id, config: { dataId } })),
        },
      },
    },
  };
}

function makeStore(initial: ReturnType<typeof visState>) {
  let state = initial;
  const subscribers: Array<() => void> = [];
  return {
    getState: () => state,
    subscribe: (fn: () => void) => {
      subscribers.push(fn);
      return () => subscribers.splice(subscribers.indexOf(fn), 1);
    },
    dispatch: jest.fn(),
    set: (next: ReturnType<typeof visState>) => {
      state = next;
      subscribers.forEach((fn) => fn());
    },
  };
}

/** The `{mapIndex, layerId}` of each `TOGGLE_LAYER_FOR_MAP` the hook dispatched. */
function toggles(store: { dispatch: jest.Mock }) {
  return store.dispatch.mock.calls
    .map(([action]) => action as { payload?: { type?: string; mapIndex?: number; layerId?: string } })
    .filter((action) => String(action?.payload?.type).includes('TOGGLE_LAYER_FOR_MAP'))
    .map(({ payload }) => ({ mapIndex: payload?.mapIndex, layerId: payload?.layerId }));
}

const LAYERS_WITHOUT_RASTERS = [{ id: 'boxoutline', dataId: 'grafana-A' }];
const LAYERS_WITH_RASTERS = [
  { id: 'boxoutline', dataId: 'grafana-A' },
  { id: 's2scene-before', dataId: 'grafana-D-raster' },
  { id: 's2scene', dataId: 'grafana-B-raster' },
];
const ALL_TRUE = { boxoutline: true, 's2scene-before': true, s2scene: true };

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

it('puts each raster back on its own half once the layers arrive', async () => {
  const store = makeStore(
    visState([{ layers: { boxoutline: true } }, { layers: { boxoutline: true } }], LAYERS_WITHOUT_RASTERS)
  );
  const { result } = renderHook(() => useSplitMapsGuard({ store: store as unknown as Store, mapConfig: CONFIG }));

  result.current();
  await flush();
  expect(toggles(store)).toEqual([]);

  // kepler merges the raster layers, onto both halves.
  store.set(visState([{ layers: { ...ALL_TRUE } }, { layers: { ...ALL_TRUE } }], LAYERS_WITH_RASTERS));
  await flush();
  expect(toggles(store)).toEqual([
    { mapIndex: 0, layerId: 's2scene' },
    { mapIndex: 1, layerId: 's2scene-before' },
  ]);
});

it('stops watching once the assignment holds, so a later hand toggle stays', async () => {
  const store = makeStore(
    visState(
      [
        { layers: { boxoutline: true, 's2scene-before': true, s2scene: false } },
        { layers: { boxoutline: true, 's2scene-before': false, s2scene: true } },
      ],
      LAYERS_WITH_RASTERS
    )
  );
  const { result } = renderHook(() => useSplitMapsGuard({ store: store as unknown as Store, mapConfig: CONFIG }));

  result.current();
  await flush();
  expect(toggles(store)).toEqual([]);

  // The user moves a layer by hand afterwards: nothing puts it back.
  store.set(visState([{ layers: { ...ALL_TRUE } }, { layers: { ...ALL_TRUE } }], LAYERS_WITH_RASTERS));
  await flush();
  expect(toggles(store)).toEqual([]);
});

it('leaves a hand toggle alone even while a raster is still missing', async () => {
  const store = makeStore(
    visState([{ layers: { boxoutline: true } }, { layers: { boxoutline: true } }], LAYERS_WITHOUT_RASTERS)
  );
  const { result } = renderHook(() => useSplitMapsGuard({ store: store as unknown as Store, mapConfig: CONFIG }));

  // Armed, and waiting for the rasters: `boxoutline` is seen in its place.
  result.current();
  await flush();
  expect(toggles(store)).toEqual([]);

  // The user drags `boxoutline` off the left half while the wait is still on.
  store.set(visState([{ layers: { boxoutline: false } }, { layers: { boxoutline: true } }], LAYERS_WITHOUT_RASTERS));
  await flush();
  expect(toggles(store)).toEqual([]);

  // And the rasters, when they do arrive, are still put right.
  store.set(
    visState(
      [{ layers: { ...ALL_TRUE, boxoutline: false } }, { layers: { ...ALL_TRUE, boxoutline: true } }],
      LAYERS_WITH_RASTERS
    )
  );
  await flush();
  // The rasters are put right; the hand-moved `boxoutline` is still not touched.
  expect(toggles(store)).toEqual([
    { mapIndex: 0, layerId: 's2scene' },
    { mapIndex: 1, layerId: 's2scene-before' },
  ]);
});

it('dispatches nothing at all for a config with no split', async () => {
  const store = makeStore(visState([], LAYERS_WITH_RASTERS));
  const { result } = renderHook(() => useSplitMapsGuard({ store: store as unknown as Store, mapConfig: null }));

  result.current();
  store.set(visState([{ layers: { ...ALL_TRUE } }, { layers: { ...ALL_TRUE } }], LAYERS_WITH_RASTERS));
  await flush();
  expect(store.dispatch).not.toHaveBeenCalled();
});
