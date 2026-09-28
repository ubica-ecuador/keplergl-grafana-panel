import { Ellipsoid } from '@math.gl/geospatial';
import { Matrix4, Vector3 } from '@math.gl/core';

import {
  altitudeOffsetFor,
  applyAltitude,
  baseAltitude,
  catchUpTile,
  type TileContentLike,
  type TileLike,
  groundUnder,
  groundsUnderView,
  localUp,
  needsMove,
  nextGround,
  searchSettled,
  shiftContent,
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

describe('groundsUnderView', () => {
  it('holds for a world of regions or a world in one box, with no transform of its own', () => {
    expect(groundsUnderView(untransformed({ region: OSM_BUILDINGS_REGION }, [0, 0, 0]))).toBe(true);
    expect(groundsUnderView(untransformed({ box: GOOGLE_ROOT_BOX }, [0, 0, EARTH_CENTRE_ALTITUDE]))).toBe(true);
  });

  it('does not hold for a tileset that fits one ground height', () => {
    expect(groundsUnderView(tileset())).toBe(false);
    expect(groundsUnderView(untransformed({ region: CUENCA_REGION }, [-79.0, -2.9, 2550]))).toBe(false);
    expect(groundsUnderView(null)).toBe(false);
  });

  it('does not hold for a wide root that is transformed, or bounded by a sphere', () => {
    // The column under the view cannot be read through a transform, and a
    // sphere says nothing about where the ground is: such a tileset stays where
    // it is rather than being searched.
    const transformed = tileset({
      root: { transform: AGI_TRANSFORM, header: { boundingVolume: { box: GOOGLE_ROOT_BOX } } },
    });
    const declared = untransformed({ region: OSM_BUILDINGS_REGION }, [0, 0, 0]);
    (declared.root.header as Record<string, unknown>).transform = AGI_TRANSFORM;
    const sphere = untransformed({ sphere: [0, 0, 0, 7_000_000] }, [0, 0, EARTH_CENTRE_ALTITUDE]);

    expect(spansTooWide(transformed)).toBe(true);
    expect(groundsUnderView(transformed)).toBe(false);
    expect(groundsUnderView(declared)).toBe(false);
    expect(spansTooWide(sphere)).toBe(true);
    expect(groundsUnderView(sphere)).toBe(false);
  });

  it('takes an identity transform for no transform at all, as loaders.gl hands one to every tile', () => {
    const identity = untransformed({ box: GOOGLE_ROOT_BOX }, [0, 0, EARTH_CENTRE_ALTITUDE]);
    (identity.root as { transform: unknown }).transform = FakeMatrix.identity();
    expect(groundsUnderView(identity)).toBe(true);
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
    expect('height' in sample && sample.height).toBeCloseTo(2400, 0);
    expect('top' in sample && sample.top).toBeCloseTo(2700, 0);
    expect('leaf' in sample && sample.leaf).toBe(true);
  });

  it('reads it off the deepest region that holds it', () => {
    const cuenca = tile({ region: CUENCA_REGION });
    const west = tile({ region: [-Math.PI, -1.47, 0, 1.45, -394, 5967] }, [cuenca]);
    const sample = groundUnder({ root: tile({ region: OSM_BUILDINGS_REGION }, [west]) }, -79.0, -2.89);
    expect(sample).toEqual({ height: 2490, top: 2610, leaf: true });
  });

  it('reads a longitude past the antimeridian as the same place', () => {
    const cuenca = tile({ region: CUENCA_REGION });
    const west = tile({ region: [-Math.PI, -1.47, 0, 1.45, -394, 5967] }, [cuenca]);
    const world = { root: tile({ region: OSM_BUILDINGS_REGION }, [west]) };
    expect(groundUnder(world, -79.0 + 360, -2.89)).toEqual({ height: 2490, top: 2610, leaf: true });
    expect(groundUnder(world, -79.0 - 720, -2.89)).toEqual({ height: 2490, top: 2610, leaf: true });
  });

  it('looks under every child the column passes through, not only the first', () => {
    // Siblings may overlap: the first to hold the column can be a coarse one
    // that stops there, while the next reaches down to the city.
    const coarse = tile({ box: boxAround(CUENCA.longitude, CUENCA.latitude, 3000, 20_000, 1200) });
    const city = tile({ box: boxAround(CUENCA.longitude, CUENCA.latitude, 2550, 400, 150) });
    const valley = tile({ box: boxAround(CUENCA.longitude, CUENCA.latitude, 3000, 20_000, 1200) }, [city]);
    const sample = groundUnder(
      { root: tile({ box: GOOGLE_ROOT_BOX }, [coarse, valley]) },
      CUENCA.longitude,
      CUENCA.latitude
    );
    expect('height' in sample && sample.height).toBeCloseTo(2400, 0);
  });

  it('takes the lowest of two samples as deep as each other', () => {
    const high = tile({ box: boxAround(CUENCA.longitude, CUENCA.latitude, 2650, 400, 150) });
    const low = tile({ box: boxAround(CUENCA.longitude, CUENCA.latitude, 2550, 400, 150) });
    const sample = groundUnder(
      { root: tile({ box: GOOGLE_ROOT_BOX }, [high, low]) },
      CUENCA.longitude,
      CUENCA.latitude
    );
    expect('height' in sample && sample.height).toBeCloseTo(2400, 0);
  });

  it('reads a box with no thickness as a slab rather than missing it', () => {
    const slab = boxAround(CUENCA.longitude, CUENCA.latitude, 2500, 400, 0);
    const sample = groundUnder(
      { root: tile({ box: GOOGLE_ROOT_BOX }, [tile({ box: slab })]) },
      CUENCA.longitude,
      CUENCA.latitude
    );
    expect('height' in sample && sample.height).toBeCloseTo(2500, 3);
    expect('top' in sample && sample.top).toBeCloseTo(2500, 3);
  });

  it('does not count as a leaf a tile whose content is a tileset still to load', () => {
    const nested = {
      header: { boundingVolume: { region: CUENCA_REGION }, contentUrl: 'blocks/7-71-66.json' },
      children: [],
    };
    const sample = groundUnder({ root: tile({ region: OSM_BUILDINGS_REGION }, [nested as Tile]) }, -79.0, -2.89);
    expect('leaf' in sample && sample.leaf).toBe(false);
  });

  it('reads the tree deck traverses for the view, not the tileset’s first one', () => {
    // Tileset3D builds a tree of its own for each viewport (`roots`) and never
    // traverses `root`, which stays as it was built: nothing below it loads.
    const coarse = tile({ box: GOOGLE_ROOT_BOX }, [tile({ box: GOOGLE_ROOT_BOX })]);
    const tileset = { root: coarse, roots: { 'kepler-map': googleOverCuenca() } };
    const sample = groundUnder(tileset, CUENCA.longitude, CUENCA.latitude, 'kepler-map');
    expect('height' in sample && sample.height).toBeCloseTo(2400, 0);
    // No tree for that view yet: nothing can be read, which is not the same as nothing being there.
    expect(groundUnder(tileset, CUENCA.longitude, CUENCA.latitude, 'another-map')).toEqual({ none: 'unreadable' });
  });

  it('says so when only tiles too big to tell hold the column, and more of the tree is still to load', () => {
    // Google's root holds the whole planet: the column is inside it from top to bottom.
    const nested = { header: { boundingVolume: { box: GOOGLE_ROOT_BOX }, contentUrl: 'subtree.json' }, children: [] };
    const onlyCoarse = tile({ box: GOOGLE_ROOT_BOX }, [nested as Tile]);
    expect(groundUnder({ root: onlyCoarse }, CUENCA.longitude, CUENCA.latitude)).toEqual({ none: 'coarse' });
  });

  it('says nothing is there where the tree has no tile under the column, as OSM Buildings over the sea', () => {
    const cuenca = tile({ region: CUENCA_REGION });
    const west = tile({ region: [-Math.PI, -1.47, 0, 1.45, -394, 5967] }, [cuenca]);
    const world = { root: tile({ region: OSM_BUILDINGS_REGION }, [west]) };
    // The Pacific off Ecuador: inside the world and the west, under none of their tiles.
    expect(groundUnder(world, -85, -2)).toEqual({ none: 'missed' });
    // A big tile with nothing more to come holds nothing more to find either.
    expect(groundUnder({ root: tile({ box: GOOGLE_ROOT_BOX }) }, 10, 45)).toEqual({ none: 'missed' });
    expect(groundUnder({ root: googleOverCuenca() }, 10, 45)).toEqual({ none: 'missed' });
  });

  it('does not read through a transform', () => {
    const moved = tile({ box: GOOGLE_ROOT_BOX }, [tile({ region: CUENCA_REGION }, [], AGI_TRANSFORM)]);
    expect('height' in groundUnder({ root: moved }, -79.0, -2.89)).toBe(false);
    expect(groundUnder({ root: tile({ region: CUENCA_REGION }, [], AGI_TRANSFORM) }, -79.0, -2.89)).toEqual({
      none: 'unreadable',
    });
  });

  it('cannot read a missing tree', () => {
    expect(groundUnder({ root: null }, 10, 45)).toEqual({ none: 'unreadable' });
    expect(groundUnder(null, 10, 45)).toEqual({ none: 'unreadable' });
  });
});

describe('nextGround', () => {
  const street = { cameraHeight: 1700 };
  const region = { cameraHeight: 400_000 };
  const coarse = { none: 'coarse' } as const;

  it('takes a sample whose tile, lowered by it, ends below the camera: what lies in it can load', () => {
    expect(nextGround({ height: 2400, top: 2700, leaf: false }, street, true, 0, null)).toEqual({
      ground: 2400,
      searched: false,
      sampled: true,
    });
  });

  it('takes a leaf however tall it is: there is nothing further down to find', () => {
    // A camera 545 m up and a city tile 2 km across: searching on would only
    // have sunk the tileset to the ceiling.
    expect(nextGround({ height: 2490, top: 4800, leaf: true }, { cameraHeight: 545 }, true, 0, null)).toEqual({
      ground: 2490,
      searched: false,
      sampled: true,
    });
  });

  it('takes a tall sample as it is from high up, where the whole mesh is below the camera anyway', () => {
    expect(nextGround({ height: 1800, top: 4200, leaf: false }, region, true, 0, null)).toEqual({
      ground: 1800,
      searched: false,
      sampled: true,
    });
    expect(nextGround(coarse, region, true, 1800, 1800)).toEqual({ ground: 1800, searched: false, sampled: false });
  });

  it('holds while tiles are still loading', () => {
    expect(nextGround(coarse, street, false, 1500, null)).toEqual({ ground: 1500, searched: false, sampled: false });
    expect(nextGround(coarse, street, false, null, null)).toEqual({ ground: 0, searched: false, sampled: false });
  });

  it('searches downwards once everything asked for has loaded and only tiles too big to tell are known', () => {
    // Close up over Cuenca the mesh sits above the camera, so the tiles that
    // would say where the ground is are never asked for: lower it, and look again.
    expect(nextGround(coarse, street, true, null, null)).toEqual({ ground: 1500, searched: true, sampled: false });
    expect(nextGround(coarse, street, true, 1500, null)).toEqual({ ground: 3000, searched: true, sampled: false });
    // A tile from the valley floor to the peaks still reaches above the camera once lowered by its floor.
    expect(nextGround({ height: 2100, top: 4400, leaf: false }, street, true, 1500, null)).toEqual({
      ground: 3600,
      searched: true,
      sampled: false,
    });
  });

  it('does not search where nothing can be read, or where nothing is there, and holds the last ground sampled', () => {
    // No tree for the view yet, or OSM Buildings over the sea: lowering the
    // tileset would find nothing, and would sink the coast's buildings.
    for (const none of ['unreadable', 'missed'] as const) {
      expect(nextGround({ none }, street, true, null, null)).toEqual({ ground: 0, searched: false, sampled: false });
      expect(nextGround({ none }, street, true, 2400, 2400)).toEqual({ ground: 2400, searched: false, sampled: false });
      expect(nextGround({ none }, region, true, 2400, 2400)).toEqual({ ground: 2400, searched: false, sampled: false });
    }
  });

  it('drops a searched ground once the reading turns to nothing there, as OSM Buildings over the sea', () => {
    // Before the western hemisphere's own tileset loads, the sea off Ecuador is
    // under a tile too big to tell, and the search lowers the tileset. Once it
    // loads there is nothing there: holding the searched ground would leave the
    // coast's buildings that far underground.
    const searched = nextGround(coarse, street, true, null, null);
    expect(searched).toEqual({ ground: 1500, searched: true, sampled: false });
    expect(nextGround({ none: 'missed' }, street, true, searched.ground, null)).toEqual({
      ground: 0,
      searched: false,
      sampled: false,
    });
    // Back to the last ground a tile actually told, when there was one.
    expect(nextGround({ none: 'missed' }, street, true, 3000, 2400)).toEqual({
      ground: 2400,
      searched: false,
      sampled: false,
    });
  });

  it('never searches past the highest ground there is', () => {
    expect(nextGround(coarse, street, true, 8500, null)).toEqual({ ground: 9000, searched: true, sampled: false });
    expect(nextGround(coarse, street, true, 9000, null)).toEqual({ ground: 9000, searched: false, sampled: false });
  });
});

describe('searchSettled', () => {
  it('waits for a traversal after the last step', () => {
    expect(searchSettled({ loaded: true, frame: undefined, stepFrame: null, now: 0, stepTime: null })).toBe(false);
    expect(searchSettled({ loaded: true, frame: 4, stepFrame: 4, now: 60_000, stepTime: 0 })).toBe(false);
  });

  it('is settled once everything asked for has loaded', () => {
    expect(searchSettled({ loaded: true, frame: 1, stepFrame: null, now: 0, stepTime: null })).toBe(true);
    expect(searchSettled({ loaded: true, frame: 5, stepFrame: 4, now: 10, stepTime: 0 })).toBe(true);
  });

  it('is settled after enough traversals, or long enough, even while tiles still load', () => {
    // Under throttling something is always loading, and `isLoaded` never comes true.
    expect(searchSettled({ loaded: false, frame: 5, stepFrame: 4, now: 100, stepTime: 0 })).toBe(false);
    expect(searchSettled({ loaded: false, frame: 24, stepFrame: 4, now: 100, stepTime: 0 })).toBe(true);
    expect(searchSettled({ loaded: false, frame: 5, stepFrame: 4, now: 3_000, stepTime: 0 })).toBe(true);
    expect(searchSettled({ loaded: false, frame: 20, stepFrame: null, now: 0, stepTime: null })).toBe(true);
  });
});

describe('needsMove', () => {
  const up = upAt(CUENCA.longitude, CUENCA.latitude);

  it('moves the first time', () => {
    expect(needsMove(null, { ground: 0, trim: 0, up }, 30)).toBe(true);
  });

  it('leaves a small change of ground undone: every move re-traverses the whole tree', () => {
    expect(needsMove({ ground: 2400, trim: 0, up }, { ground: 2420, trim: 0, up }, 30)).toBe(false);
    expect(needsMove({ ground: 2400, trim: 0, up }, { ground: 2430, trim: 0, up }, 30)).toBe(true);
  });

  it('moves for any change of the trim, however small', () => {
    // A Height adjustment of 20 m is what the user asked for: it is not noise.
    expect(needsMove({ ground: 2400, trim: 0, up }, { ground: 2400, trim: 20, up }, 30)).toBe(true);
    expect(needsMove({ ground: 2400, trim: 0, up }, { ground: 2410, trim: 1, up }, 30)).toBe(true);
  });

  it('moves when the vertical has turned far enough to shift the tileset by more than the tolerance', () => {
    const nearby = upAt(CUENCA.longitude + 0.01, CUENCA.latitude);
    const farther = upAt(CUENCA.longitude + 1, CUENCA.latitude);
    expect(needsMove({ ground: 2400, trim: 0, up }, { ground: 2400, trim: 0, up: nearby }, 30)).toBe(false);
    expect(needsMove({ ground: 2400, trim: 0, up }, { ground: 2400, trim: 0, up: farther }, 30)).toBe(true);
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

  it('gives a tileset spread too wide no offset of its own, whatever the knobs say', () => {
    // No single "up" serves the whole world: a trim along any one direction
    // slides the far side of the globe sideways, and a trim along the Earth's
    // axis slides the equator north. The layer lowers such a tileset by the
    // ground under the view instead, with the trim along the vertical there.
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

  it('writes along the up it is given', () => {
    // A tileset round the whole world is lowered along the vertical at the
    // centre of the view; whether a move is worth a traversal is `needsMove`'s call.
    const ts = untransformed({ box: GOOGLE_ROOT_BOX }, [0, 0, EARTH_CENTRE_ALTITUDE]);
    const up = upAt(CUENCA.longitude, CUENCA.latitude);
    expect(applyAltitude(ts, -2400, { up })).toBe(true);
    up.forEach((value, axis) => expect(ts.modelMatrix[12 + axis]).toBeCloseTo(-2400 * value, 6));
    expect(applyAltitude(ts, -2420, { up })).toBe(true);
    up.forEach((value, axis) => expect(ts.modelMatrix[12 + axis]).toBeCloseTo(-2420 * value, 6));
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

/**
 * A tile's content as loaders.gl leaves it once loaded, for a tile whose
 * bounding volume is centred at `centre` and whose geometry is drawn by
 * `model` (`calculateTransformProps`, @loaders.gl/tiles).
 *
 * Built with math.gl on purpose: these are the numbers deck draws with, and
 * the point of the tests below is that a shifted tile ends up with exactly the
 * numbers loaders.gl would have given it had it loaded where it now is.
 */
function loadedContent(centre: number[], model: number[]) {
  const cartesianOrigin = new Vector3(centre);
  const cartesianModelMatrix = new Matrix4(model);
  const cartographicOrigin = Ellipsoid.WGS84.cartesianToCartographic(cartesianOrigin, new Vector3());
  const cartographicModelMatrix = Ellipsoid.WGS84.eastNorthUpToFixedFrame(cartesianOrigin)
    .invert()
    .multiplyRight(cartesianModelMatrix);
  return {
    cartesianOrigin,
    cartesianModelMatrix,
    cartographicOrigin,
    cartographicModelMatrix,
    // loaders.gl's deprecated alias, which is the one deck actually reads.
    modelMatrix: cartographicModelMatrix,
  };
}

/** A city tile over Cuenca: centred 2 550 m up, glTF turned from Y up to Z up as loaders.gl does. */
function cuencaContent() {
  const centre = ecef((CUENCA.longitude * Math.PI) / 180, (CUENCA.latitude * Math.PI) / 180, 2550);
  const model = new Matrix4().translate(centre).rotateX(Math.PI / 2);
  return loadedContent(centre, Array.from(model));
}

function expectCloseTo(actual: ArrayLike<number>, expected: ArrayLike<number>, digits: number) {
  expect(actual.length).toBe(expected.length);
  Array.from(expected).forEach((value, i) => expect(actual[i]).toBeCloseTo(value, digits));
}

describe('shiftContent', () => {
  const down = upAt(CUENCA.longitude, CUENCA.latitude).map((v) => v * -2400) as [number, number, number];

  it('moves a loaded tile to where it would have loaded had the tileset already been moved', () => {
    const content = cuencaContent();
    const centre = Array.from(content.cartesianOrigin);
    const model = Array.from(content.cartesianModelMatrix);

    expect(shiftContent(content, down)).toBe(true);

    const moved = [0, 1, 2].map((axis) => centre[axis] + down[axis]);
    const expected = loadedContent(moved, Array.from(new Matrix4().translate(down).multiplyRight(new Matrix4(model))));
    expectCloseTo(content.cartesianOrigin, expected.cartesianOrigin, 6);
    expectCloseTo(content.cartesianModelMatrix, expected.cartesianModelMatrix, 6);
    expectCloseTo(content.cartographicOrigin.slice(0, 2), expected.cartographicOrigin.slice(0, 2), 10);
    expect(content.cartographicOrigin[2]).toBeCloseTo(expected.cartographicOrigin[2], 4);
    expect(content.cartographicOrigin[2]).toBeCloseTo(150, 4);
    expectCloseTo(content.cartographicModelMatrix, expected.cartographicModelMatrix, 6);
  });

  it('hands deck new values in new objects of the same kind, and keeps the alias it reads', () => {
    // deck compares a sublayer's modelMatrix and coordinateOrigin with the last
    // ones: written in place, they would compare equal to themselves.
    const content = cuencaContent();
    const before = { ...content };
    shiftContent(content, down);

    expect(content.cartesianOrigin).not.toBe(before.cartesianOrigin);
    expect(content.cartographicOrigin).not.toBe(before.cartographicOrigin);
    expect(content.cartographicModelMatrix).not.toBe(before.cartographicModelMatrix);
    expect(content.cartesianModelMatrix).toBeInstanceOf(Matrix4);
    expect(content.cartographicModelMatrix).toBeInstanceOf(Matrix4);
    expect(content.cartographicOrigin).toBeInstanceOf(Vector3);
    expect(content.modelMatrix).toBe(content.cartographicModelMatrix);
    expect(before.cartesianOrigin[0]).not.toBeCloseTo(content.cartesianOrigin[0], 3);
  });

  it('leaves a model matrix of the content’s own alone', () => {
    // I3S sets its own, which is not the cartographic one.
    const content = { ...cuencaContent(), modelMatrix: new Matrix4() };
    shiftContent(content, down);
    expect(Array.from(content.modelMatrix)).toEqual(Array.from(new Matrix4()));
  });

  it('does nothing to a tile whose content has not been placed', () => {
    expect(shiftContent({}, down)).toBe(false);
    expect(shiftContent(null, down)).toBe(false);
  });
});

/** A loaded Tile3D, as far as moving it reads it. */
function loadedTile(content: TileContentLike | null, children: TileLike[] = []): TileLike {
  return { header: { boundingVolume: {} }, content, children };
}

describe('applyAltitude, with tiles already loaded', () => {
  it('moves every loaded tile of every tree the tileset keeps, once each', () => {
    // loaders.gl works out a tile's drawing transform once, when its content
    // loads, and deck draws with it for ever: lowering the tileset afterwards
    // moved the volumes the traversal culls against and left the drawn
    // geometry where it had been.
    const up = upAt(CUENCA.longitude, CUENCA.latitude);
    const [first, second, third] = [cuencaContent(), cuencaContent(), cuencaContent()];
    const start = Array.from(first.cartesianOrigin);
    const shared = loadedTile(first);
    const unloaded = loadedTile(null);
    const ts = {
      ...untransformed({ box: GOOGLE_ROOT_BOX }, [0, 0, EARTH_CENTRE_ALTITUDE]),
      roots: {
        'kepler-map': loadedTile(null, [shared, unloaded]),
        'another-map': loadedTile(null, [loadedTile(second, [loadedTile(third)])]),
      },
      // Tileset3D's `tiles`: the same tile objects again, which must not move twice.
      tiles: [shared],
    };

    expect(applyAltitude(ts, -2400, { up })).toBe(true);
    [first, second, third].forEach((content) =>
      [0, 1, 2].forEach((axis) => expect(content.cartesianOrigin[axis]).toBeCloseTo(start[axis] - 2400 * up[axis], 6))
    );
    expect(unloaded.content).toBeNull();

    // By the change only: the translation is replaced, and so is what the tiles carry.
    expect(applyAltitude(ts, -2500, { up })).toBe(true);
    [0, 1, 2].forEach((axis) => expect(first.cartesianOrigin[axis]).toBeCloseTo(start[axis] - 2500 * up[axis], 6));
    expect(first.cartographicOrigin[2]).toBeCloseTo(50, 3);
  });

  it('moves the loaded tiles of a tileset grounded the ordinary way too', () => {
    const content = cuencaContent();
    const start = Array.from(content.cartesianOrigin);
    const ts = { ...tileset(), roots: { 'kepler-map': loadedTile(content) } };
    applyAltitude(ts, -300);
    const up = localUp(AGI_TRANSFORM);
    [0, 1, 2].forEach((axis) => expect(content.cartesianOrigin[axis]).toBeCloseTo(start[axis] - 300 * up[axis], 6));
  });

  it('moves nothing when the tileset does not move', () => {
    const content = cuencaContent();
    const ts = { ...tileset(), roots: { 'kepler-map': loadedTile(content) } };
    applyAltitude(ts, -300);
    const placed = content.cartesianOrigin;
    expect(applyAltitude(ts, -300)).toBe(false);
    expect(content.cartesianOrigin).toBe(placed);
  });
});

describe('catchUpTile', () => {
  /** A tile under a parent with a transform of its own, whose transforms were worked out under `model`. */
  function tileUnder(model: Matrix4, content: Record<string, unknown>) {
    const parentTransform = new Matrix4().translate([10, 20, 30]).rotateZ(0.3);
    const ownTransform = new Matrix4().translate([1, 2, 3]);
    const parent = { transform: parentTransform, computedTransform: model.clone().multiplyRight(parentTransform) };
    return {
      parent,
      transform: ownTransform,
      computedTransform: parent.computedTransform.clone().multiplyRight(ownTransform),
      content,
      header: {},
    };
  }

  it('moves a tile that loaded against where the tileset was, by how far it has moved since', () => {
    // A tile still loading when the tileset moved, and not traversed since,
    // loads with the transform worked out before the move.
    const down = upAt(CUENCA.longitude, CUENCA.latitude).map((v) => v * -2400);
    const content = cuencaContent();
    const start = Array.from(content.cartesianOrigin);
    const loaded = tileUnder(new Matrix4(), content);
    const tile = { ...loaded, tileset: { modelMatrix: new Matrix4().translate(down) } };

    expect(catchUpTile(tile)).toBe(true);
    [0, 1, 2].forEach((axis) => expect(content.cartesianOrigin[axis]).toBeCloseTo(start[axis] + down[axis], 6));
  });

  it('leaves a tile that loaded where the tileset is', () => {
    const model = new Matrix4().translate([100, -200, 300]);
    const content = cuencaContent();
    const placed = content.cartesianOrigin;
    const tile = { ...tileUnder(model, content), tileset: { modelMatrix: model } };
    expect(catchUpTile(tile)).toBe(false);
    expect(content.cartesianOrigin).toBe(placed);
  });

  it('survives a tile it cannot read', () => {
    expect(catchUpTile(null)).toBe(false);
    expect(catchUpTile({ content: cuencaContent() })).toBe(false);
  });
});
