import { DataFrame } from '@grafana/data';

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
export function framesToDatasets(
  frames: DataFrame[],
  overrides: Record<string, FieldRoles> = {}
): PanelDataset[] {
  return frames.map((frame, index) => {
    const refId = frame.refId ?? `${index}`;
    const roles = { ...detectFields(frame), ...(overrides[refId] ?? {}) };

    return {
      id: datasetId(refId),
      label: frame.name ?? `Query ${refId}`,
      rows: toKeplerRows(frame, roles),
    };
  });
}

export function datasetId(refId: string): string {
  return `grafana-${refId}`;
}
