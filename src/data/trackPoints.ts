import { type DataFrame, FieldType } from '@grafana/data';

import type { FieldRoles } from './detectFields';
import { PLACED_LATITUDE, PLACED_LONGITUDE } from './placeLookup';
import { wkbToGeometry } from './wkbToGeometry';

/**
 * Tracks whose pings come as point geometries: a GeoParquet, a FlatGeobuf or a feature service answer a point per
 * row in a geometry column, not a latitude and a longitude. With a trip id and a time beside it, that is a
 * trajectory, and kepler's Trip layer reads one only from coordinates (`columns: {lat, lng}`).
 *
 * So the frame trades the geometry column for a latitude and a longitude, under the names a placed frame takes, and
 * the roles point at them: everything downstream then sees an ordinary table of pings and builds the Trip layer.
 * The geometry goes, or kepler would also draw every ping as a point under the trips. A frame comes back as it was
 * unless every geometry it holds is a point.
 */
export function trackPoints(frame: DataFrame, roles: FieldRoles): { frame: DataFrame; roles: FieldRoles } {
  if (!roles.tripId || !roles.time || !roles.geometry || (roles.latitude && roles.longitude)) {
    return { frame, roles };
  }
  const geometry = frame.fields.find((f) => f.name === roles.geometry);
  if (!geometry) {
    return { frame, roles };
  }
  const lat: Array<number | null> = [];
  const lng: Array<number | null> = [];
  let points = 0;
  for (let i = 0; i < frame.length; i++) {
    const value = geometry.values[i];
    if (value === null || value === undefined || value === '') {
      lat.push(null);
      lng.push(null);
      continue;
    }
    const at = pointOf(value);
    if (!at) {
      return { frame, roles };
    }
    lng.push(at[0]);
    lat.push(at[1]);
    points++;
  }
  if (points === 0) {
    return { frame, roles };
  }
  return {
    frame: {
      ...frame,
      fields: [
        ...frame.fields.filter((f) => f !== geometry),
        { name: PLACED_LATITUDE, type: FieldType.number, config: {}, values: lat },
        { name: PLACED_LONGITUDE, type: FieldType.number, config: {}, values: lng },
      ],
    },
    roles: { ...roles, geometry: undefined, latitude: PLACED_LATITUDE, longitude: PLACED_LONGITUDE },
  };
}

/** A point geometry's longitude and latitude: GeoJSON (an object or its text), WKT or WKB hex. Null otherwise. */
function pointOf(value: unknown): [number, number] | null {
  let geometry: unknown = value;
  if (typeof value === 'string') {
    const text = value.trim();
    if (text.startsWith('{')) {
      try {
        geometry = JSON.parse(text);
      } catch {
        return null;
      }
    } else {
      const wkt = /^POINT\s*Z?M?\s*\(\s*(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)/i.exec(text);
      if (wkt) {
        return finitePair(Number(wkt[1]), Number(wkt[2]));
      }
      geometry = wkbToGeometry(text);
    }
  }
  const g = geometry as { type?: unknown; coordinates?: unknown; geometry?: unknown } | null;
  const shape = g?.type === 'Feature' ? (g.geometry as typeof g) : g;
  if (shape?.type !== 'Point' || !Array.isArray(shape.coordinates)) {
    return null;
  }
  return finitePair(Number(shape.coordinates[0]), Number(shape.coordinates[1]));
}

function finitePair(x: number, y: number): [number, number] | null {
  return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
}
