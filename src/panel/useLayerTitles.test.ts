import { renderHook } from '@testing-library/react';
import { type DataFrame, FieldType, toDataFrame } from '@grafana/data';
import { layerConfigChange, registerEntry, wrapTo } from '@kepler.gl/actions';
import type { Store } from 'redux';

import { framesToDatasets } from '../data/framesToDatasets';
import { KEPLER_INSTANCE_ID } from './constants';
import { loadDatasets, refreshDatasets } from './keplerAdapter';
import { createKeplerStore } from './keplerStore';
import { useLayerTitles } from './useLayerTitles';

jest.mock('@grafana/runtime', () => {
  const { EventBusSrv } = jest.requireActual('@grafana/data');
  const bus = new EventBusSrv();
  return {
    getAppEvents: () => bus,
    locationService: {
      partial: () => {},
      getSearch: () => new URLSearchParams(),
      getHistory: () => ({ listen: () => () => undefined }),
    },
  };
});

/** kepler's data pipeline settles on the task middleware's promises. */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/** A catalog's answer: points, under the frame's own name, naming the layer they are and its title. */
const answer = (title: string | undefined, shift = 0): DataFrame[] => [
  toDataFrame({
    refId: 'A',
    name: 'features',
    meta: { custom: { layer: { key: title ?? 'none', ...(title ? { title } : {}) } } } as never,
    fields: [
      { name: 'latitude', type: FieldType.number, values: [-2.9 + shift, -2.8 + shift] },
      { name: 'longitude', type: FieldType.number, values: [-79, -78.9] },
    ],
  }),
];

const labels = (store: Store) =>
  (
    store.getState() as { keplerGl: Record<string, { visState: { layers: Array<{ config: { label: string } }> } }> }
  ).keplerGl[KEPLER_INSTANCE_ID].visState.layers.map((layer) => layer.config.label);

describe("a map's layers named as their catalog names them, on kepler's own store", () => {
  it('names a new layer by its title, extension-looking dot and all, and follows the query to another layer', async () => {
    const store = createKeplerStore();
    store.dispatch(registerEntry({ id: KEPLER_INSTANCE_ID }) as never);
    const first = answer('CCI Biomass v5.01');
    loadDatasets(store, store.dispatch, framesToDatasets(first));
    const hook = renderHook(({ frames }: { frames: DataFrame[] }) => useLayerTitles({ store, isReady: true, frames }), {
      initialProps: { frames: first },
    });
    await settle();
    expect(labels(store)).toEqual(['CCI Biomass v5.01']);

    // The query pointed at another layer of the same columns: kepler keeps the layer, and its name.
    const next = answer('Rivers of Ecuador', 0.5);
    hook.rerender({ frames: next });
    refreshDatasets(store, store.dispatch, framesToDatasets(next));
    await settle();
    expect(labels(store)).toEqual(['Rivers of Ecuador']);
  });

  it('keeps a name the user gave the layer', async () => {
    const store = createKeplerStore();
    store.dispatch(registerEntry({ id: KEPLER_INSTANCE_ID }) as never);
    const first = answer('Rivers');
    loadDatasets(store, store.dispatch, framesToDatasets(first));
    const hook = renderHook(({ frames }: { frames: DataFrame[] }) => useLayerTitles({ store, isReady: true, frames }), {
      initialProps: { frames: first },
    });
    await settle();
    const state = store.getState() as { keplerGl: Record<string, { visState: { layers: unknown[] } }> };
    const [layer] = state.keplerGl[KEPLER_INSTANCE_ID].visState.layers;
    store.dispatch(wrapTo(KEPLER_INSTANCE_ID, layerConfigChange(layer as never, { label: 'Water' })) as never);
    await settle();

    const next = answer('Lakes', 0.5);
    hook.rerender({ frames: next });
    refreshDatasets(store, store.dispatch, framesToDatasets(next));
    await settle();
    expect(labels(store)).toEqual(['Water']);
  });

  it("renames a saved map's layer named after the frame, once the frames say a title", async () => {
    const store = createKeplerStore();
    store.dispatch(registerEntry({ id: KEPLER_INSTANCE_ID }) as never);
    // Before its data source said a title: kepler named the layer after the frame.
    const untitled = answer(undefined);
    loadDatasets(store, store.dispatch, framesToDatasets(untitled));
    await settle();
    expect(labels(store)).toEqual(['features']);

    const titled = answer('Land cover 2020');
    renderHook(() => useLayerTitles({ store, isReady: true, frames: titled }));
    refreshDatasets(store, store.dispatch, framesToDatasets(titled));
    await settle();
    expect(labels(store)).toEqual(['Land cover 2020']);
  });
});
