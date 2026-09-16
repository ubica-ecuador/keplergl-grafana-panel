import type { Store } from 'redux';
import { KEPLER_INSTANCE_ID } from './constants';
import { readFlowFieldLayers } from './keplerAdapter';
import { SYMBOL_TYPE } from './symbolLayer';

/**
 * Regression coverage for task 9: a `symbol` layer must be among the layers
 * `readFlowFieldLayers` reports, so `useFlowFieldContext` hands it the camera
 * the same way it does for the flow field and vector field layers. Without
 * this, `renderLayer` in `symbolLayer.ts` never sees `visConfig.flowContext`,
 * and the declutter feature is inert regardless of what the user configures.
 *
 * Kept in its own file rather than added to `readFlowFieldLayers.test.ts` so
 * that file — and the behaviour it pins for the two existing layer types —
 * stays untouched.
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

describe('readFlowFieldLayers with a symbol layer', () => {
  it('includes a symbol layer alongside the flow field and vector field layers', () => {
    const store = fakeStore([
      { id: 'flow-1', type: 'flowfield' },
      { id: 'vector-1', type: 'vectorfield' },
      { id: 'symbol-1', type: SYMBOL_TYPE },
      { id: 'point-1', type: 'point' },
    ]);

    const ids = readFlowFieldLayers(store).map((layer) => layer.id);

    expect(ids).toEqual(['flow-1', 'vector-1', 'symbol-1']);
  });
});
