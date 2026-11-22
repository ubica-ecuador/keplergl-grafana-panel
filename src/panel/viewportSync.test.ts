import { hasViewportVariables, viewportVariableWrites, viewText } from './viewportSync';

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

  it('is true for the one variable of the whole box alone', () => {
    expect(hasViewportVariables({ view: 'view' })).toBe(true);
    expect(hasViewportVariables({ viewFormat: 'bbox' })).toBe(false);
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

describe('the whole box in one variable', () => {
  const wkt = 'POLYGON((-79.05 -2.95, -78.95 -2.95, -78.95 -2.85, -79.05 -2.85, -79.05 -2.95))';

  it('is a closed WKT polygon by default, as the drawn area is written', () => {
    expect(viewportVariableWrites({ bounds, variables: { view: 'v' }, variableValues: {} })).toEqual({ v: wkt });
  });

  it('is west,south,east,north when asked', () => {
    expect(
      viewportVariableWrites({ bounds, variables: { view: 'v', viewFormat: 'bbox' }, variableValues: {} })
    ).toEqual({ v: '-79.05,-2.95,-78.95,-2.85' });
  });

  it('goes with the four edges in the same write', () => {
    expect(viewportVariableWrites({ bounds, variables: { ...vars, view: 'v' }, variableValues: {} })).toEqual({
      w: '-79.05',
      s: '-2.95',
      e: '-78.95',
      n: '-2.85',
      v: wkt,
    });
  });

  it('writes nothing when it already holds the box, whatever its spacing or trailing zeros', () => {
    const variables = { view: 'v' };
    expect(viewportVariableWrites({ bounds, variables, variableValues: { v: wkt } })).toEqual({});
    expect(
      viewportVariableWrites({
        bounds,
        variables,
        variableValues: {
          v: 'POLYGON ((-79.050 -2.95,-78.95 -2.95,-78.95 -2.85,-79.05 -2.85,-79.05 -2.95))',
        },
      })
    ).toEqual({});
    expect(
      viewportVariableWrites({
        bounds,
        variables: { view: 'v', viewFormat: 'bbox' },
        variableValues: { v: ['-79.050000,-2.95,-78.95,-2.85'] },
      })
    ).toEqual({});
  });

  it('rewrites a box held in the other form, or a box that moved', () => {
    expect(
      viewportVariableWrites({ bounds, variables: { view: 'v' }, variableValues: { v: '-79.05,-2.95,-78.95,-2.85' } })
    ).toEqual({ v: wkt });
    expect(
      viewportVariableWrites({
        bounds,
        variables: { view: 'v', viewFormat: 'bbox' },
        variableValues: { v: '-79.05,-2.95,-78.95,-2.8' },
      })
    ).toEqual({ v: '-79.05,-2.95,-78.95,-2.85' });
  });

  it('is rounded and clamped as the edges are', () => {
    expect(
      viewportVariableWrites({
        bounds: { west: -250, south: -95, east: 250.0000001, north: 95 },
        variables: { view: 'v', viewFormat: 'bbox' },
        variableValues: {},
      })
    ).toEqual({ v: '-180,-90,180,90' });
  });

  it('writes nothing for a view that is not yet measurable', () => {
    expect(viewportVariableWrites({ bounds: null, variables: { view: 'v' }, variableValues: {} })).toEqual({});
  });

  it('draws the ring counter-clockwise from the south-west corner and closes it', () => {
    expect(viewText({ west: 0, south: 1, east: 2, north: 3 })).toBe('POLYGON((0 1, 2 1, 2 3, 0 3, 0 1))');
  });
});
