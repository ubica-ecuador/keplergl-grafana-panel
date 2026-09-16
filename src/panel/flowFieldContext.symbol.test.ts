import { outdatedFlowContexts } from './flowFieldContext';
import { FLOW_FIELD_TYPE } from './keplerAdapter';
import { SYMBOL_TYPE } from './symbolLayer';

const CAMERA = { latitude: 2, longitude: 2, zoom: 8, pitch: 0, bearing: 0, width: 800, height: 600 };

/**
 * Regression coverage for the controller's ruling on task 9: a symbol layer
 * is now among the layers `readFlowFieldLayers` reports (see
 * `readFlowFieldLayers.symbol.test.ts`), so `outdatedFlowContexts` hands it
 * the same camera as the flow field and vector field layers — but, unlike
 * them, it is not a level: it has no `heightMeters` knob, no
 * `elevationScale`, and never calls `stackedAltitude`. Its altitude column
 * must not be allowed to warp the vertical exaggeration of the layers that
 * actually stack.
 *
 * Kept in its own file rather than appended to `flowFieldContext.test.ts` so
 * that file, and the behaviour it already pins, stays untouched.
 */
describe('outdatedFlowContexts with a symbol layer present', () => {
  it('gives the symbol layer the same camera as the velocity layers', () => {
    const patches = outdatedFlowContexts(
      [
        { id: 'flow-1', altitudeMeters: 100, type: FLOW_FIELD_TYPE },
        { id: 'symbol-1', altitudeMeters: 0, type: SYMBOL_TYPE },
      ],
      CAMERA,
      0
    );

    expect(patches.map((p) => p.id)).toEqual(['flow-1', 'symbol-1']);
    expect(patches.every((p) => p.context.camera === CAMERA)).toBe(true);
  });

  it('does not let a symbol layer with a bound altitude column raise the tallest level', () => {
    const patches = outdatedFlowContexts(
      [
        { id: 'flow-1', altitudeMeters: 100, type: FLOW_FIELD_TYPE },
        // A symbol layer with its own altitude column bound, taller than any
        // real level on the map — it must not be mistaken for one.
        { id: 'symbol-1', altitudeMeters: 5000, type: SYMBOL_TYPE },
      ],
      CAMERA,
      0
    );

    expect(patches.map((p) => p.context.tallest)).toEqual([100, 100]);
  });
});
