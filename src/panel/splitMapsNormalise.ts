/**
 * Keeps a saved split map down to the two panes kepler can draw.
 *
 * kepler supports exactly two panes and nothing else: `computeSplitMapLayers`
 * builds two, `closeSpecificMapAtIndex` finds the survivor with `1 - index`,
 * and in swipe mode `maps-layout.js:80` renders `children[1]` and `children[0]`
 * and discards the rest. A third pane is therefore never something a user asked
 * for.
 *
 * Up to kepler.gl 3.3.0-alpha.12 the list *doubled*: `mergeSplitMaps` appended
 * panes without layers instead of matching them by index, so every refresh
 * that found the panes empty — `none in range`, an all-cloudy box, `Box too
 * large` — added as many again. Measured on the fire dashboard: 2 → 8 → 16 → …
 * → **512** in six round trips of the Imagery box. This module used to fold
 * the list back after every action, in the reducer `keplerStore.ts` composes.
 *
 * keplergl/kepler.gl#3735, sent from this repo and released in 3.3.0-alpha.13,
 * merges by index, and the same six round trips now stay at two panes
 * throughout, so the fold is gone from the reducer. What is left is the list
 * that doubled *before*: `SplitMapsSchema` has no `save` override, so a
 * "Save current map configuration" made during the doubling wrote every pane
 * into the dashboard JSON, and loading it merges every one of them back — each
 * costing kepler a `MapContainer` and a `mapFieldsSelector` call per render
 * (`kepler-gl.js:538`), and each saved again by the next Save. So a saved
 * config is folded once, as it is loaded.
 */

/**
 * How many panes kepler can actually draw. Not a policy choice of this plugin's:
 * see the three places above that all assume two.
 */
export const RENDERED_PANES = 2;

/**
 * The pane list, folded back to the first {@link RENDERED_PANES} if it grew.
 *
 * The surviving panes are the first two on purpose: the doubling appended
 * copies of exactly those, so the authored assignment is always at the front.
 *
 * Returns the array it was given when there is nothing to fold, so the caller
 * can compare by identity.
 */
export function foldSurplusPanes<T>(splitMaps: T[]): T[] {
  return splitMaps.length > RENDERED_PANES ? splitMaps.slice(0, RENDERED_PANES) : splitMaps;
}

/**
 * Whether `kept` already says everything `dropped` says: each layer the dropped
 * pane names, the kept pane names with the same value. An empty pane says
 * nothing and is subsumed by any.
 */
function subsumes(kept: unknown, dropped: unknown): boolean {
  const keptLayers = (kept as { layers?: Record<string, unknown> } | null)?.layers ?? {};
  const droppedLayers = (dropped as { layers?: Record<string, unknown> } | null)?.layers ?? {};
  return Object.entries(droppedLayers).every(([id, value]) => keptLayers[id] === value);
}

/** The shape this reaches into: a config as `parseSavedConfig` returns it. */
interface ConfigWithSplitMaps {
  visState?: { splitMaps?: unknown[] };
}

/**
 * The parsed saved config with its pane list folded back.
 *
 * Returns the config it was given, by identity, when it has no more panes than
 * kepler draws — every config saved since the doubling was fixed.
 */
export function foldSavedSplitMaps<C>(config: C): C {
  const splitMaps = (config as ConfigWithSplitMaps | null | undefined)?.visState?.splitMaps;
  if (!Array.isArray(splitMaps) || splitMaps.length <= RENDERED_PANES) {
    return config;
  }

  // A config saved during the doubling carries copies of the first two panes,
  // and folding those loses nothing. Only a pane whose assignment no kept pane
  // carries is a real loss, and that is the case to make discoverable: a
  // hand-written config meaning three panes on purpose, which the next Save
  // would then write back without them.
  const kept = foldSurplusPanes(splitMaps);
  const lost = splitMaps.slice(RENDERED_PANES).filter((pane) => !kept.some((k) => subsumes(k, pane)));
  if (lost.length > 0) {
    console.warn(
      `[kepler panel] saved split map has ${splitMaps.length} panes; kepler draws ${RENDERED_PANES}, ` +
        `so ${splitMaps.length - RENDERED_PANES} were dropped, ${lost.length} of them with a layer ` +
        `assignment the remaining panes do not have.`
    );
  }

  const { visState } = config as ConfigWithSplitMaps;
  return { ...config, visState: { ...visState, splitMaps: kept } };
}
