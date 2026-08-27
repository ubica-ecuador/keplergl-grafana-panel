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
  /**
   * A velocity field, given either as components or as speed plus
   * meteorological direction. Both pairs are all-or-nothing: half of one
   * describes nothing.
   */
  u?: string;
  v?: string;
  speed?: string;
  direction?: string;
  /**
   * A link to a cloud-optimised GeoTIFF, which is drawn as raster tiles rather
   * than as rows. One url per query — the first row wins.
   */
  rasterUrl?: string;
  /**
   * A WMS service and the one layer of it to draw.
   *
   * Both are needed: a service publishes many layers and nothing in the query
   * says which one is meant, so a url on its own is not a picture. The service
   * renders the imagery itself, which is why no tile server appears here.
   */
  wmsUrl?: string;
  wmsLayer?: string;
  /**
   * A Zarr store, the one array of it to draw, and — when that array has a time
   * axis — the exact index label of each moment.
   *
   * The label is a separate role rather than a rendering of {@link time}
   * because TiTiler hands it to xarray's `.sel`, which matches exactly and
   * offers no nearest-neighbour fallback: a store stamped at 09:00 rejects the
   * date-only spelling of its own timestamps.
   */
  zarrUrl?: string;
  zarrVariable?: string;
  zarrTimeLabel?: string;
  /**
   * How many levels the store's `multiscales` pyramid has, and which slice to
   * pin on every non-spatial axis other than time.
   *
   * Both come from the query rather than from the store because reading them
   * means fetching the store's metadata, and that is a request the panel would
   * make on every render to learn something a dashboard author already knows.
   */
  zarrLevels?: string;
  zarrSel?: string;
  /**
   * Which axis of the store the map's clock walks. Defaults to `time`.
   *
   * Named because a climate store often holds its temporal axis as something
   * else entirely — twelve months as `month=1..12`, integers rather than dates.
   * The clock still walks it; the query says which axis and what each moment is
   * called there.
   */
  zarrTimeDim?: string;
}

/**
 * A user's answer for a role: a column name, or `null` for "use no column".
 *
 * Three states matter, and only two of them fit in `FieldRoles`: a role can be
 * autodetected (key absent), pointed at a column, or deliberately switched off.
 * Without the third, a query carrying a trip id could never be drawn as points —
 * clearing the field just handed the role back to autodetection.
 */
export type FieldRoleOverrides = Partial<Record<keyof FieldRoles, string | null>>;

/**
 * Applies a user's overrides to the autodetected roles.
 *
 * Roles switched off are removed outright, so everything downstream keeps
 * working with plain `string | undefined` and no notion of a disabled role.
 */
export function resolveRoles(detected: FieldRoles, overrides: FieldRoleOverrides | undefined): FieldRoles {
  const roles: FieldRoles = { ...detected };

  for (const [role, column] of Object.entries(overrides ?? {})) {
    const key = role as keyof FieldRoles;
    if (column === null) {
      delete roles[key];
    } else if (column) {
      roles[key] = column;
    }
  }

  return roles;
}

/**
 * Candidate column names per role, matched case-insensitively and exactly.
 *
 * Exact matching is deliberate: substring matching would make `origin_lat`
 * satisfy `lat` and silently turn an origin/destination table into a plain
 * point layer.
 *
 * `altitude` has no candidates on purpose. GPS traces routinely carry an
 * `elevation` column holding metres above sea level, and deck.gl reads the third
 * coordinate as height above the ground: a trail through Cuenca at 2,650 m is
 * drawn 2.65 km up, so it disappears the moment the camera descends below it —
 * roughly zoom 15. The layer looks fine zoomed out and vanishes zoomed in, which
 * reads as a rendering bug rather than as a mapping choice. Height on a trip
 * path is therefore opt-in through the field mapping editor.
 */
const NAME_CANDIDATES: Record<string, string[]> = {
  latitude: ['latitude', 'lat', 'y'],
  longitude: ['longitude', 'lon', 'lng', 'long', 'x'],
  tripId: ['trip_id', 'tripid', 'track_id', 'trackid', 'trajectory_id', 'vehicle_id', 'journey_id'],
  // `altitude` is deliberately absent: see the note below.
  geometry: ['geom', 'geometry', 'the_geom', 'wkb_geometry', 'geojson', 'wkt', 'shape'],
  h3: ['h3', 'h3_index', 'hex_id', 'hexagon', 'h3index'],
  // Wind. `ugrd`/`vgrd` are the GRIB2 short names GFS ships, so a table loaded
  // straight from a GRIB conversion is recognised without renaming anything.
  u: ['u', 'u10', 'u_wind', 'wind_u', 'ugrd', 'u_component'],
  v: ['v', 'v10', 'v_wind', 'wind_v', 'vgrd', 'v_component'],
  speed: ['wind_speed', 'windspeed', 'wind_speed_10m', 'speed', 'ws'],
  direction: ['wind_direction', 'winddirection', 'wind_direction_10m', 'direction', 'wind_dir', 'wd'],
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
  // Raster. `asset_href` and `href` are what a STAC asset is called in the
  // catalogue's own JSON, so a query that lifts the asset straight out of a
  // search response needs no aliasing.
  rasterUrl: ['raster_url', 'cog_url', 'cog', 'asset_href', 'href'],
  // WMS. `wms` alone is worth accepting because a query that fixes the service
  // by hand reads better as `SELECT '…' AS wms`, and `service_url` is what the
  // OGC calls the endpoint.
  wmsUrl: ['wms_url', 'wms', 'service_url'],
  wmsLayer: ['wms_layer', 'layer', 'layer_name'],
  // Zarr. Deliberately narrow: `variable` on its own is an ordinary column name
  // in any long-format table, and claiming it would read a frame of unrelated
  // measurements as a Zarr store.
  zarrUrl: ['zarr_url', 'zarr', 'store_url'],
  zarrVariable: ['zarr_variable', 'zarr_var'],
  zarrTimeLabel: ['zarr_time_label', 'zarr_label'],
  zarrLevels: ['zarr_levels', 'zarr_pyramid'],
  zarrSel: ['zarr_sel', 'zarr_select'],
  zarrTimeDim: ['zarr_time_dim', 'zarr_dim'],
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
