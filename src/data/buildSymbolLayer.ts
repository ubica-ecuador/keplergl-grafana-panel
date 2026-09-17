import { FieldRoles } from './detectFields';
import { KEPLER_COLUMN } from './toKeplerDataset';

/**
 * A symbol layer, in the saved-config-v1 shape kepler parses.
 *
 * Built explicitly rather than left to kepler's detection, for the reason
 * `buildFlows` gives: `findDefaultLayerProps` runs inside `addDataToMap`, and a
 * layer created there arrives beside the Point layer kepler guesses from the
 * same coordinates with nothing to say which the user meant.
 */
export interface SymbolLayerConfig {
  id: string;
  type: 'symbol';
  config: {
    dataId: string;
    label: string;
    columns: Record<string, string>;
    isVisible: boolean;
    visConfig: Record<string, unknown>;
  };
  visualChannels: Record<string, unknown>;
}

/** A saved visual channel: kepler's merger matches it to a column by name. */
function channel(column: string | undefined): { name: string } | null {
  return column ? { name: column } : null;
}

/**
 * Builds a symbol layer for a table of points, or null when it has no
 * coordinates to put them on.
 *
 * The convention is decided here, and it matters: a meteorological direction
 * says where the wind comes *from*, a vehicle's heading where it *goes*. The
 * two are half a turn apart and both look right on a map, so the reading is
 * taken from which roles matched rather than left to the reader.
 *
 * A direction alone does not make a wind. The `direction` role also claims a
 * bare `direction` or `wd`, which a vehicle table uses for where it is going;
 * read as meteorological, every arrow would point backwards. So `from` needs a
 * wind speed beside the direction — the pair that makes the reading a wind.
 */
export function buildSymbolLayer(roles: FieldRoles, dataId: string): SymbolLayerConfig | null {
  if (!roles.latitude || !roles.longitude) {
    return null;
  }

  const columns: Record<string, string> = {
    lat: KEPLER_COLUMN.latitude,
    lng: KEPLER_COLUMN.longitude,
  };
  if (roles.altitude) {
    columns.altitude = KEPLER_COLUMN.altitude;
  }

  const meteorological = !roles.rotation && Boolean(roles.direction) && Boolean(roles.speed);
  const bearing = roles.rotation ?? roles.direction;
  const magnitude = roles.magnitude ?? roles.speed;

  return {
    id: `symbol-${dataId}`,
    type: 'symbol',
    config: {
      dataId,
      label: 'Symbols',
      columns,
      isVisible: true,
      visConfig: {
        directionConvention: meteorological ? 'from' : 'towards',
        // Degrees pass through untouched; see `symbolLayer.ts`.
        fixedAngle: true,
      },
    },
    visualChannels: {
      angleField: channel(bearing),
      angleScale: 'linear',
      sizeField: channel(magnitude),
      sizeScale: 'sqrt',
    },
  };
}
