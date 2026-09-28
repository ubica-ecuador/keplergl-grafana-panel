/**
 * Metres as deck.gl draws them, which are not quite the ground's.
 *
 * deck draws every tile of a 3D tileset as a sublayer in
 * `COORDINATE_SYSTEM.METER_OFFSETS`: metres east, north and up of the tile's
 * origin (`Tile3DLayer`, `@deck.gl/geo-layers`), which loaders.gl works out from
 * the tile's geometry on the ellipsoid. deck turns those metres into the map's
 * Web Mercator on a **sphere** (deck 9.3, `@math.gl/web-mercator` 4.1):
 *
 * - `project_offset_` (`@deck.gl/core`, `shaderlib/project/project.glsl.js`)
 *   multiplies an offset by `commonUnitsPerWorldUnit + commonUnitsPerWorldUnit2 * offset.y`,
 *   which for metre offsets are `getDistanceScales`' `unitsPerMeter` and
 *   `unitsPerMeter2` at the origin (`viewport-uniforms.js`, `'meter-offsets'`);
 *   `addMetersToLngLat` is the same arithmetic, on the CPU.
 * - `getDistanceScales` (`@math.gl/web-mercator`, `web-mercator-utils.js`)
 *   counts `512 / 40 030 km / cos φ0` units to the metre, the same east and
 *   north: a sphere 40 030 km round, ~6 371 km in radius. Its second-order term
 *   scales the east offset by how far north the point is, which is the
 *   Mercator's own widening and right; the north offset has none.
 *
 * So to deck a degree of latitude is ~111.2 km everywhere, where on the ground
 * it is ~110.6 km near the equator and ~111.7 km near the poles; and a degree
 * of longitude ~111.2 km × cos φ, where the ground has ~111.3 km × cos φ on
 * the equator and ~111.7 km × cos φ near the poles. What lies far from its
 * tile's origin is drawn up to that many parts in a thousand of the distance
 * off. Cesium OSM Buildings keeps large buildings in coarse tiles, and Cuenca's
 * stadium, 28 km north of the origin of its tile, was drawn ~140 m south of the
 * stadium on the basemap.
 *
 * The fix is to hand deck the offsets in its own metres: east ones times its
 * radius over the ellipsoid's prime vertical radius N(φ0), north ones times its
 * radius over the meridian radius M(φ0), both at the origin's height. That is
 * a scale of the rows of the tile's drawing matrix ({@link inDeckMetres}), and
 * it takes out the error that grows with the distance.
 *
 * What a matrix cannot take out, because it grows with the square of the
 * distance:
 *
 * - **North and south, ½ tan φ0 (east² − north²) / R**: the tangent plane
 *   leaves the parallel as it goes east, and deck holds the Mercator's scale of
 *   the origin's latitude all the way north. Nothing on the equator, ~3 m for
 *   the stadium, ~60 m at 45° for a point 28 km north or south of its origin.
 *   On one side of the origin the old error in the scale had happened to
 *   cancel part of it, and a point there is now drawn further off than it
 *   was: towards the equator below ~48°, towards the pole above it — for 28 km,
 *   ~39 m further at 40° and ~56 m at 60°. The worst anywhere round the origin
 *   always drops: at 40° from ~90 m to ~52 m, at 60° from ~163 m to ~106 m.
 * - **Up, distance² / 2R**: the ground curves away below the tangent plane,
 *   and deck draws its metres up from a flat map: a building 30 km from its
 *   origin is drawn ~70 m lower than one on the same ground at the origin.
 *
 * Neither is ours to mend a vertex at a time.
 */

/** `@math.gl/web-mercator`'s `EARTH_CIRCUMFERENCE`, in metres: the sphere deck counts its metres on. */
const DECK_EARTH_CIRCUMFERENCE = 40.03e6;

/** deck's metres per radian, east (times cos φ) and north alike. */
const DECK_RADIUS = DECK_EARTH_CIRCUMFERENCE / (2 * Math.PI);

const WGS84_A = 6_378_137;
const WGS84_E2 = 6.69437999014e-3;

/**
 * How many of deck's metres make one of the ground's, east and north, at a
 * tile's origin (`[longitude, latitude, height]`, as loaders.gl gives it and
 * deck draws round). Null when the origin cannot be read.
 */
export function deckMetreScale(origin: ArrayLike<number> | null | undefined): [number, number] | null {
  if (!origin || origin.length < 2) {
    return null;
  }
  const latitude = origin[1];
  const height = origin.length > 2 && Number.isFinite(origin[2]) ? origin[2] : 0;
  if (!Number.isFinite(latitude) || Math.abs(latitude) > 90) {
    return null;
  }
  const sine = Math.sin((latitude * Math.PI) / 180);
  const w = Math.sqrt(1 - WGS84_E2 * sine * sine);
  const primeVertical = WGS84_A / w;
  const meridian = (WGS84_A * (1 - WGS84_E2)) / (w * w * w);
  return [DECK_RADIUS / (primeVertical + height), DECK_RADIUS / (meridian + height)];
}

/**
 * A column-major 4×4 matrix to metres east, north and up, turned into one to
 * deck's metres: its east and north rows scaled, translation included — the
 * scale applied after it.
 */
export function inDeckMetres(matrix: ArrayLike<number>, scale: readonly [number, number]): number[] {
  const out = Array.from({ length: 16 }, (_, i) => matrix[i]);
  for (let column = 0; column < 4; column++) {
    out[column * 4] *= scale[0];
    out[column * 4 + 1] *= scale[1];
  }
  return out;
}
