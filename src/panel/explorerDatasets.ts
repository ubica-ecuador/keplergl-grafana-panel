import { updateVisData, wrapTo } from '@kepler.gl/actions';
import type { Dispatch, Store } from 'redux';

import type { PanelDataset } from '../data/framesToDatasets';
import type { KeplerRow } from '../data/toKeplerDataset';
import { KEPLER_INSTANCE_ID } from './constants';
import { readDatasetIds, replaceDatasetData, toKeplerDatasets } from './keplerAdapter';

const PREFIX = 'explore-';

/**
 * Ids this module has dispatched an `updateVisData` create for, per store,
 * that kepler may not have registered yet.
 *
 * `updateVisData` only lands in `visState.datasets` once kepler's task
 * middleware settles it (see `settle()` in the tests) — dispatch and
 * registration are not the same tick. Two calls for the same label in one
 * tick would otherwise both read an empty `readDatasetIds(store)` and both
 * compute the same id, racing two creates for it. This set closes that gap:
 * an id lands here the moment a create for it is dispatched, and is pruned
 * once kepler actually holds it, so it never grows without bound.
 */
const pendingIds = new WeakMap<Store, Set<string>>();

function pendingIdsFor(store: Store): Set<string> {
  let ids = pendingIds.get(store);
  if (!ids) {
    ids = new Set();
    pendingIds.set(store, ids);
  }
  return ids;
}

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
 *
 * An id counts as held — for `add`'s `-2`, `-3`… suffixing, and for
 * `replace`'s choice of path — the moment this function has dispatched a
 * create for it, not only once kepler has registered it; see `pendingIds`.
 * A `replace` that lands on a still-pending id goes through
 * `replaceDatasetData` regardless: `replaceDataInMap` is a synchronous no-op
 * when kepler does not yet hold the id, which only loses a same-tick second
 * `replace` of the same label — far cheaper than the alternative, a second
 * `updateVisData` racing the first create and leaving two datasets, and two
 * default layers, in flight for one id.
 */
export function applyExplorerDataset(
  store: Store,
  dispatch: Dispatch,
  input: { label: string; rows: KeplerRow[]; mode: 'add' | 'replace' }
): string {
  const known = new Set(readDatasetIds(store));
  const pending = pendingIdsFor(store);
  for (const id of pending) {
    if (known.has(id)) {
      pending.delete(id);
    }
  }
  const isHeld = (candidate: string) => known.has(candidate) || pending.has(candidate);

  const base = explorerDatasetId(input.label);
  let id = base;
  let label = input.label;
  if (input.mode === 'add') {
    for (let n = 2; isHeld(id); n++) {
      id = `${base}-${n}`;
      label = `${input.label} (${n})`;
    }
  }
  const dataset: PanelDataset = { id, label, rows: input.rows };
  if (isHeld(id)) {
    replaceDatasetData(dispatch, dataset);
  } else {
    dispatch(
      wrapTo(
        KEPLER_INSTANCE_ID,
        updateVisData(toKeplerDatasets([dataset]), { keepExistingConfig: true, centerMap: false })
      ) as never
    );
    pending.add(id);
  }
  return id;
}
