import { addDataToMap, updateVisData, wrapTo } from '@kepler.gl/actions';
import { processRowObject } from '@kepler.gl/processors';
import type { Dispatch } from 'redux';

import { KEPLER_INSTANCE_ID } from './keplerStore';

/**
 * The ONLY module that talks to the kepler.gl API.
 *
 * kepler.gl is pinned to a pre-release (3.3.0-alpha.3) because the Flow layer
 * exists nowhere else. Funnelling every kepler call through here means the
 * alpha -> stable upgrade touches one file instead of the whole tree.
 */

export type KeplerDataset = {
  info: { id: string; label: string };
  data: NonNullable<ReturnType<typeof processRowObject>>;
};

/** Builds a kepler dataset from plain row objects. Returns null for empty input. */
export function rowsToDataset(id: string, label: string, rows: Array<Record<string, unknown>>): KeplerDataset | null {
  const data = processRowObject(rows);
  if (!data) {
    return null;
  }
  return { info: { id, label }, data };
}

/**
 * First load: hands datasets and an optional saved config to kepler, letting it
 * create the default layers and frame the viewport around the data.
 */
export function loadDatasets(
  dispatch: Dispatch,
  datasets: KeplerDataset[],
  options: { centerMap?: boolean } = {},
  config?: object
): void {
  dispatch(
    wrapTo(
      KEPLER_INSTANCE_ID,
      addDataToMap({
        datasets,
        options: { centerMap: options.centerMap ?? true },
        ...(config ? { config } : {}),
      })
    )
  );
}

/**
 * Refresh path: replaces the data behind existing datasets while preserving the
 * layers, filters and styling the user configured by hand.
 *
 * This is the deliberate departure from the Foursquare plugin, which does
 * removeDataset + addDataset on every refresh and therefore discards the user's
 * layer configuration each time the query re-runs.
 */
export function refreshDatasets(dispatch: Dispatch, datasets: KeplerDataset[]): void {
  dispatch(
    wrapTo(
      KEPLER_INSTANCE_ID,
      updateVisData(datasets, {
        keepExistingConfig: true,
        // Re-framing the viewport on every refresh would fight the user panning.
        centerMap: false,
      })
    )
  );
}
