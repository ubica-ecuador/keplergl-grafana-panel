import { useEffect } from 'react';
import { AppEvents } from '@grafana/data';
import { getAppEvents } from '@grafana/runtime';
import type { Store } from 'redux';

import { queryChaski } from '../data/chaskiSource';
import { EXPLORER_ROW_CAP, explorerSql, rowsFromTable } from '../data/explorerQuery';
import { applyExplorerDataset } from './explorerDatasets';
import { type ExplorerToMap, subscribeExplorerToMap } from './explorerToMap';

/** The reasons there was no engine that have been logged already: each is logged once. */
const loggedNoEngine = new Set<string>();

/**
 * Runs an explorer request on Chaski's engine and puts the result on the map.
 * Returns the dataset id, or null when nothing was shown: no engine (logged
 * once per reason, since the explorer that sends these needs Chaski anyway),
 * or any failure on the way (the query, turning its result into rows, or
 * kepler never taking the dataset within `applyExplorerDataset`'s timeout),
 * shown to the user as one error with the map left as it was. Never rejects.
 */
export async function showExplorerResult(
  store: Store,
  request: ExplorerToMap,
  win: object = window
): Promise<string | null> {
  try {
    const result = await queryChaski(explorerSql(request), win);
    if (!result.ok) {
      if (!loggedNoEngine.has(result.reason)) {
        loggedNoEngine.add(result.reason);
        console.info(`kepler panel: explorer result ignored, Chaski engine ${result.reason}`);
      }
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
