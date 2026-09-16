/**
 * Keeps kepler's list of split-map panes down to the two that exist.
 *
 * kepler supports exactly two panes and nothing else: `computeSplitMapLayers`
 * builds two, `closeSpecificMapAtIndex` finds the survivor with `1 - index`,
 * and in swipe mode `maps-layout.js:80` renders `children[1]` and `children[0]`
 * and discards the rest. A third pane is therefore never something a user asked
 * for; it is always the merge defect described in `splitMapsGuard.ts`.
 *
 * And that defect *doubles*. `prepareStateForDatasetReplace` copies the current
 * N panes into `splitMapsToBeMerged`; when the panes are momentarily empty —
 * every refresh where the raster datasets are absent, so `none in range`, an
 * all-cloudy box, a strict coverage cut, `Box too large` — `mergeSplitMaps`
 * takes its empty-entry branch (`merged.push`) and appends all N to the N
 * already there. Measured on the fire dashboard before this fix: fifteen
 * ordinary variable changes took the pane list 2 → 4 → 8 → … → **512**. Only
 * two ever draw, but `kepler-gl.js:538` builds a `MapContainer` and a
 * `mapFieldsSelector` call per pane per render, and `SplitMapsSchema` has no
 * `save` override, so one "Save current map configuration" would write all of
 * them into the dashboard JSON.
 *
 * There is no kepler action that sets or trims `splitMaps` — `toggleLayerForMap`
 * only flips one layer, and `toggleSplitMap` goes to zero panes and back to two
 * through a `DUAL_MAP` collapse that tears both maps down. So this is applied at
 * the one seam the plugin owns without touching kepler: the reducer it composes
 * itself in `keplerStore.ts`. Reading the result of a reducer and folding it is
 * not a dispatch, so nothing here can loop, and a state that is already within
 * bounds is returned by identity — same object, no re-render.
 */

/**
 * How many panes kepler can actually draw. Not a policy choice of this plugin's:
 * see the three places above that all assume two.
 */
export const RENDERED_PANES = 2;

/**
 * The pane list, folded back to the first {@link RENDERED_PANES} if it grew.
 *
 * The surviving panes are the first two on purpose: the appended ones are
 * copies of exactly those, made by the merge a moment earlier, so the live
 * assignment — including whatever `splitMapsGuard` has just repaired — is
 * always at the front.
 *
 * Returns the array it was given when there is nothing to fold, so the caller
 * can compare by identity.
 */
export function foldSurplusPanes<T>(splitMaps: T[]): T[] {
  return splitMaps.length > RENDERED_PANES ? splitMaps.slice(0, RENDERED_PANES) : splitMaps;
}

/** The shape this reaches into: kepler's registered instances under `keplerGl`. */
interface KeplerRootState {
  keplerGl?: Record<string, { visState?: { splitMaps?: unknown[] } }>;
}

/**
 * The store state with every kepler instance's pane list folded back.
 *
 * Returns the state it was given, by identity, when no instance had grown —
 * which is every action but the handful that merge, so the cost on the common
 * path is one property read per registered instance.
 */
export function withFoldedSplitMaps<S>(state: S): S {
  const root = state as KeplerRootState | undefined;
  const instances = root?.keplerGl;
  if (!instances) {
    return state;
  }

  let changed = false;
  const folded: Record<string, unknown> = {};
  for (const [id, instance] of Object.entries(instances)) {
    const splitMaps = instance?.visState?.splitMaps;
    if (!Array.isArray(splitMaps) || splitMaps.length <= RENDERED_PANES) {
      folded[id] = instance;
      continue;
    }
    changed = true;
    folded[id] = {
      ...instance,
      visState: { ...instance.visState, splitMaps: foldSurplusPanes(splitMaps) },
    };
  }

  return changed ? ({ ...root, keplerGl: folded } as S) : state;
}
