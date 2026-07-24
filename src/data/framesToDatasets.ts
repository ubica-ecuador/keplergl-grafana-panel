import { DataFrame } from '@grafana/data';

import { buildFlows, FlowLayerConfig, FlowRenderMode } from './buildFlows';
import { buildTrips } from './buildTrips';
import { detectFields, FieldRoles } from './detectFields';
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
}

/**
 * Turns a panel's query results into one kepler dataset per query.
 *
 * The dataset id is derived from the query's refId so it is stable across
 * refreshes — that stability is what lets `updateVisData` replace the data
 * behind a dataset while keeping the layers the user configured on top of it.
 *
 * `overrides` carries the panel's saved field mapping, keyed by refId; anything
 * not overridden falls back to autodetection.
 */
export function framesToDatasets(
  frames: DataFrame[],
  overrides: Record<string, FieldRoles> = {},
  opts: { flowRenderMode?: FlowRenderMode } = {}
): PanelDataset[] {
  return frames.map((frame, index) => {
    const refId = frame.refId ?? `${index}`;
    const roles = { ...detectFields(frame), ...(overrides[refId] ?? {}) };
    const id = datasetId(refId);

    // Trips replace the rows entirely; everything else stays tabular and may
    // additionally carry a flow layer when the columns describe OD movement.
    if (isTripFrame(roles)) {
      return { id, label: frame.name ?? `Query ${refId}`, rows: buildTrips(frame, roles) };
    }

    return {
      id,
      label: frame.name ?? `Query ${refId}`,
      rows: toKeplerRows(frame, roles),
      flowLayer: buildFlows(roles, id, { renderingMode: opts.flowRenderMode }) ?? undefined,
    };
  });
}

/**
 * A query describes trips when it has an id to group by, a time to order by, and
 * point coordinates to trace. Those three together are what `buildTrips` needs
 * to fold many GPS pings into one animated path; without any of them the query
 * is treated as a plain point/geometry layer.
 */
function isTripFrame(roles: FieldRoles): boolean {
  return Boolean(roles.tripId && roles.time && roles.latitude && roles.longitude);
}

export function datasetId(refId: string): string {
  return `grafana-${refId}`;
}
