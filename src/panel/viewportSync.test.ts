import { hasViewportVariables, viewportVariableWrites } from './viewportSync';

/**
 * The decision behind "filter to what I am looking at".
 *
 * Everything runs against literal values — no kepler, no store. The cases
 * that carry the design are the quiet ones: an unchanged view must not write
 * (the store wakes on every pointer move, and each write re-queries every
 * consuming panel), and a world-wide view must not publish coordinates that
 * do not exist.
 */

const vars = { west: 'w', south: 's', east: 'e', north: 'n' };
const bounds = { west: -79.05, south: -2.95, east: -78.95, north: -2.85 };

describe('hasViewportVariables', () => {
  it('is true when any of the four is named', () => {
    expect(hasViewportVariables({ west: 'w' })).toBe(true);
    expect(hasViewportVariables(vars)).toBe(true);
  });

  it('is false for an absent or empty mapping', () => {
    expect(hasViewportVariables(undefined)).toBe(false);
    expect(hasViewportVariables({})).toBe(false);
    expect(hasViewportVariables({ west: '', north: '' })).toBe(false);
  });
});

describe('viewportVariableWrites', () => {
  it('publishes the four edges of the view', () => {
    expect(viewportVariableWrites({ bounds, variables: vars, variableValues: {} })).toEqual({
      w: '-79.05',
      s: '-2.95',
      e: '-78.95',
      n: '-2.85',
    });
  });

  it('rounds to six decimals, so a pan does not smear noise into the URL', () => {
    expect(
      viewportVariableWrites({
        bounds: { west: -79.0500001234, south: -2.95, east: -78.95, north: -2.85 },
        variables: vars,
        variableValues: {},
      }).w
    ).toBe('-79.05');
  });

  it('writes nothing when the view has not moved', () => {
    expect(
      viewportVariableWrites({
        bounds,
        variables: vars,
        variableValues: { w: '-79.05', s: '-2.95', e: '-78.95', n: '-2.85' },
      })
    ).toEqual({});
  });

  it('compares numerically, so URL formatting differences are not a move', () => {
    expect(
      viewportVariableWrites({
        bounds,
        variables: vars,
        variableValues: { w: '-79.050000', s: '-2.9500', e: '-78.95', n: '-2.85' },
      })
    ).toEqual({});
  });

  it('writes only the edges that actually moved', () => {
    expect(
      viewportVariableWrites({
        bounds,
        variables: vars,
        variableValues: { w: '-79.05', s: '-2.95', e: '-78.95', n: '-1' },
      })
    ).toEqual({ n: '-2.85' });
  });

  it('serves a mapping that names only some of the four', () => {
    expect(viewportVariableWrites({ bounds, variables: { west: 'w', east: 'e' }, variableValues: {} })).toEqual({
      w: '-79.05',
      e: '-78.95',
    });
  });

  it('clamps a world-wide view to coordinates that exist', () => {
    // Zoomed all the way out the computed span runs past the antimeridian and
    // the poles; a consumer comparing `lng BETWEEN $west AND $east` should
    // never be handed -250.
    expect(
      viewportVariableWrites({
        bounds: { west: -250, south: -95, east: 250, north: 95 },
        variables: vars,
        variableValues: {},
      })
    ).toEqual({ w: '-180', s: '-90', e: '180', n: '90' });
  });

  it('writes nothing for a view that is not yet measurable', () => {
    // kepler reports a zero-sized map before the layout settles.
    expect(viewportVariableWrites({ bounds: null, variables: vars, variableValues: {} })).toEqual({});
    expect(
      viewportVariableWrites({
        bounds: { west: Number.NaN, south: -2.95, east: -78.95, north: -2.85 },
        variables: vars,
        variableValues: {},
      })
    ).toEqual({});
  });
});
