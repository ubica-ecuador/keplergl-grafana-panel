import { KEPLER_INSTANCE_ID } from './constants';
import { readPinnedCoordinate } from './keplerAdapter';

/**
 * The spot a click pins, as the coordinate mappings read it. kepler keeps the
 * longitude deck unprojects, which on a copy of the world past the antimeridian
 * is that copy's: the variable gets the place within ±180°.
 */

const storeWith = (pinned: unknown) =>
  ({
    getState: () => ({ keplerGl: { [KEPLER_INSTANCE_ID]: { visState: { mousePos: { pinned } }, uiState: {} } } }),
  }) as unknown as Parameters<typeof readPinnedCoordinate>[0];

describe('readPinnedCoordinate', () => {
  it('reads a spot on the main world as kepler pinned it', () => {
    expect(readPinnedCoordinate(storeWith({ coordinate: [-78.5, -0.22] }))).toEqual([-78.5, -0.22]);
  });

  it('reads a spot pinned on a copy of the world at its place within ±180°', () => {
    const [lng, lat] = readPinnedCoordinate(storeWith({ coordinate: [181.56, -18.14] }))!;
    expect(lng).toBeCloseTo(-178.44);
    expect(lat).toBe(-18.14);
    expect(readPinnedCoordinate(storeWith({ coordinate: [-438.5, 10] }))![0]).toBeCloseTo(-78.5);
  });

  it('keeps an unpin and no pin apart', () => {
    expect(readPinnedCoordinate(storeWith(null))).toBeNull();
    expect(readPinnedCoordinate(storeWith(undefined))).toBeUndefined();
  });
});
