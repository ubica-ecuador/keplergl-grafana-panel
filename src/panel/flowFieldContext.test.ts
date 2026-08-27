import { outdatedFlowContexts, sameContext } from './flowFieldContext';

const VIEWPORT = { west: 0, east: 4, south: 0, north: 4, widthPx: 800, heightPx: 600 };

describe('outdatedFlowContexts', () => {
  it('tells a layer that has never been told anything', () => {
    const patches = outdatedFlowContexts([{ id: 'a', altitudeMeters: 0 }], VIEWPORT, 1_000);

    expect(patches).toEqual([{ id: 'a', context: { viewport: VIEWPORT, baseMs: 1_000, tallest: 0 } }]);
  });

  it('says nothing when every layer already carries the same context', () => {
    // This is what keeps the hook out of a dispatch loop: it runs on every store
    // notification, and writing the same context back would notify it again.
    const context = { viewport: VIEWPORT, baseMs: 1_000, tallest: 0 };

    expect(outdatedFlowContexts([{ id: 'a', altitudeMeters: 0, context }], VIEWPORT, 1_000)).toEqual([]);
  });

  it('gives every layer the tallest level on the map, not its own', () => {
    // The exaggeration scales the whole stack to a share of the view. A layer
    // working it out from its own height would draw every level at the same
    // altitude and flatten the stack it exists to separate.
    const patches = outdatedFlowContexts(
      [
        { id: 'low', altitudeMeters: 110 },
        { id: 'high', altitudeMeters: 3000 },
      ],
      VIEWPORT,
      0
    );

    expect(patches.map((p) => p.context.tallest)).toEqual([3000, 3000]);
  });

  it('re-tells everyone when a level is added above the others', () => {
    const context = { viewport: VIEWPORT, baseMs: 0, tallest: 110 };
    const patches = outdatedFlowContexts(
      [
        { id: 'low', altitudeMeters: 110, context },
        { id: 'high', altitudeMeters: 3000 },
      ],
      VIEWPORT,
      0
    );

    expect(patches.map((p) => p.id)).toEqual(['low', 'high']);
  });

  it('has nothing to say when the map carries no flow field', () => {
    expect(outdatedFlowContexts([], VIEWPORT, 0)).toEqual([]);
  });

  it('still speaks before the map has a size to report', () => {
    // kepler reports a zero-sized map until its layout settles. The field is
    // then traced over its whole extent, which is what happened on load before
    // any of this existed, and corrected on the first settle.
    const patches = outdatedFlowContexts([{ id: 'a', altitudeMeters: 0 }], null, 5);

    expect(patches[0].context.viewport).toBeUndefined();
    expect(patches[0].context.baseMs).toBe(5);
  });
});

describe('sameContext', () => {
  const context = { viewport: VIEWPORT, baseMs: 1, tallest: 2 };

  it('spots a moved viewport', () => {
    expect(sameContext(context, { ...context, viewport: { ...VIEWPORT, east: 5 } })).toBe(false);
  });

  it('spots a resized panel, which changes how many lines fit', () => {
    expect(sameContext(context, { ...context, viewport: { ...VIEWPORT, widthPx: 400 } })).toBe(false);
  });

  it('spots a new dashboard range', () => {
    expect(sameContext(context, { ...context, baseMs: 2 })).toBe(false);
  });

  it('accepts a context that would trace the same lines', () => {
    expect(sameContext(context, { viewport: { ...VIEWPORT }, baseMs: 1, tallest: 2 })).toBe(true);
  });
});
