import type { Store } from 'redux';
import { KEPLER_INSTANCE_ID } from './constants';
import { readFlowFieldLayers } from './keplerAdapter';

/**
 * A store minimal enough for `readFlowFieldLayers`: just the shape of
 * `visState` it reads (`layers` and `datasets`), under the panel's own kepler
 * instance id — see `getVisState` in `keplerAdapter.ts`.
 */
function fakeStore(layers: Array<{ id: string; type: string }>): Store {
  return {
    getState: () => ({
      keplerGl: {
        [KEPLER_INSTANCE_ID]: {
          visState: {
            layers: layers.map((layer) => ({
              id: layer.id,
              type: layer.type,
              config: { dataId: undefined, columns: {}, visConfig: {} },
            })),
            datasets: {},
          },
        },
      },
    }),
  } as unknown as Store;
}

describe('readFlowFieldLayers', () => {
  it('returns the flow field and vector field layers, and skips other layer types', () => {
    const store = fakeStore([
      { id: 'flow-1', type: 'flowfield' },
      { id: 'vector-1', type: 'vectorfield' },
      { id: 'point-1', type: 'point' },
    ]);

    const ids = readFlowFieldLayers(store).map((layer) => layer.id);

    expect(ids).toEqual(['flow-1', 'vector-1']);
  });
});
