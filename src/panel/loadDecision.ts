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
  return appliedConfig === currentConfig ? 'refresh' : 'rebuild';
}
