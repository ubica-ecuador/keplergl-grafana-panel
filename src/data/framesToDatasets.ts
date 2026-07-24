import { DataFrame } from '@grafana/data';

import { buildTrips } from './buildTrips';
import { detectFields, FieldRoles } from './detectFields';
import { KeplerRow, toKeplerRows } from './toKeplerDataset';

/** One kepler dataset per Grafana query. */
export interface PanelDataset {
  id: string;
  label: string;
  rows: KeplerRow[];
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
export function framesToDatasets(frames: DataFrame[], overrides: Record<string, FieldRoles> = {}): PanelDataset[] {
  return frames.map((frame, index) => {
    const refId = frame.refId ?? `${index}`;
    const roles = { ...detectFields(frame), ...(overrides[refId] ?? {}) };

    return {
      id: datasetId(refId),
      label: frame.name ?? `Query ${refId}`,
      rows: isTripFrame(roles) ? buildTrips(frame, roles) : toKeplerRows(frame, roles),
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
