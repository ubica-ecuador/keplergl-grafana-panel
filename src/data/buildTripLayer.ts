import { FieldRoles } from './detectFields';
import { KEPLER_COLUMN } from './toKeplerDataset';

/**
 * Which of kepler's two Trip layer shapes a trajectory query is loaded as.
 *
 * `table` keeps one row per GPS ping, so every column of the query stays
 * available for colour, filters and tooltips. `geojson` folds each trip into a
 * single row carrying only the path — far less data when all that is wanted is
 * the animated line, and the shape older saved map configurations point at.
 */
export type TripLayerMode = 'table' | 'geojson';

/**
 * A kepler.gl Trip layer in its table column mode, in the saved-config-v1 shape
 * kepler parses.
 *
 * `visualChannels` is what marks this as a saved config for kepler to parse
 * (`isSavedLayerConfigV1`) rather than an already-built layer to use verbatim.
 */
export interface TripLayerConfig {
  id: string;
  type: 'trip';
  config: {
    dataId: string;
    label: string;
    columnMode: 'table';
    columns: { id: string; lat: string; lng: string; timestamp: string; altitude?: string };
    isVisible: boolean;
  };
  visualChannels: Record<string, unknown>;
}

/**
 * Builds a Trip layer for a trajectory dataset, or null if the roles do not
 * describe one.
 *
 * kepler's Trip layer reads two shapes. Its `geojson` mode wants one row per
 * trip carrying a LineString whose coordinates hold the timestamps; the panel
 * used to build exactly that, which meant folding every GPS ping of a trip into
 * a single row and discarding every other column — no speed, no mode of
 * transport, nothing to colour, filter or show in a tooltip.
 *
 * Its `table` mode instead takes the rows as they come and groups them by id
 * itself, so the dataset stays one row per ping with all its columns intact.
 * That is what this builds. kepler does not auto-detect it — its own heuristic
 * insists on a column literally named `id` — so the panel adds the layer
 * explicitly, the same way it does for flows.
 *
 * The column values are the kepler names `toKeplerRows` renamed the roles to,
 * not the user's original column names.
 */
export function buildTripLayer(roles: FieldRoles, dataId: string): TripLayerConfig | null {
  if (!roles.tripId || !roles.time || !roles.latitude || !roles.longitude) {
    return null;
  }

  return {
    id: `trip-${dataId}`,
    type: 'trip',
    config: {
      dataId,
      label: 'Trips',
      columnMode: 'table',
      columns: {
        id: KEPLER_COLUMN.tripId,
        lat: KEPLER_COLUMN.latitude,
        lng: KEPLER_COLUMN.longitude,
        timestamp: KEPLER_COLUMN.time,
        // Height is optional and opt-in: an elevation above sea level lifts the
        // trail out of the camera's view, so it is only ever mapped on purpose.
        ...(roles.altitude ? { altitude: KEPLER_COLUMN.altitude } : {}),
      },
      isVisible: true,
    },
    visualChannels: {},
  };
}
