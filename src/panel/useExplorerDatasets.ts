import { useEffect } from 'react';
import { AppEvents } from '@grafana/data';
import { getAppEvents } from '@grafana/runtime';
import type { Store } from 'redux';

import { queryChaski } from '../data/chaskiSource';
import { EXPLORER_ROW_CAP, explorerSql, rowsFromTable } from '../data/explorerQuery';
import { applyExplorerDataset } from './explorerDatasets';
import { type ExplorerToMap, subscribeExplorerToMap } from './explorerToMap';

/**
 * Serialises `showExplorerResult` per store, from the query through the
 * apply: each request's promise, so the next request on the same store starts
 * only once this one has settled. Queuing only the apply, as
 * `applyExplorerDataset` does on its own, is not enough: every query would
 * start at once, and a slow earlier one could land after, and overwrite, a
 * later replace. The chain never rejects, so a failed request never holds up
 * the next one.
 */
const requestChains = new WeakMap<Store, Promise<unknown>>();

/**
 * Runs an explorer request on Chaski's engine and puts the result on the map.
 * Requests on the same store run one at a time, in the order they were sent.
 * Returns the dataset id, or null when nothing was shown: no engine (silently,
 * since the explorer that sends these needs Chaski anyway), or any failure on the way (the query, turning its result into rows, or
 * kepler never taking the dataset within `applyExplorerDataset`'s timeout),
 * shown to the user as one error with the map left as it was. Never rejects.
 */
export function showExplorerResult(store: Store, request: ExplorerToMap, win: object = window): Promise<string | null> {
  const previous = requestChains.get(store) ?? Promise.resolve();
  const result = previous.then(() => showNow(store, request, win));
  requestChains.set(
    store,
    result.catch(() => undefined)
  );
  return result;
}

async function showNow(store: Store, request: ExplorerToMap, win: object): Promise<string | null> {
  try {
    const result = await queryChaski(explorerSql(request), win);
    if (!result.ok) {
      return null;
    }
    const { rows, truncated } = rowsFromTable(result.table, request.geometryColumn);
    if (truncated) {
      getAppEvents().publish({
        type: AppEvents.alertWarning.name,
        payload: [`Map: "${request.label}" shows its first ${EXPLORER_ROW_CAP.toLocaleString('en-US')} rows`],
      });
    }
    return await applyExplorerDataset(store, store.dispatch, { label: request.label, rows, mode: request.mode });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    getAppEvents().publish({
      type: AppEvents.alertError.name,
      payload: [`Map: could not show "${request.label}"`, message],
    });
    return null;
  }
}

/** Shows explorer results sent to this panel, or to every panel, once kepler is ready. */
export function useExplorerDatasets({
  store,
  isReady,
  panelId,
}: {
  store: Store;
  isReady: boolean;
  panelId?: number;
}): void {
  useEffect(() => {
    if (!isReady) {
      return;
    }
    return subscribeExplorerToMap((request) => {
      if (request.panelId !== undefined && request.panelId !== panelId) {
        return;
      }
      void showExplorerResult(store, request);
    });
  }, [store, isReady, panelId]);
}
