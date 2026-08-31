import { DataFrame } from '@grafana/data';

import { FieldRoles } from './detectFields';
import { wkbToGeoJson } from './wkbToGeoJson';

/** A row handed to kepler, keyed by kepler's own column names. */
export type KeplerRow = Record<string, unknown>;

/**
 * Roles whose column kepler reads by name.
 *
 * The wind roles are absent on purpose: a velocity field never reaches kepler as
 * columns. It is consumed to trace streamlines, and what kepler receives is
 * their geometry, so renaming `u`/`v` would be renaming something nobody looks at.
 *
 * `rasterUrl` is absent for the same reason: it becomes a dataset of its own,
 * whose substance is a metadata url rather than any row. So are `wmsUrl` and
 * `wmsLayer`, which name a service rather than describe a row, and the three
 * `zarr*` roles, which name a store, one array inside it, and the label that
 * array answers to — a tile request, not a column anyone reads. The `esri*`
 * roles are absent for the same reason again: they name a service and the rules
 * it should draw by.
 */
type RenamedRole = Exclude<
  keyof FieldRoles,
  | 'u'
  | 'v'
  | 'speed'
  | 'direction'
  | 'rasterUrl'
  | 'wmsUrl'
  | 'wmsLayer'
  | 'zarrUrl'
  | 'zarrVariable'
  | 'zarrTimeLabel'
  | 'zarrLevels'
  | 'zarrSel'
  | 'zarrTimeDim'
  | 'zarrColormap'
  | 'zarrRescale'
  | 'esriUrl'
  | 'esriMosaicRule'
  | 'esriRenderingRule'
>;

/**
 * Column name kepler expects for each role.
 *
 * kepler creates its default layers by looking at column names, so a role is
 * expressed by renaming the user's column rather than by configuring the layer.
 * `_geojson` is kepler's convention for a geometry column; `lat0`/`lng0`/
 * `lat1`/`lng1`/`count` are what the flow layer requires.
 */
export const KEPLER_COLUMN: Record<RenamedRole, string> = {
  latitude: 'latitude',
  longitude: 'longitude',
  time: 'time',
  tripId: 'trip_id',
  altitude: 'altitude',
  geometry: '_geojson',
  h3: 'h3',
  originLat: 'lat0',
  originLng: 'lng0',
  destLat: 'lat1',
  destLng: 'lng1',
  originH3: 'source_h3',
  destH3: 'target_h3',
  count: 'count',
};

/**
 * Converts a Grafana DataFrame into plain row objects for kepler.
 *
 * Kept free of any kepler import so it stays a pure function: the adapter turns
 * these rows into a kepler dataset. Columns carrying a role are renamed to
 * kepler's expected names; every other column is passed through untouched so it
 * remains available in tooltips and filters.
 *
 * `indices` narrows the frame to a subset of its rows. Only a velocity grid uses
 * it, to keep the one timestep it draws: the rest of a forecast would overwrite
 * each cell with a later hour, and a query returning every hour is the ordinary
 * case rather than the odd one.
 */
export function toKeplerRows(frame: DataFrame, roles: FieldRoles, indices?: number[]): KeplerRow[] {
  const renames = new Map<string, string>();
  for (const [role, sourceName] of Object.entries(roles)) {
    const target = KEPLER_COLUMN[role as RenamedRole];
    // A role with no kepler column — the wind ones — leaves its column alone.
    if (sourceName && target) {
      renames.set(sourceName, target);
    }
  }

  const geometrySource = roles.geometry;
  const rows: KeplerRow[] = [];

  const wanted = indices ?? Array.from({ length: frame.length }, (_, i) => i);

  for (const i of wanted) {
    const row: KeplerRow = {};
    for (const field of frame.fields) {
      const name = renames.get(field.name) ?? field.name;
      const value = field.values[i];
      // A geometry column may hold WKB hex (raw PostGIS/DuckDB), GeoJSON or WKT.
      // Decode WKB to GeoJSON so it renders; leave GeoJSON/WKT untouched — kepler
      // parses those directly, and wkbToGeoJson returns null for them.
      row[name] = field.name === geometrySource && typeof value === 'string' ? (wkbToGeoJson(value) ?? value) : value;
    }
    rows.push(row);
  }

  return rows;
}
