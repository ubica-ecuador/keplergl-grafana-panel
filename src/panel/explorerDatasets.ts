import { updateVisData, wrapTo } from '@kepler.gl/actions';
import type { Dispatch, Store } from 'redux';

import type { PanelDataset } from '../data/framesToDatasets';
import type { KeplerRow } from '../data/toKeplerDataset';
import { KEPLER_INSTANCE_ID } from './constants';
import { readDatasetIds, replaceDatasetData, toKeplerDatasets } from './keplerAdapter';

const PREFIX = 'explore-';

/**
 * The kepler id of an explorer result. It can never be a query dataset's
 * (`grafana-<refId>`), so a refresh of the panel's queries leaves it alone —
 * `refreshDatasets` only touches the ids it is handed.
 */
export function explorerDatasetId(label: string): string {
  const slug = label
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${PREFIX}${slug || 'result'}`;
}

/**
 * Puts an explorer result on the map for this session. `add` never touches a
 * dataset already there: a second result under the same label gets `-2`, `-3`…
 * `replace` swaps the rows of the label's dataset through kepler's own
 * replaceDataInMap, which keeps its layers, or creates it if the map has none.
 *
 * Nothing here reaches mapConfig: a saved config keeps only URL-backed
 * datasets, so an explorer result is gone after a rebuild or a reload.
 */
export function applyExplorerDataset(
  store: Store,
  dispatch: Dispatch,
  input: { label: string; rows: KeplerRow[]; mode: 'add' | 'replace' }
): string {
  const held = new Set(readDatasetIds(store));
  const base = explorerDatasetId(input.label);
  let id = base;
  let label = input.label;
  if (input.mode === 'add') {
    for (let n = 2; held.has(id); n++) {
      id = `${base}-${n}`;
      label = `${input.label} (${n})`;
    }
  }
  const dataset: PanelDataset = { id, label, rows: input.rows };
  if (held.has(id)) {
    replaceDatasetData(dispatch, dataset);
  } else {
    dispatch(
      wrapTo(
        KEPLER_INSTANCE_ID,
        updateVisData(toKeplerDatasets([dataset]), { keepExistingConfig: true, centerMap: false })
      ) as never
    );
  }
  return id;
}
