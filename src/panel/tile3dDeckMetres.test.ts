import { Ellipsoid } from '@math.gl/geospatial';
import { Matrix4, Vector3 } from '@math.gl/core';
// deck's own model of METER_OFFSETS: `addMetersToLngLat` is the arithmetic of
// the shader's `project_offset_`. Present through deck; not a dependency of ours.
import { addMetersToLngLat } from '@math.gl/web-mercator';

import { fitToDeck } from './tile3dAltitude';
import { deckMetreScale, inDeckMetres } from './tile3dDeckMetres';

const DEGREES = Math.PI / 180;
const WGS84_A = 6378137;
const WGS84_E2 = 6.69437999014e-3;

/**
 * A tile's content as loaders.gl leaves it (`calculateTransformProps`), for a
 * tile whose origin is at a longitude, latitude and height and whose geometry
 * is written in metres east, north and up of it — as a b3dm placed with
 * `RTC_CENTER` there is.
 */
function contentAt(longitude: number, latitude: number, height: number) {
  const cartesianOrigin = Ellipsoid.WGS84.cartographicToCartesian([longitude, latitude, height], new Vector3());
  const cartesianModelMatrix = Ellipsoid.WGS84.eastNorthUpToFixedFrame(cartesianOrigin);
  const cartographicOrigin = Ellipsoid.WGS84.cartesianToCartographic(cartesianOrigin, new Vector3());
  const cartographicModelMatrix = Ellipsoid.WGS84.eastNorthUpToFixedFrame(cartesianOrigin)
    .invert()
    .multiplyRight(cartesianModelMatrix);
  return {
    cartesianOrigin,
    cartesianModelMatrix,
    cartographicOrigin,
    cartographicModelMatrix,
    modelMatrix: cartographicModelMatrix,
  };
}

type Content = ReturnType<typeof contentAt>;

/**
 * How far deck draws a vertex of the content from where it is, in metres east
 * and north over the ground: deck's metre offsets from `modelMatrix`, against
 * the vertex put on the globe by the content's own ECEF matrix.
 */
function drawnOffBy(content: Content, vertex: number[]): { east: number; north: number; metres: number } {
  const offset = new Matrix4(content.modelMatrix).transform(vertex);
  const [drawnLongitude, drawnLatitude] = addMetersToLngLat(Array.from(content.cartographicOrigin), Array.from(offset));
  const onTheGlobe = content.cartesianModelMatrix.transform(vertex);
  const [longitude, latitude] = Ellipsoid.WGS84.cartesianToCartographic(onTheGlobe, new Vector3());
  const phi = latitude * DEGREES;
  const w = Math.sqrt(1 - WGS84_E2 * Math.sin(phi) ** 2);
  const east = (drawnLongitude - longitude) * DEGREES * (WGS84_A / w) * Math.cos(phi);
  const north = (drawnLatitude - latitude) * DEGREES * ((WGS84_A * (1 - WGS84_E2)) / w ** 3);
  return { east, north, metres: Math.hypot(east, north) };
}

/** The origin of the tile Cuenca's stadium comes in, in Cesium OSM Buildings, and where the stadium lies from it. */
const STADIUM_TILE = { longitude: -79.09459, latitude: -3.15929, height: 2399.6 };
const STADIUM = [9_883, 27_947, 88];

/** deck's sphere, from `@math.gl/web-mercator`'s own 40 030 km circumference. */
const DECK_RADIUS = 40.03e6 / (2 * Math.PI);

/**
 * What no matrix can take out at a latitude: deck's latitude, off the ground's
 * by half the tangent of the origin's latitude times (east² − north²) over the
 * Earth's radius — the tangent plane leaving the parallel, and deck's Mercator
 * scale held at the origin's latitude all the way north.
 */
function curvature(latitude: number, east: number, north: number): number {
  return (0.5 * Math.tan(latitude * DEGREES) * (east * east - north * north)) / DECK_RADIUS;
}

describe('fitToDeck, measured against deck’s own projection', () => {
  it('draws Cuenca’s stadium where it is, 29 km from the origin of its tile, rather than ~140 m south', () => {
    const content = contentAt(STADIUM_TILE.longitude, STADIUM_TILE.latitude, STADIUM_TILE.height);
    const before = drawnOffBy(content, STADIUM);
    expect(before.metres).toBeGreaterThan(140);
    expect(before.north).toBeLessThan(-140);

    expect(fitToDeck(content)).toBe(true);
    expect(drawnOffBy(content, STADIUM).metres).toBeLessThan(5);
  });

  it.each([
    ['on the equator', 0],
    ['at 45°N', 45],
    ['at 45°S', -45],
  ])('leaves %s only what no matrix can take out', (_where, latitude) => {
    const content = contentAt(-79, latitude, 300);
    const [east, north] = [9_883, 27_947];
    const before = drawnOffBy(content, [east, north, 0]);
    fitToDeck(content);
    const after = drawnOffBy(content, [east, north, 0]);

    // East was a sphere's metres, a hundredth of a percent or more short.
    expect(Math.abs(before.east)).toBeGreaterThan(10);
    // East, and north up to deck's own curvature, are now where the ground has
    // them. The curvature is nothing on the equator, and ~54 m at 45°.
    expect(Math.abs(after.east)).toBeLessThan(1);
    expect(Math.abs(after.north - curvature(latitude, east, north))).toBeLessThan(2);
  });

  it('draws within a few metres at 45° what lies within a few kilometres of its origin', () => {
    const content = contentAt(10, 45, 300);
    expect(drawnOffBy(content, [5_000, 0, 0]).metres).toBeGreaterThan(12);
    fitToDeck(content);
    expect(drawnOffBy(content, [5_000, 0, 0]).metres).toBeLessThan(2.5);
    expect(drawnOffBy(content, [3_000, 3_000, 0]).metres).toBeLessThan(0.5);
  });

  it('moves a building the size of AGI HQ by what it was off, under a metre, and puts it where it is', () => {
    // Exton, PA: a 566 m by 531 m mesh, drawn round its centre.
    const content = contentAt(-75.5967, 40.0388, 317.6);
    const corner = [282.88, 265.68, 20.37];
    const before = drawnOffBy(content, corner);
    const drawnBefore = new Matrix4(content.modelMatrix).transform(corner);
    fitToDeck(content);
    const drawnAfter = new Matrix4(content.modelMatrix).transform(corner);

    const moved = Math.hypot(drawnAfter[0] - drawnBefore[0], drawnAfter[1] - drawnBefore[1]);
    expect(moved).toBeLessThan(1);
    expect(moved).toBeCloseTo(before.metres, 1);
    expect(drawnOffBy(content, corner).metres).toBeLessThan(0.01);
    // Straight up is left as it was.
    expect(drawnAfter[2]).toBeCloseTo(drawnBefore[2], 9);
  });
});

describe('deckMetreScale', () => {
  it('is deck’s metres over the ellipsoid’s, east and north, at the height of the origin', () => {
    const [east, north] = deckMetreScale([-79, -3.15929, 2399.6])!;
    const phi = -3.15929 * DEGREES;
    const w = Math.sqrt(1 - WGS84_E2 * Math.sin(phi) ** 2);
    expect(east).toBeCloseTo(DECK_RADIUS / (WGS84_A / w + 2399.6), 12);
    expect(north).toBeCloseTo(DECK_RADIUS / ((WGS84_A * (1 - WGS84_E2)) / w ** 3 + 2399.6), 12);
    // A degree north is ~110.6 km on the ground near the equator and ~111.2 km to deck.
    expect(north).toBeGreaterThan(1.005);
  });

  it('is null for an origin it cannot read', () => {
    expect(deckMetreScale(null)).toBeNull();
    expect(deckMetreScale([0])).toBeNull();
    expect(deckMetreScale([0, Number.NaN, 0])).toBeNull();
    expect(deckMetreScale([0, 91, 0])).toBeNull();
  });
});

describe('inDeckMetres', () => {
  it('scales what a matrix gives east and north, translation included, and leaves up alone', () => {
    const matrix = Array.from(new Matrix4().translate([10, 20, 30]).rotateZ(0.3));
    const scaled = inDeckMetres(matrix, [2, 3]);
    const vertex = [4, 5, 6];
    const plain = new Matrix4(matrix).transform(vertex);
    const [x, y, z] = new Matrix4(scaled).transform(vertex);
    expect(x).toBeCloseTo(plain[0] * 2, 12);
    expect(y).toBeCloseTo(plain[1] * 3, 12);
    expect(z).toBeCloseTo(plain[2], 12);
    expect(matrix).toEqual(Array.from(new Matrix4().translate([10, 20, 30]).rotateZ(0.3)));
  });
});
