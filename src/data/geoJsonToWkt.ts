interface GeoJsonGeometryLike {
  type: string;
  coordinates?: unknown;
}

/**
 * Serializes a GeoJSON areal geometry into canonical WKT.
 *
 * The inverse of `wkbToGeoJson`: that module decodes geometry arriving *from*
 * the database, this one encodes the figure the user drew on the map so a
 * dashboard variable can carry it back *into* a query —
 * `ST_GeomFromText($area, 4326)` in PostGIS, MobilityDB or DuckDB `spatial`.
 * GeoJSON positions are already `lng lat`, which is exactly WKT's axis order
 * for EPSG:4326, so the walk is a direct mapping.
 *
 * The output is deliberately canonical — a pinned micro-format, coordinates
 * rounded to 6 decimals (~0.1 m) and printed as plain numbers: the variable
 * travels in the URL and lands inside SQL, so it must never carry text this
 * function did not format, and a hand-drawn polygon must not inflate the URL
 * with float noise.
 *
 * Returns null for anything that is not a Polygon or MultiPolygon, or that is
 * malformed — a degenerate ring, a non-finite coordinate. Rings the editor
 * left open are closed; kepler's drawn features always arrive closed, but a
 * config that went through other tools may not.
 */
export function geoJsonToWkt(geometry: GeoJsonGeometryLike): string | null {
  if (geometry.type === 'Polygon') {
    const rings = polygonRings(geometry.coordinates);
    return rings ? `POLYGON ${rings}` : null;
  }
  if (geometry.type === 'MultiPolygon') {
    if (!Array.isArray(geometry.coordinates) || geometry.coordinates.length === 0) {
      return null;
    }
    const polygons = geometry.coordinates.map(polygonRings);
    if (polygons.some((p) => p === null)) {
      return null;
    }
    return `MULTIPOLYGON (${polygons.join(', ')})`;
  }
  return null;
}

/** `((x y, …), (x y, …))` for one polygon's outer ring and holes, or null. */
function polygonRings(coordinates: unknown): string | null {
  if (!Array.isArray(coordinates) || coordinates.length === 0) {
    return null;
  }
  const rings = coordinates.map(ringText);
  if (rings.some((r) => r === null)) {
    return null;
  }
  return `(${rings.join(', ')})`;
}

function ringText(ring: unknown): string | null {
  if (!Array.isArray(ring)) {
    return null;
  }
  const points = ring.map(pointText);
  if (points.some((p) => p === null)) {
    return null;
  }
  if (points.length > 0 && points[points.length - 1] !== points[0]) {
    points.push(points[0]);
  }
  // A closed ring needs at least a triangle: three corners plus the closure.
  if (points.length < 4) {
    return null;
  }
  return `(${points.join(', ')})`;
}

/** `x y`, rounded; Z and M are dropped — WKT for SQL is planar here. */
function pointText(position: unknown): string | null {
  if (!Array.isArray(position) || position.length < 2) {
    return null;
  }
  const [x, y] = position;
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }
  return `${round6(x)} ${round6(y)}`;
}

/** 6 decimals, plain notation — `Number` strips trailing zeros and never emits exponents at this scale. */
function round6(value: number): string {
  return String(Number(value.toFixed(6)));
}
