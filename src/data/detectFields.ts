import { DataFrame, FieldType } from '@grafana/data';

/**
 * Which column plays which part in a geospatial dataset.
 *
 * Values are field names, not indices, so a mapping stays valid when a query is
 * edited and the column order changes.
 */
export interface FieldRoles {
  latitude?: string;
  longitude?: string;
  time?: string;
  tripId?: string;
  /** Optional third dimension for trip paths; defaults to 0 when unmapped. */
  altitude?: string;
  geometry?: string;
  h3?: string;
  /** Origin/destination pairs feeding the flow layer. */
  originLat?: string;
  originLng?: string;
  destLat?: string;
  destLng?: string;
  originH3?: string;
  destH3?: string;
  count?: string;
}

/**
 * Candidate column names per role, matched case-insensitively and exactly.
 *
 * Exact matching is deliberate: substring matching would make `origin_lat`
 * satisfy `lat` and silently turn an origin/destination table into a plain
 * point layer.
 */
const NAME_CANDIDATES: Record<string, string[]> = {
  latitude: ['latitude', 'lat', 'y'],
  longitude: ['longitude', 'lon', 'lng', 'long', 'x'],
  tripId: ['trip_id', 'tripid', 'track_id', 'trackid', 'trajectory_id', 'vehicle_id', 'journey_id'],
  altitude: ['altitude', 'alt', 'elevation', 'z'],
  geometry: ['geom', 'geometry', 'the_geom', 'wkb_geometry', 'geojson', 'wkt', 'shape'],
  h3: ['h3', 'h3_index', 'hex_id', 'hexagon', 'h3index'],
  originLat: ['origin_lat', 'origin_latitude', 'from_lat', 'start_lat', 'source_lat', 'pickup_lat', 'lat0'],
  originLng: [
    'origin_lon',
    'origin_lng',
    'origin_long',
    'origin_longitude',
    'from_lon',
    'from_lng',
    'start_lon',
    'start_lng',
    'source_lon',
    'source_lng',
    'pickup_lon',
    'pickup_lng',
    'lng0',
    'lon0',
  ],
  destLat: ['dest_lat', 'dest_latitude', 'destination_lat', 'to_lat', 'end_lat', 'target_lat', 'dropoff_lat', 'lat1'],
  destLng: [
    'dest_lon',
    'dest_lng',
    'dest_long',
    'dest_longitude',
    'destination_lon',
    'destination_lng',
    'to_lon',
    'to_lng',
    'end_lon',
    'end_lng',
    'target_lon',
    'target_lng',
    'dropoff_lon',
    'dropoff_lng',
    'lng1',
    'lon1',
  ],
  originH3: ['origin_h3', 'source_h3', 'from_h3', 'h3_0'],
  destH3: ['dest_h3', 'target_h3', 'to_h3', 'h3_1'],
  count: ['count', 'trips', 'magnitude', 'weight', 'flow', 'total', 'volume'],
};

/**
 * Infers field roles from a DataFrame by column name and type.
 *
 * This is only ever a starting point: the panel's field mapping editor lets the
 * user override every role. The Foursquare plugin has no such escape hatch — it
 * demands columns named exactly `latitude`/`longitude`/`time`, which forces
 * users to rewrite their queries around the plugin.
 */
export function detectFields(frame: DataFrame): FieldRoles {
  const roles: FieldRoles = {};

  for (const [role, candidates] of Object.entries(NAME_CANDIDATES)) {
    const match = findByName(frame, candidates);
    if (match) {
      roles[role as keyof FieldRoles] = match;
    }
  }

  // Time is found by type rather than by name: Grafana already knows which
  // column is temporal, and dashboards name it anything from `time` to
  // `recorded_at` to `__timestamp`.
  const timeField = frame.fields.find((f) => f.type === FieldType.time);
  if (timeField) {
    roles.time = timeField.name;
  }

  return roles;
}

function findByName(frame: DataFrame, candidates: string[]): string | undefined {
  for (const candidate of candidates) {
    const field = frame.fields.find((f) => f.name.toLowerCase() === candidate);
    if (field) {
      return field.name;
    }
  }
  return undefined;
}
