/**
 * Areas "Ask the map" filters by: a circle around a point, a box, a polygon
 * the model gives, or a figure the viewer drew. GeoJSON in EPSG:4326, [lon, lat].
 */

export type Ring = Array<[number, number]>;
export interface AreaGeometry {
  type: 'Polygon' | 'MultiPolygon';
  coordinates: Ring[] | Ring[][];
}

const KM_PER_DEG_LAT = 110.574;
const kmPerDegLon = (lat: number) => 111.32 * Math.cos((lat * Math.PI) / 180);

/** A circle of `radiusKm` around a point, as a 64-sided polygon (accurate to well under 1 % away from the poles). */
export function circlePolygon(lat: number, lon: number, radiusKm: number, sides = 64): AreaGeometry {
  const ring: Ring = [];
  const dLat = radiusKm / KM_PER_DEG_LAT;
  const dLon = radiusKm / Math.max(1e-6, kmPerDegLon(lat));
  for (let i = 0; i <= sides; i++) {
    const a = (i / sides) * 2 * Math.PI;
    ring.push([lon + dLon * Math.cos(a), lat + dLat * Math.sin(a)]);
  }
  ring[sides] = ring[0];
  return { type: 'Polygon', coordinates: [ring] };
}

export function bboxPolygon(west: number, south: number, east: number, north: number): AreaGeometry {
  return {
    type: 'Polygon',
    coordinates: [
      [
        [west, south],
        [east, south],
        [east, north],
        [west, north],
        [west, south],
      ],
    ],
  };
}

/** A closed polygon from [lon, lat] pairs; null when there are fewer than three distinct points. */
export function polygonFrom(points: unknown): AreaGeometry | null {
  if (!Array.isArray(points)) {
    return null;
  }
  const ring = points
    .filter((p): p is [number, number] => Array.isArray(p) && p.length >= 2 && p.every((n) => Number.isFinite(Number(n))))
    .map(([x, y]) => [Number(x), Number(y)] as [number, number]);
  if (ring.length < 3) {
    return null;
  }
  const [first, last] = [ring[0], ring[ring.length - 1]];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    ring.push([first[0], first[1]]);
  }
  return { type: 'Polygon', coordinates: [ring] };
}

/** Whether a point lies in a Polygon or MultiPolygon (holes respected, even-odd rule). */
export function contains(geometry: { type: string; coordinates?: unknown }, lon: number, lat: number): boolean {
  const polygons = (geometry.type === 'MultiPolygon' ? geometry.coordinates : [geometry.coordinates]) as Ring[][] | undefined;
  if (!Array.isArray(polygons)) {
    return false;
  }
  return polygons.some((rings) => {
    if (!Array.isArray(rings) || !rings.length) {
      return false;
    }
    return inRing(rings[0], lon, lat) && !rings.slice(1).some((hole) => inRing(hole, lon, lat));
  });
}

function inRing(ring: Ring, x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}
