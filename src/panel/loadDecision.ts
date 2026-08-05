import { SavedMapConfig } from '../data/mapConfig';

export type LoadAction = 'rebuild' | 'refresh';

interface LoadState {
  /** Whether kepler has already been handed a full map. */
  hasLoaded: boolean;
  /** The config the current map was built from. */
  appliedConfig: SavedMapConfig | null | undefined;
  /** The config the panel options currently carry. */
  currentConfig: SavedMapConfig | null | undefined;
}

/**
 * Chooses between rebuilding the map and refreshing its data.
 *
 * `rebuild` is `addDataToMap`: it constructs layers and frames the viewport
 * around the data. `refresh` is `updateVisData` with `keepExistingConfig`: it
 * swaps the rows while preserving everything the user configured on top.
 *
 * Tracked as an explicit `hasLoaded` flag rather than inferred from the config
 * alone, because "no config yet" and "no config saved" are both `undefined` and
 * comparing them would make the first load look like a refresh.
 */
export function decideLoadAction({ hasLoaded, appliedConfig, currentConfig }: LoadState): LoadAction {
  if (!hasLoaded) {
    return 'rebuild';
  }
  // kepler will not accept a config once data is loaded, so a config change has
  // to rebuild rather than patch.
  return isSameConfig(appliedConfig, currentConfig) ? 'refresh' : 'rebuild';
}

/**
 * Compares two saved configs by value.
 *
 * Identity is not usable here: Grafana rebuilds the panel options object on
 * every options change, so the very same saved config arrives as a new object
 * each time. Treating that as a change rebuilt the map — discarding the viewport
 * the user was looking at — which is precisely what happened when they clicked
 * "Save current map configuration", since that click is itself an options
 * change. Both configs come from the same serialisation, so their key order
 * matches and a JSON comparison is sound.
 */
function isSameConfig(a: SavedMapConfig | null | undefined, b: SavedMapConfig | null | undefined): boolean {
  if (a === b) {
    return true;
  }
  if (!a || !b) {
    return false;
  }
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Splits a refresh into the datasets kepler already holds and the ones it does not.
 *
 * The two need different calls. `updateVisData` cannot swap the rows of a
 * dataset kepler already knows: `createNewDataEntry` sees the id, takes the
 * incremental-batch path meant for streaming a dataset in pieces, and ends at
 * `dataContainer.update?.()` — a method `RowDataContainer` does not implement.
 * The optional chaining swallows it and the old rows stay. `replaceDataInMap`
 * does the swap, but only for an id that exists, so a query that gains a new
 * refId still has to go through `updateVisData`.
 */
export function splitRefresh<T extends { id: string }>(
  datasets: T[],
  knownIds: readonly string[]
): { replace: T[]; add: T[] } {
  const known = new Set(knownIds);
  return {
    replace: datasets.filter((dataset) => known.has(dataset.id)),
    add: datasets.filter((dataset) => !known.has(dataset.id)),
  };
}
