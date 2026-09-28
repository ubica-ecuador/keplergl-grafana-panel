import {
  altitudeOffsetFor,
  applyAltitude,
  baseAltitude,
  groundUnder,
  localUp,
  nextGround,
  spansTooWide,
  tilesetUp,
  upAt,
} from './tile3dAltitude';

/**
 * Stands in for math.gl's `Matrix4`, which is an `Array` subclass with a
 * `clone`. Only those two traits are used, and a real one would drag the whole
 * math.gl graph into a test about arithmetic.
 */
class FakeMatrix extends Array<number> {
  static identity(): FakeMatrix {
    const m = new FakeMatrix();
    m.push(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
    return m;
  }

  clone(): FakeMatrix {
    const m = new FakeMatrix();
    m.push(...this);
    return m;
  }
}

/**
 * The real root transform of the AGI HQ tileset — the scene this whole feature
 * came from. Column-major: elements 8..10 are the site's local vertical in
 * ECEF, and 12..14 its position on the globe.
 */
const AGI_TRANSFORM = [
  0.9685698432169108, 0.24874175124166173, 0, 0, -0.16001767508898374, 0.6230891826531153, 0.7656070886034095, 0,
  0.1904384479822422, -0.74154393777436, 0.6433084686837341, 0, 1216406.841449723, -4736461.695716812,
  4081475.752131637, 1,
];

/** The same tileset's own numbers, as loaders.gl reports them once parsed. */
const AGI_CENTRE_ALTITUDE = 317.6267942625335;
const AGI_HALF_HEIGHT = 20.368954658508315;

function tileset(overrides: Record<string, unknown> = {}) {
  return {
    modelMatrix: FakeMatrix.identity(),
    cartographicCenter: [-75.5967, 40.0388, AGI_CENTRE_ALTITUDE],
    root: {
      transform: AGI_TRANSFORM,
      header: { boundingVolume: { box: [0, 0, AGI_HALF_HEIGHT, 282.88, 0, 0, 0, 265.68, 0, 0, 0, AGI_HALF_HEIGHT] } },
    },
    ...overrides,
  };
}

/**
 * Google Photorealistic 3D Tiles' root, as `root.json` served it on
 * 2026-09-28: a cube centred on the centre of the Earth, with no transform.
 * Tileset3D reports the centre of the Earth's own "altitude" for it.
 */
const GOOGLE_ROOT_BOX = [0, 0, 0, 7645212, 0, 0, 0, 7645212, 0, 0, 0, 7645212];
const EARTH_CENTRE_ALTITUDE = -6356752.314245179;

/** Cesium OSM Buildings' root (ion asset 96188), as served on 2026-09-28: the whole world, with no transform. */
const OSM_BUILDINGS_REGION = [
  -3.1415925942485985, -1.4712182366024542, 3.141545370875028, 1.4502639200680947, -394.3409143207921,
  5967.300616082603,
];

/** A few blocks of central Cuenca, in radians, the way ion's tiler writes a city's buildings: region, no transform. */
const CUENCA_REGION = [-1.37916, -0.05066, -1.37846, -0.05036, 2490, 2610];

/** A building's box written straight in ECEF, with no transform: AGI HQ's centre and size. */
const AGI_ECEF_BOX = [1216406.84, -4736461.7, 4081475.75, 141, 0, 0, 0, 133, 0, 0, 0, AGI_HALF_HEIGHT];

function untransformed(boundingVolume: Record<string, number[]>, cartographicCenter: number[] | null) {
  return tileset({ cartographicCenter, root: { transform: null, header: { boundingVolume } } });
}

/** The ellipsoid's upward normal at a longitude and latitude in radians. */
function normalAt(lon: number, lat: number): number[] {
  return [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
}

describe('spansTooWide', () => {
  it('holds for Google’s globe, whose root is centred on the centre of the Earth', () => {
    expect(spansTooWide(untransformed({ box: GOOGLE_ROOT_BOX }, [0, 0, EARTH_CENTRE_ALTITUDE]))).toBe(true);
  });

  it('holds for a region around the whole world', () => {
    expect(spansTooWide(untransformed({ region: OSM_BUILDINGS_REGION }, [0, 0, 0]))).toBe(true);
  });

  it('holds for a sphere a country could fit in', () => {
    const country = untransformed({ sphere: [1216406, -4736461, 4081475, 2_000_000] }, [-75.6, 40, 300]);
    expect(spansTooWide(country)).toBe(true);
  });

  it('does not hold for a building or a city', () => {
    expect(spansTooWide(tileset())).toBe(false);
    expect(spansTooWide(untransformed({ region: CUENCA_REGION }, [-79.0, -2.9, 2550]))).toBe(false);
  });

  it('counts a region across the antimeridian by its real width', () => {
    // West greater than east: the region wraps round. Fiji is narrow, not a whole world wide.
    const fiji = [3.1, -0.32, -3.12, -0.28, 0, 1300];
    expect(spansTooWide(untransformed({ region: fiji }, [178, -17, 600]))).toBe(false);
  });

  it('does not hold when the tileset says nothing about its extent', () => {
    expect(spansTooWide(tileset({ root: { transform: null, header: {} } }))).toBe(false);
    expect(spansTooWide(null)).toBe(false);
  });
});

describe('upAt', () => {
  it('is the ellipsoid’s normal at a longitude and latitude in degrees', () => {
    const expected = normalAt((CUENCA.longitude * Math.PI) / 180, (CUENCA.latitude * Math.PI) / 180);
    upAt(CUENCA.longitude, CUENCA.latitude).forEach((value, axis) => expect(value).toBeCloseTo(expected[axis], 12));
  });
});

describe('tilesetUp', () => {
  it('reads the root transform when there is one', () => {
    expect(tilesetUp(tileset())).toEqual(localUp(AGI_TRANSFORM));
  });

  it('points a region with no transform up from the ground at its centre, not along the Earth’s axis', () => {
    // ion's tiler writes buildings this way. Near the equator the Earth's axis is
    // horizontal: grounding along it would slide Cuenca's buildings 2.5 km north.
    const lon = (CUENCA_REGION[0] + CUENCA_REGION[2]) / 2;
    const lat = (CUENCA_REGION[1] + CUENCA_REGION[3]) / 2;
    const up = tilesetUp(untransformed({ region: CUENCA_REGION }, [-79.0, -2.9, 2550]));
    normalAt(lon, lat).forEach((value, axis) => expect(up[axis]).toBeCloseTo(value, 12));
  });

  it('points a box written in ECEF with no transform up from the ground at its centre', () => {
    const up = tilesetUp(untransformed({ box: AGI_ECEF_BOX }, [-75.5967, 40.0388, AGI_CENTRE_ALTITUDE]));
    const expected = normalAt((-75.5967 * Math.PI) / 180, (40.0388 * Math.PI) / 180);
    expected.forEach((value, axis) => expect(up[axis]).toBeCloseTo(value, 12));
  });

  it('keeps straight up for a tileset drawn in metres round its own origin', () => {
    // Not on the globe at all: loaders.gl puts its centre near the centre of the Earth.
    const local = untransformed({ box: [0, 0, 10, 50, 0, 0, 0, 50, 0, 0, 0, 10] }, [0, 90, EARTH_CENTRE_ALTITUDE + 10]);
    expect(tilesetUp(local)).toEqual([0, 0, 1]);
    expect(tilesetUp(tileset({ root: { transform: null, header: { boundingVolume: {} } } }))).toEqual([0, 0, 1]);
  });
});

/** WGS 84, geodetic (radians, metres) to ECEF. */
function ecef(longitude: number, latitude: number, height: number): number[] {
  const n = 6378137 / Math.sqrt(1 - 6.69437999014e-3 * Math.sin(latitude) ** 2);
  return [
    (n + height) * Math.cos(latitude) * Math.cos(longitude),
    (n + height) * Math.cos(latitude) * Math.sin(longitude),
    (n * (1 - 6.69437999014e-3) + height) * Math.sin(latitude),
  ];
}

/** Parque Calderón, Cuenca, where the city stands at about 2 550 m. */
const CUENCA = { longitude: -79.0045, latitude: -2.8975 };

/**
 * A box the way Google writes a small tile: in ECEF, around a point, with
 * half-axes along the local east, north and up.
 */
function boxAround(longitude: number, latitude: number, height: number, half: number, halfUp: number): number[] {
  const lon = (longitude * Math.PI) / 180;
  const lat = (latitude * Math.PI) / 180;
  const east = [-Math.sin(lon), Math.cos(lon), 0];
  const north = [-Math.sin(lat) * Math.cos(lon), -Math.sin(lat) * Math.sin(lon), Math.cos(lat)];
  const up = normalAt(lon, lat);
  return [
    ...ecef(lon, lat, height),
    ...east.map((v) => v * half),
    ...north.map((v) => v * half),
    ...up.map((v) => v * halfUp),
  ];
}

type Tile = { header: { boundingVolume: Record<string, number[]>; transform?: number[] }; children: Tile[] };

function tile(boundingVolume: Record<string, number[]>, children: Tile[] = [], transform?: number[]): Tile {
  return { header: { boundingVolume, ...(transform ? { transform } : {}) }, children };
}

/** Google's tree as far as it is known over Cuenca once the city's tiles have loaded. */
function googleOverCuenca(): Tile {
  const city = tile({ box: boxAround(CUENCA.longitude, CUENCA.latitude, 2550, 400, 150) });
  const valley = tile({ box: boxAround(CUENCA.longitude, CUENCA.latitude, 3000, 20_000, 1200) }, [city]);
  return tile({ box: GOOGLE_ROOT_BOX }, [tile({ box: GOOGLE_ROOT_BOX }, [valley])]);
}

describe('groundUnder', () => {
  it('reads the ground under a point off the deepest box that holds it', () => {
    // The column enters the city's tile at its bottom, 150 m below its centre, and leaves it 150 m above.
    const sample = groundUnder({ root: googleOverCuenca() }, CUENCA.longitude, CUENCA.latitude);
    expect(sample?.height).toBeCloseTo(2400, 0);
    expect(sample?.top).toBeCloseTo(2700, 0);
    expect(sample?.leaf).toBe(true);
  });

  it('reads it off the deepest region that holds it', () => {
    const cuenca = tile({ region: CUENCA_REGION });
    const west = tile({ region: [-Math.PI, -1.47, 0, 1.45, -394, 5967] }, [cuenca]);
    const sample = groundUnder({ root: tile({ region: OSM_BUILDINGS_REGION }, [west]) }, -79.0, -2.89);
    expect(sample).toEqual({ height: 2490, top: 2610, leaf: true });
  });

  it('does not count as a leaf a tile whose content is a tileset still to load', () => {
    const nested = {
      header: { boundingVolume: { region: CUENCA_REGION }, contentUrl: 'blocks/7-71-66.json' },
      children: [],
    };
    const sample = groundUnder({ root: tile({ region: OSM_BUILDINGS_REGION }, [nested as Tile]) }, -79.0, -2.89);
    expect(sample?.leaf).toBe(false);
  });

  it('reads the tree deck traverses for the view, not the tileset’s first one', () => {
    // Tileset3D builds a tree of its own for each viewport (`roots`) and never
    // traverses `root`, which stays as it was built: nothing below it loads.
    const coarse = tile({ box: GOOGLE_ROOT_BOX }, [tile({ box: GOOGLE_ROOT_BOX })]);
    const tileset = { root: coarse, roots: { 'kepler-map': googleOverCuenca() } };
    expect(groundUnder(tileset, CUENCA.longitude, CUENCA.latitude, 'kepler-map')?.height).toBeCloseTo(2400, 0);
    expect(groundUnder(tileset, CUENCA.longitude, CUENCA.latitude, 'another-map')).toBeNull();
  });

  it('takes nothing from a tile too big to say where the ground is', () => {
    // Google's root holds the whole planet: the column is inside it from top to bottom.
    const onlyCoarse = tile({ box: GOOGLE_ROOT_BOX }, [tile({ box: GOOGLE_ROOT_BOX })]);
    expect(groundUnder({ root: onlyCoarse }, CUENCA.longitude, CUENCA.latitude)).toBeNull();
  });

  it('stops at a transform, which it cannot read heights through', () => {
    const moved = tile({ box: GOOGLE_ROOT_BOX }, [tile({ region: CUENCA_REGION }, [], AGI_TRANSFORM)]);
    expect(groundUnder({ root: moved }, -79.0, -2.89)).toBeNull();
  });

  it('is null away from every tile, and without a tree', () => {
    expect(groundUnder({ root: googleOverCuenca() }, 10, 45)).toBeNull();
    expect(groundUnder({ root: null }, 10, 45)).toBeNull();
    expect(groundUnder(null, 10, 45)).toBeNull();
  });
});

describe('nextGround', () => {
  const street = { cameraHeight: 1700 };
  const region = { cameraHeight: 400_000 };

  it('takes a sample whose tile, lowered by it, ends below the camera: what lies in it can load', () => {
    expect(nextGround({ height: 2400, top: 2700, leaf: false }, street, true, 0)).toEqual({
      ground: 2400,
      searched: false,
    });
  });

  it('takes a leaf however tall it is: there is nothing further down to find', () => {
    // A camera 545 m up and a city tile 2 km across: searching on would only
    // have sunk the tileset to the ceiling.
    expect(nextGround({ height: 2490, top: 4800, leaf: true }, { cameraHeight: 545 }, true, 0)).toEqual({
      ground: 2490,
      searched: false,
    });
  });

  it('takes a tall sample as it is from high up, where the whole mesh is below the camera anyway', () => {
    expect(nextGround({ height: 1800, top: 4200, leaf: false }, region, true, 0)).toEqual({
      ground: 1800,
      searched: false,
    });
    expect(nextGround(null, region, true, 1800)).toEqual({ ground: 1800, searched: false });
  });

  it('holds while tiles are still loading', () => {
    expect(nextGround(null, street, false, 1500)).toEqual({ ground: 1500, searched: false });
    expect(nextGround(null, street, false, null)).toEqual({ ground: 0, searched: false });
  });

  it('searches downwards once everything asked for has loaded and the ground is still unknown', () => {
    // Close up over Cuenca the mesh sits above the camera, so the tiles that
    // would say where the ground is are never asked for: lower it, and look again.
    expect(nextGround(null, street, true, null)).toEqual({ ground: 1500, searched: true });
    expect(nextGround(null, street, true, 1500)).toEqual({ ground: 3000, searched: true });
    // A tile from the valley floor to the peaks still reaches above the camera once lowered by its floor.
    expect(nextGround({ height: 2100, top: 4400, leaf: false }, street, true, 1500)).toEqual({
      ground: 3600,
      searched: true,
    });
  });

  it('never searches past the highest ground there is', () => {
    expect(nextGround(null, street, true, 8500)).toEqual({ ground: 9000, searched: true });
    expect(nextGround(null, street, true, 9000)).toEqual({ ground: 9000, searched: false });
  });
});

describe('localUp', () => {
  it('reads the local vertical off the root transform', () => {
    expect(localUp(AGI_TRANSFORM)).toEqual([0.1904384479822422, -0.74154393777436, 0.6433084686837341]);
  });

  it('normalises a scaled transform', () => {
    // A tileset free to carry a scale in its transform would otherwise move by
    // `offset * scale` metres, which is the kind of error that looks like a
    // wrong offset rather than a wrong axis.
    const scaled = [...AGI_TRANSFORM];
    scaled[8] *= 3;
    scaled[9] *= 3;
    scaled[10] *= 3;

    const [x, y, z] = localUp(scaled);
    expect(Math.hypot(x, y, z)).toBeCloseTo(1, 12);
    expect(x).toBeCloseTo(0.1904384479822422, 12);
  });

  it('falls back to straight up when there is no transform', () => {
    // A tileset that is not georeferenced draws in metre offsets from its own
    // origin, where straight up is straight up.
    expect(localUp(null)).toEqual([0, 0, 1]);
    expect(localUp(undefined)).toEqual([0, 0, 1]);
    expect(localUp(FakeMatrix.identity())).toEqual([0, 0, 1]);
  });

  it('falls back rather than dividing by zero on a degenerate column', () => {
    const flat = [...AGI_TRANSFORM];
    flat[8] = 0;
    flat[9] = 0;
    flat[10] = 0;
    expect(localUp(flat)).toEqual([0, 0, 1]);
  });
});

describe('baseAltitude', () => {
  it('takes the bottom of a box, not its centre', () => {
    // The centre is 20 m above the bottom here. Anchoring on the centre buries
    // the lower half of the building, which is what makes this worth a test.
    expect(baseAltitude(tileset())).toBeCloseTo(AGI_CENTRE_ALTITUDE - AGI_HALF_HEIGHT, 9);
  });

  it('takes the radius off a sphere', () => {
    const sphere = tileset({
      root: { transform: AGI_TRANSFORM, header: { boundingVolume: { sphere: [0, 0, 0, 40] } } },
    });
    expect(baseAltitude(sphere)).toBeCloseTo(AGI_CENTRE_ALTITUDE - 40, 9);
  });

  it('reads a region’s minimum height directly', () => {
    // A region states its own heights in metres above the ellipsoid, so there
    // is nothing to derive: the fifth value is the answer.
    const region = tileset({
      root: {
        transform: AGI_TRANSFORM,
        header: { boundingVolume: { region: [-1.3, 0.69, -1.29, 0.7, 88.5, 140.25] } },
      },
    });
    expect(baseAltitude(region)).toBe(88.5);
  });

  it('is null when the tileset says nothing usable', () => {
    // The centre altitude is the one thing that cannot be worked around: with
    // no centre there is no height to bring down to the ground plane.
    expect(baseAltitude(tileset({ cartographicCenter: null }))).toBeNull();
    expect(baseAltitude(tileset({ cartographicCenter: [0, 0, Number.NaN] }))).toBeNull();
    expect(baseAltitude(null)).toBeNull();
  });

  it('is null for a tileset spread too wide for one ground height', () => {
    // Google's "base" worked out from its root would be the centre of the Earth
    // minus 7 600 km, and grounding it shoved the whole globe out of view.
    expect(baseAltitude(untransformed({ box: GOOGLE_ROOT_BOX }, [0, 0, EARTH_CENTRE_ALTITUDE]))).toBeNull();
    expect(baseAltitude(untransformed({ region: OSM_BUILDINGS_REGION }, [0, 0, 0]))).toBeNull();
  });

  it('treats a missing bounding volume as no height at all', () => {
    // Nothing to subtract, so the centre is the best answer available — and a
    // better one than refusing, which would leave the layer invisible.
    const bare = tileset({ root: { transform: AGI_TRANSFORM, header: {} } });
    expect(baseAltitude(bare)).toBeCloseTo(AGI_CENTRE_ALTITUDE, 9);
    expect(baseAltitude(tileset({ root: null }))).toBeCloseTo(AGI_CENTRE_ALTITUDE, 9);
  });
});

describe('altitudeOffsetFor', () => {
  it('drops the base onto the ground plane by default', () => {
    expect(altitudeOffsetFor({}, tileset())).toBeCloseTo(-(AGI_CENTRE_ALTITUDE - AGI_HALF_HEIGHT), 9);
  });

  it('leaves the tileset where it is when grounding is off', () => {
    expect(altitudeOffsetFor({ groundTileset: false }, tileset())).toBe(0);
  });

  it('adds the manual trim on top of the grounding', () => {
    const grounded = -(AGI_CENTRE_ALTITUDE - AGI_HALF_HEIGHT);
    expect(altitudeOffsetFor({ altitudeOffset: 12 }, tileset())).toBeCloseTo(grounded + 12, 9);
    expect(altitudeOffsetFor({ groundTileset: false, altitudeOffset: 12 }, tileset())).toBe(12);
  });

  it('still honours the manual trim when the base cannot be worked out', () => {
    const unknown = tileset({ cartographicCenter: null });
    expect(altitudeOffsetFor({ altitudeOffset: -300 }, unknown)).toBe(-300);
  });

  it('moves a tileset spread too wide nowhere, whatever the knobs say', () => {
    // No single "up" serves the whole world: a trim along any one direction
    // slides the far side of the globe sideways, and a trim along the Earth's
    // axis slides the equator north.
    const google = untransformed({ box: GOOGLE_ROOT_BOX }, [0, 0, EARTH_CENTRE_ALTITUDE]);
    expect(altitudeOffsetFor({}, google)).toBe(0);
    expect(altitudeOffsetFor({ altitudeOffset: -2550 }, google)).toBe(0);
    expect(altitudeOffsetFor({ groundTileset: false, altitudeOffset: -2550 }, google)).toBe(0);
  });

  it('ignores a trim that is not a finite number', () => {
    expect(altitudeOffsetFor({ groundTileset: false, altitudeOffset: 'mucho' }, tileset())).toBe(0);
    expect(altitudeOffsetFor({ groundTileset: false, altitudeOffset: Number.NaN }, tileset())).toBe(0);
  });
});

describe('applyAltitude', () => {
  it('writes the offset along the local vertical', () => {
    const ts = tileset();
    expect(applyAltitude(ts, -300)).toBe(true);

    expect(ts.modelMatrix[12]).toBeCloseTo(-300 * 0.1904384479822422, 9);
    expect(ts.modelMatrix[13]).toBeCloseTo(-300 * -0.74154393777436, 9);
    expect(ts.modelMatrix[14]).toBeCloseTo(-300 * 0.6433084686837341, 9);
    // Only the translation is ours; the basis has to survive untouched.
    expect(Array.from(ts.modelMatrix).slice(0, 12)).toEqual(Array.from(FakeMatrix.identity()).slice(0, 12));
  });

  it('writes the offset of a region with no transform along the vertical at its centre', () => {
    const ts = untransformed({ region: CUENCA_REGION }, [-79.0, -2.9, 2550]);
    const lon = (CUENCA_REGION[0] + CUENCA_REGION[2]) / 2;
    const lat = (CUENCA_REGION[1] + CUENCA_REGION[3]) / 2;
    expect(applyAltitude(ts, -2490)).toBe(true);
    normalAt(lon, lat).forEach((value, axis) => expect(ts.modelMatrix[12 + axis]).toBeCloseTo(-2490 * value, 6));
  });

  it('writes along the up it is given, and leaves a move smaller than the tolerance undone', () => {
    // A tileset round the whole world is lowered along the vertical at the
    // centre of the view, and only re-lowered when that moves it by more than a
    // few tens of metres: every move re-traverses the whole tree.
    const ts = untransformed({ box: GOOGLE_ROOT_BOX }, [0, 0, EARTH_CENTRE_ALTITUDE]);
    const up = upAt(CUENCA.longitude, CUENCA.latitude);
    expect(applyAltitude(ts, -2400, { up, tolerance: 30 })).toBe(true);
    up.forEach((value, axis) => expect(ts.modelMatrix[12 + axis]).toBeCloseTo(-2400 * value, 6));

    expect(applyAltitude(ts, -2420, { up, tolerance: 30 })).toBe(false);
    expect(ts.modelMatrix[14]).toBeCloseTo(-2400 * up[2], 6);
    expect(applyAltitude(ts, -2460, { up, tolerance: 30 })).toBe(true);
  });

  it('replaces its own translation rather than accumulating it', () => {
    // `renderLayer` runs on every store change, so its own output comes back as
    // input; adding would walk the tileset off the planet.
    const ts = tileset();
    applyAltitude(ts, -300);
    applyAltitude(ts, -100);
    expect(ts.modelMatrix[14]).toBeCloseTo(-100 * 0.6433084686837341, 9);
  });

  it('reports no change when the offset is already applied', () => {
    // What stops a re-traversal being forced on every single render.
    const ts = tileset();
    expect(applyAltitude(ts, -300)).toBe(true);
    expect(applyAltitude(ts, -300)).toBe(false);
  });

  it('is a no-op without a matrix to write to', () => {
    expect(applyAltitude(null, -300)).toBe(false);
    expect(applyAltitude({ modelMatrix: null }, -300)).toBe(false);
  });

  it('refuses an offset that is not a finite number', () => {
    const ts = tileset();
    expect(applyAltitude(ts, Number.NaN)).toBe(false);
    expect(ts.modelMatrix[14]).toBe(0);
  });
});
