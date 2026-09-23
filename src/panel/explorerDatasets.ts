import { updateVisData, wrapTo } from '@kepler.gl/actions';
import type { Dispatch, Store } from 'redux';

import type { PanelDataset } from '../data/framesToDatasets';
import type { KeplerRow } from '../data/toKeplerDataset';
import { KEPLER_INSTANCE_ID } from './constants';
import { readDatasetIds, replaceDatasetData, toKeplerDatasets } from './keplerAdapter';

const PREFIX = 'explore-';

/**
 * How long `applyExplorerDataset` waits for kepler to actually register a
 * call's result before giving up. Overridable per call — see its last
 * parameter — for a test that wants a short wait on a dispatch kepler never
 * takes.
 */
export const EXPLORER_APPLY_TIMEOUT_MS = 10_000;

/**
 * Serialises `applyExplorerDataset` calls per store: each call's promise, so
 * the next call on the same store starts only once this one has settled —
 * resolved or rejected.
 *
 * Both `updateVisData` and `replaceDataInMap` are asynchronous in kepler:
 * `updateVisData` only lands an id in `visState.datasets` once its
 * `Task.allSettled` create task resolves, and `replaceDataInMap` swaps a
 * dataset's object identity through that same task pipeline
 * (`updateVisDataUpdater`/`createNewDatasetSuccessUpdater` in
 * `@kepler.gl/reducers`). Reading `readDatasetIds` right after dispatch, the
 * way this module used to, races that: two calls in the same tick both see
 * the state from before either dispatch and can collide on the same id, or a
 * `replace` can land on an id kepler does not hold yet — `replaceDataInMap`
 * is a synchronous no-op in that case, silently dropping the call. Chaining
 * every call behind the last one's settlement closes both gaps without
 * tracking ids by hand: by the time a call reads `readDatasetIds`, every
 * earlier call on this store has already been dispatched **and** confirmed
 * (or given up after `timeoutMs`).
 */
const callChains = new WeakMap<Store, Promise<void>>();

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

/** The datasets kepler currently holds on its own instance, by id. */
function heldDatasets(store: Store): Record<string, { label?: unknown } | undefined> {
  const state = store.getState() as {
    keplerGl?: Record<
      string,
      { visState?: { datasets?: Record<string, { label?: unknown } | undefined> } } | undefined
    >;
  };
  return state.keplerGl?.[KEPLER_INSTANCE_ID]?.visState?.datasets ?? {};
}

/** The dataset object kepler currently holds for `id` on its own instance, or undefined. */
function datasetRef(store: Store, id: string): unknown {
  return heldDatasets(store)[id];
}

/** The explorer datasets kepler holds, as id → the label kepler shows for it. */
function explorerLabels(store: Store): Map<string, string> {
  const labels = new Map<string, string>();
  for (const [id, dataset] of Object.entries(heldDatasets(store))) {
    if (id.startsWith(PREFIX) && typeof dataset?.label === 'string') {
      labels.set(id, dataset.label);
    }
  }
  return labels;
}

/**
 * Resolves once `holds()` is true — checked immediately, then on every store
 * change — or rejects with `onTimeout()` once `timeoutMs` passes first.
 * Always unsubscribes before settling either way.
 */
function waitUntil(store: Store, holds: () => boolean, timeoutMs: number, onTimeout: () => Error): Promise<void> {
  if (holds()) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const stop = () => {
      unsubscribe();
      clearTimeout(timer);
    };
    const unsubscribe = store.subscribe(() => {
      if (holds()) {
        stop();
        resolve();
      }
    });
    const timer = setTimeout(() => {
      stop();
      reject(onTimeout());
    }, timeoutMs);
  });
}

/**
 * Puts an explorer result on the map for this session. `add` never touches a
 * dataset already there: a second result under the same label gets `-2`,
 * `-3`… `replace` swaps the rows of the explorer dataset whose kepler label
 * is exactly `label` through kepler's own replaceDataInMap, which keeps its
 * layers, or creates it if the map has none. A new dataset whose slug id
 * another label already holds gets `-2`, `-3`… too, so labels that slug
 * alike ("Hot spots" and "hot-spots", or "東京" and "大阪") never overwrite
 * each other.
 *
 * Nothing here reaches mapConfig: a saved config keeps only URL-backed
 * datasets, so an explorer result is gone after a rebuild or a reload.
 *
 * Calls on the same store are serialised (see `callChains`), so the ids a
 * call reads are never racing a create or replace still in flight from an
 * earlier one. The returned promise itself settles only once kepler has
 * taken the dispatch: it resolves with the id once kepler actually holds the
 * result, or rejects after `timeoutMs` if it never does — a create kepler
 * refused, most likely. Either way the next queued call still runs.
 */
export function applyExplorerDataset(
  store: Store,
  dispatch: Dispatch,
  input: { label: string; rows: KeplerRow[]; mode: 'add' | 'replace' },
  timeoutMs: number = EXPLORER_APPLY_TIMEOUT_MS
): Promise<string> {
  const previous = callChains.get(store) ?? Promise.resolve();
  const result = previous.then(() => runApply(store, dispatch, input, timeoutMs));
  // The next call must wait for this one regardless of outcome, but the
  // chain itself must never reject — that would jump the rejection to
  // whichever call reads it next instead of to this call's own caller.
  callChains.set(
    store,
    result.then(
      () => undefined,
      () => undefined
    )
  );
  return result;
}

async function runApply(
  store: Store,
  dispatch: Dispatch,
  input: { label: string; rows: KeplerRow[]; mode: 'add' | 'replace' },
  timeoutMs: number
): Promise<string> {
  const heldIds = new Set(readDatasetIds(store));
  const labels = explorerLabels(store);
  const target = input.mode === 'replace' ? [...labels].find(([, held]) => held === input.label)?.[0] : undefined;
  const base = explorerDatasetId(input.label);
  let id = target ?? base;
  let label = input.label;
  if (target === undefined) {
    // A replace only gets here when no explorer dataset has its label, so
    // only the id can clash; an add also keeps its label from doubling one.
    const heldLabels = new Set(labels.values());
    for (let n = 2; heldIds.has(id) || heldLabels.has(label); n++) {
      id = `${base}-${n}`;
      if (input.mode === 'add') {
        label = `${input.label} (${n})`;
      }
    }
  }
  const dataset: PanelDataset = { id, label, rows: input.rows };
  const timedOut = () => new Error(`kepler never registered the explorer dataset "${input.label}" (id "${id}")`);

  if (target !== undefined) {
    const before = datasetRef(store, id);
    replaceDatasetData(dispatch, dataset);
    // `replaceDataInMap` removes the old entry synchronously and re-adds it
    // only once its own recreate task settles (`prepareStateForDatasetReplace`
    // followed by the same async `updateVisData` path), so the id is briefly
    // absent from `visState.datasets` in between. Waiting only for "changed
    // from `before`" would catch that transient `undefined` and return before
    // the new dataset actually landed — hence requiring it defined too.
    await waitUntil(
      store,
      () => {
        const current = datasetRef(store, id);
        return current !== undefined && current !== before;
      },
      timeoutMs,
      timedOut
    );
  } else {
    dispatch(
      wrapTo(
        KEPLER_INSTANCE_ID,
        updateVisData(toKeplerDatasets([dataset]), { keepExistingConfig: true, centerMap: false })
      ) as never
    );
    await waitUntil(store, () => readDatasetIds(store).includes(id), timeoutMs, timedOut);
  }

  return id;
}
