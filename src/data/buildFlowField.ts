import { FieldRoles } from './detectFields';
import { KEPLER_COLUMN } from './toKeplerDataset';

/**
 * How the query spells the velocity.
 *
 * kepler calls this a column mode, and renders a different set of column
 * pickers for each — which is what puts the choice of columns in the layer
 * panel instead of in the panel options.
 */
export type FlowFieldColumnMode = 'components' | 'polar';

/**
 * A flow field layer, in the saved-config-v1 shape kepler parses.
 *
 * Built explicitly rather than left to kepler's own detection, for the reason
 * `buildFlows` gives: `findDefaultLayerProps` runs inside `addDataToMap`, and a
 * layer created there arrives beside the Point layer kepler guesses from the
 * same coordinates, with nothing to say which of the two the user meant.
 * Adding it ourselves is also what lets the superseded Point layer be removed
 * in the same breath — see `supersededLayerIds`.
 */
export interface FlowFieldLayerConfig {
  id: string;
  type: 'flowfield';
  config: {
    dataId: string;
    label: string;
    columns: Record<string, string>;
    columnMode: FlowFieldColumnMode;
    isVisible: boolean;
    visConfig: Record<string, unknown>;
  };
  visualChannels: Record<string, unknown>;
}

/**
 * Builds a flow field layer for a velocity grid, or null if the roles do not
 * describe one.
 *
 * Components win over speed/direction when both are present: they need no
 * convention to interpret, which is the same order `buildWindField` applies
 * when it reads the columns.
 *
 * The column *values* are what the rows are called once `toKeplerRows` has run:
 * the coordinates and the altitude are renamed to kepler's names, and the four
 * velocity columns keep whatever the query called them — nothing renames them,
 * because until now nothing read them as columns at all.
 */
export function buildFlowField(roles: FieldRoles, dataId: string): FlowFieldLayerConfig | null {
  if (!roles.latitude || !roles.longitude) {
    return null;
  }

  const columns: Record<string, string> = {
    lat: KEPLER_COLUMN.latitude,
    lng: KEPLER_COLUMN.longitude,
  };

  let columnMode: FlowFieldColumnMode;
  if (roles.u && roles.v) {
    columnMode = 'components';
    columns.u = roles.u;
    columns.v = roles.v;
  } else if (roles.speed && roles.direction) {
    columnMode = 'polar';
    columns.speed = roles.speed;
    columns.direction = roles.direction;
  } else {
    return null;
  }

  // Height is opt-in through the field mapping, and stays that way: an
  // `elevation` column mapped by accident lifts a level kilometres into the air.
  if (roles.altitude) {
    columns.altitude = KEPLER_COLUMN.altitude;
  }

  return {
    id: `flowfield-${dataId}`,
    type: 'flowfield',
    config: {
      dataId,
      label: 'Flow field',
      columns,
      columnMode,
      isVisible: true,
      visConfig: {},
    },
    visualChannels: {},
  };
}
