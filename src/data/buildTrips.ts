import { DataFrame } from '@grafana/data';

import { FieldRoles } from './detectFields';
import { KeplerRow } from './toKeplerDataset';

/**
 * A single point on a trip, before it becomes a coordinate.
 * `[lng, lat, alt, ts]` is the order kepler's Trip layer reads.
 */
interface TripPoint {
  lng: number;
  lat: number;
  alt: number;
  ts: number;
}

/**
 * Groups a point-per-row frame into one animated trip per trip id.
 *
 * kepler.gl builds a Trip layer from a GeoJSON dataset whose LineString
 * geometries carry a fourth coordinate — a timestamp. So each trip becomes one
 * row with a `_geojson` LineString of `[lng, lat, alt, ts]` coordinates, which
 * is exactly the geometry column shape the rest of the pipeline already feeds to
 * kepler; kepler then detects the timestamps and offers playback.
 *
 * Points are sorted by time within each trip (queries rarely guarantee order),
 * trips shorter than two points are dropped (a line needs two), and points
 * missing a coordinate or timestamp are skipped rather than poisoning the line.
 */
export function buildTrips(frame: DataFrame, roles: FieldRoles): KeplerRow[] {
  const { tripId, latitude, longitude, time, altitude } = roles;
  if (!tripId || !latitude || !longitude || !time) {
    return [];
  }

  const field = (name: string) => frame.fields.find((f) => f.name === name);
  const idField = field(tripId);
  const latField = field(latitude);
  const lngField = field(longitude);
  const timeField = field(time);
  const altField = altitude ? field(altitude) : undefined;

  if (!idField || !latField || !lngField || !timeField) {
    return [];
  }

  // Map keyed by trip id, in first-seen order, so output order is stable.
  const trips = new Map<unknown, TripPoint[]>();

  for (let i = 0; i < frame.length; i++) {
    const id = idField.values[i];
    const lat = latField.values[i];
    const lng = lngField.values[i];
    const ts = timeField.values[i];
    if (id == null || !isFinite(lat) || !isFinite(lng) || !isFinite(ts)) {
      continue;
    }

    const alt = altField ? Number(altField.values[i]) || 0 : 0;
    const points = trips.get(id) ?? [];
    points.push({ lng: Number(lng), lat: Number(lat), alt, ts: Number(ts) });
    trips.set(id, points);
  }

  const rows: KeplerRow[] = [];
  for (const [id, points] of trips) {
    if (points.length < 2) {
      continue;
    }
    points.sort((a, b) => a.ts - b.ts);

    const feature = {
      type: 'Feature',
      properties: { trip_id: id },
      geometry: {
        type: 'LineString',
        coordinates: points.map((p) => [p.lng, p.lat, p.alt, p.ts]),
      },
    };

    rows.push({ trip_id: id, _geojson: JSON.stringify(feature) });
  }

  return rows;
}

function isFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
