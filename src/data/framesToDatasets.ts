import { DataFrame } from '@grafana/data';

import { buildFlows, FlowLayerConfig, FlowRenderMode } from './buildFlows';
import { buildTripLayer, TripLayerConfig, TripLayerMode } from './buildTripLayer';
import { buildTrips } from './buildTrips';
import { detectFields, FieldRoleOverrides, FieldRoles, resolveRoles } from './detectFields';
import { KeplerRow, toKeplerRows } from './toKeplerDataset';

/** One kepler dataset per Grafana query. */
export interface PanelDataset {
  id: string;
  label: string;
  rows: KeplerRow[];
  /**
   * A flow layer to add for this dataset, when the query is origin-destination.
   * kepler does not auto-detect flow layers, so the panel adds it explicitly.
   */
  flowLayer?: FlowLayerConfig;
  /**
   * A trip layer to add for this dataset, when the query is a trajectory.
   * kepler's own trip detection only fires on a column named `id`, so this is
   * added explicitly too.
   */
  tripLayer?: TripLayerConfig;
}

/**
 * Turns a panel's query results into one kepler dataset per query.
 *
 * The dataset id is derived from the query's refId so it is stable across
 * refreshes — that stability is what lets `updateVisData` replace the data
 * behind a dataset while keeping the layers the user configured on top of it.
 *
 * `overrides` carries the panel's saved field mapping, keyed by refId; anything
 * not overridden falls back to autodetection, and a role set to `null` is off.
 */
export function framesToDatasets(
  frames: DataFrame[],
  overrides: Record<string, FieldRoleOverrides> = {},
  opts: { flowRenderMode?: FlowRenderMode; tripLayerMode?: TripLayerMode } = {}
): PanelDataset[] {
  return frames.map((frame, index) => {
    const refId = frame.refId ?? `${index}`;
    const roles = resolveRoles(detectFields(frame), overrides[refId]);
    const id = datasetId(refId);
    const label = frame.name ?? `Query ${refId}`;

    // The compact shape for trajectories: one row per trip carrying the path.
    // kepler detects the `_geojson` column and builds the layer itself, so none
    // is supplied here — and nothing else survives the fold, which is the
    // trade the user is making by choosing this mode.
    if (opts.tripLayerMode === 'geojson' && isTripFrame(roles)) {
      return { id, label, rows: buildTrips(frame, roles) };
    }

    // Otherwise the query stays tabular — one row in, one row out. What varies
    // is the layers that ride along: kepler auto-detects points and geometry
    // but neither trips (its heuristic wants a column named `id`) nor flows, so
    // the panel supplies those two itself.
    return {
      id,
      label,
      rows: toKeplerRows(frame, roles),
      tripLayer: buildTripLayer(roles, id) ?? undefined,
      flowLayer: buildFlows(roles, id, { renderingMode: opts.flowRenderMode }) ?? undefined,
    };
  });
}

/**
 * A query describes trips when it has an id to group by, a time to order by and
 * point coordinates to trace — the three things `buildTrips` needs to fold many
 * GPS pings into one path.
 */
function isTripFrame(roles: FieldRoles): boolean {
  return Boolean(roles.tripId && roles.time && roles.latitude && roles.longitude);
}

export function datasetId(refId: string): string {
  return `grafana-${refId}`;
}
