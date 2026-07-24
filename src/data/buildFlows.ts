import { FieldRoles } from './detectFields';
import { KEPLER_COLUMN } from './toKeplerDataset';

/** How kepler draws the flow lines. */
export type FlowRenderMode = 'straight' | 'curved' | 'animated-straight';

/**
 * A kepler.gl flow layer, in the saved-config-v1 shape kepler parses.
 *
 * The `visualChannels` property is what marks it as a saved config kepler needs
 * to parse (`isSavedLayerConfigV1`), rather than an already-parsed internal
 * layer — without it kepler would try to use it verbatim and reject it.
 */
export interface FlowLayerConfig {
  id: string;
  type: 'flow';
  config: {
    dataId: string;
    label: string;
    columns: Record<string, string>;
    columnMode: 'LAT_LNG' | 'H3';
    isVisible: boolean;
    visConfig: { flowLinesRenderingMode: FlowRenderMode };
  };
  visualChannels: Record<string, unknown>;
}

/**
 * Builds a flow layer for an origin-destination dataset, or null if the roles
 * do not describe one.
 *
 * kepler does not auto-detect flow layers from column names the way it does
 * points, geometry and trips, so this emits the layer config explicitly. The
 * column values are the kepler names `toKeplerRows` already renamed the roles to
 * (`lat0`/`lng0`/`lat1`/`lng1`, `source_h3`/`target_h3`, `count`); the keys are
 * the flow layer's own column keys. H3 wins over lat/lng when both are present,
 * since a hexagon flow is the more specific description.
 */
export function buildFlows(
  roles: FieldRoles,
  dataId: string,
  opts: { renderingMode?: FlowRenderMode } = {}
): FlowLayerConfig | null {
  const hasH3 = Boolean(roles.originH3 && roles.destH3);
  const hasLatLng = Boolean(roles.originLat && roles.originLng && roles.destLat && roles.destLng);

  let columnMode: 'LAT_LNG' | 'H3';
  let columns: Record<string, string>;

  if (hasH3) {
    columnMode = 'H3';
    columns = { sourceH3: KEPLER_COLUMN.originH3, targetH3: KEPLER_COLUMN.destH3 };
  } else if (hasLatLng) {
    columnMode = 'LAT_LNG';
    columns = {
      lat0: KEPLER_COLUMN.originLat,
      lng0: KEPLER_COLUMN.originLng,
      lat1: KEPLER_COLUMN.destLat,
      lng1: KEPLER_COLUMN.destLng,
    };
  } else {
    return null;
  }

  if (roles.count) {
    columns.count = KEPLER_COLUMN.count;
  }

  return {
    id: `flow-${dataId}`,
    type: 'flow',
    config: {
      dataId,
      label: 'Flows',
      columns,
      columnMode,
      isVisible: true,
      visConfig: { flowLinesRenderingMode: opts.renderingMode ?? 'straight' },
    },
    visualChannels: {},
  };
}
