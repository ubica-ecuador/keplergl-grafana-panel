import {
  decideClickArea,
  DEFAULT_CLICK_AREA_METRES,
  isSquareSuperseded,
  squareAround,
  type PolygonGeometry,
} from './clickArea';

/*
 * The measurements below deliberately do not reuse the construction. The box is
 * built by scaling degrees; it is measured by great-circle distance along its
 * edges (haversine) and by the closed-form area of a meridian/parallel box on a
 * sphere, R²·Δλ·(sin φ₂ − sin φ₁). A slip in the degree maths — a missing
 * cos(lat), degrees fed to a radian function — shows up as a wrong length here.
 */
const R = 6_371_008.8;
const rad = (deg: number) => (deg * Math.PI) / 180;

function haversine([lng1, lat1]: number[], [lng2, lat2]: number[]): number {
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function measure(square: PolygonGeometry) {
  const [nw, sw, se, ne, closing] = square.coordinates[0];
  const [west, north] = nw;
  const [east, south] = se;
  const middle = (north + south) / 2;
  return {
    closed: closing[0] === nw[0] && closing[1] === nw[1],
    northEdge: haversine(nw, ne),
    southEdge: haversine(sw, se),
    westEdge: haversine(nw, sw),
    eastEdge: haversine(ne, se),
    middleWidth: haversine([west, middle], [east, middle]),
    area: R * R * rad(east - west) * (Math.sin(rad(north)) - Math.sin(rad(south))),
  };
}

describe('squareAround', () => {
  // Equator, the user's own example latitude, the California fire, then higher
  // until cos(lat) is small, and the southern hemisphere.
  const LATITUDES = [0, 0.65, 39.25, 60, 70, 80, -45, -70];

  it.each(LATITUDES)('is a 6 km square in metres, not in degrees, at latitude %p', (lat) => {
    const square = squareAround({ lng: -122.95, lat }, DEFAULT_CLICK_AREA_METRES) as PolygonGeometry;
    const m = measure(square);

    expect(m.closed).toBe(true);
    // Meridian edges are exactly 6 km; parallel edges are 6 km across the middle
    // and within a whisker of it at the top and bottom.
    expect(m.westEdge).toBeCloseTo(6000, 1);
    expect(m.eastEdge).toBeCloseTo(6000, 1);
    expect(Math.abs(m.middleWidth - 6000)).toBeLessThan(1);
    expect(Math.abs(m.northEdge - 6000)).toBeLessThan(6000 * 0.005);
    expect(Math.abs(m.southEdge - 6000)).toBeLessThan(6000 * 0.005);
    // 36 km² to a tenth of a per cent.
    expect(Math.abs(m.area - 36e6) / 36e6).toBeLessThan(0.001);
  });

  it('is centred on the click', () => {
    const square = squareAround({ lng: -78.2526, lat: 0.6499 }, 6000) as PolygonGeometry;
    const [[west, north], , [east, south]] = square.coordinates[0];
    expect((west + east) / 2).toBeCloseTo(-78.2526, 10);
    expect((north + south) / 2).toBeCloseTo(0.6499, 10);
  });

  // The user's example, at its own latitude: ~0.0545° × 0.0533°.
  it("matches the size of the user's example box near the equator", () => {
    const square = squareAround({ lng: -78.2526, lat: 0.6499 }, 6000) as PolygonGeometry;
    const [[west, north], , [east, south]] = square.coordinates[0];
    expect(Math.abs(east - west - 0.05455) / 0.05455).toBeLessThan(0.02);
    expect(Math.abs(north - south - 0.05326) / 0.05326).toBeLessThan(0.02);
  });

  // The failure constant degrees would have produced: the same 0.0545° at 39° N
  // is only ~4.7 km wide. This one widens instead.
  it('is wider in degrees the further from the equator', () => {
    const width = (lat: number) => {
      const [[west], , [east]] = (squareAround({ lng: 0, lat }, 6000) as PolygonGeometry).coordinates[0];
      return east - west;
    };
    expect(width(39.25)).toBeGreaterThan(width(0) * 1.28);
    expect(width(70)).toBeGreaterThan(width(0) * 2.9);
  });

  it('refuses what it cannot build', () => {
    expect(squareAround({ lng: 0, lat: 88.99 }, 6000)).toBeNull();
    expect(squareAround({ lng: 0, lat: -89.5 }, 6000)).toBeNull();
    expect(squareAround({ lng: Number.NaN, lat: 0 }, 6000)).toBeNull();
    expect(squareAround({ lng: 0, lat: 91 }, 6000)).toBeNull();
    expect(squareAround({ lng: 0, lat: 0 }, 0)).toBeNull();
    expect(squareAround({ lng: 0, lat: 0 }, -6000)).toBeNull();
  });
});

describe('decideClickArea', () => {
  const FIRE = {
    kind: 'position' as const,
    position: { lng: -122.95, lat: 39.25 },
    layerId: 'puntos',
    layerType: 'point',
  };

  it('places a box around a clicked fire, replacing every figure already there', () => {
    const figures = [{ id: 'filter-rect', filterId: 'f1' }, { id: 'hand-polygon' }];
    const decision = decideClickArea({ clicked: FIRE, sideMetres: 6000, figures });
    expect(decision.action).toBe('place');
    if (decision.action === 'place') {
      expect(decision.replace).toEqual(figures);
      expect(decision.square).toEqual(squareAround(FIRE.position, 6000));
    }
  });

  it('changes nothing for a click on empty map, or no click state at all', () => {
    const figures = [{ id: 'hand-polygon' }];
    expect(decideClickArea({ clicked: { kind: 'empty' }, sideMetres: 6000, figures })).toEqual({ action: 'none' });
    expect(decideClickArea({ clicked: { kind: 'none' }, sideMetres: 6000, figures })).toEqual({ action: 'none' });
  });

  // The 5fdd463 lesson: an entity that yields no position is not a click on
  // bare map, and must not look like one.
  it('says so, distinctly, when a clicked entity has no position', () => {
    const decision = decideClickArea({
      clicked: {
        kind: 'unresolved',
        layerId: 'hex',
        layerType: 'hexagonId',
        reason: 'no lat/lng columns and no geometry',
      },
      sideMetres: 6000,
      figures: [],
    });
    expect(decision).toEqual({
      action: 'warn',
      message: 'click on layer hex (hexagonId) has no position to put a box around: no lat/lng columns and no geometry',
    });
  });

  it('says so when the position cannot take a box', () => {
    const decision = decideClickArea({
      clicked: { ...FIRE, position: { lng: 0, lat: 89.5 } },
      sideMetres: 6000,
      figures: [],
    });
    expect(decision.action).toBe('warn');
  });
});

describe('isSquareSuperseded', () => {
  it('keeps the box while it is the only figure', () => {
    expect(isSquareSuperseded({ squareId: 'sq', figures: [{ id: 'sq' }] })).toBe(false);
  });

  it('removes the box once the user has drawn something else', () => {
    expect(isSquareSuperseded({ squareId: 'sq', figures: [{ id: 'sq' }, { id: 'drawn' }] })).toBe(true);
    expect(isSquareSuperseded({ squareId: 'sq', figures: [{ id: 'rect', filterId: 'f' }, { id: 'sq' }] })).toBe(true);
  });

  it('does nothing when there is no box, or it is already gone', () => {
    expect(isSquareSuperseded({ squareId: null, figures: [{ id: 'drawn' }] })).toBe(false);
    expect(isSquareSuperseded({ squareId: 'sq', figures: [{ id: 'drawn' }] })).toBe(false);
  });
});
