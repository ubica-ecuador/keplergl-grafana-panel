import type { SavedMapConfig } from '../data/mapConfig';

/**
 * Keeps a restored 3D tileset from re-framing a map that already has its viewport.
 *
 * kepler's 3D tile layer frames the map around its tileset the first time the
 * tileset loads (`Tile3DLayer._onTilesetLoad` → `onFitBounds` → `fitBounds`),
 * once per layer instance, gated by nothing but a private `_hasFittedBounds`.
 * It never consults `addDataToMap`'s `centerMap` — which is how every other
 * layer learns that a saved config already positions the map. The load path
 * sets that option from the saved config (`loadDatasets`), and the row layers
 * honour it; the tileset frames later, on its own, and does not.
 *
 * So a saved map with a 3D tileset opened on its saved viewport and, the moment
 * `tileset.json` arrived, jumped to the tileset's bounds. Measured on the
 * provisioned `tile3d` board: zoom 18.4 applied, then 16.27, on four clean loads
 * out of four. The pitch survived only because `fitBoundsUpdater` writes centre
 * and zoom and nothing else. The viewport guard's restore cannot undo it: that
 * acts only on kepler's exact default viewport, and a tileset's bounds are
 * nowhere near San Francisco.
 *
 * **When to hold is the hard part.** Setting the flag straight after
 * `addDataToMap` does nothing — measured, the call found zero layers in the
 * store. kepler creates the datasets of a restored config through its task
 * middleware (`Task.allSettled` over `createNewDataEntryTask`) and builds the
 * layers only once those settle, about a second later. So the hold runs from
 * the viewport guard, on every store change of its load window: after the layer
 * appears, and well before its `tileset.json` does.
 *
 * **Which layers to hold is the other part.** Running on every change of that
 * window means a tileset added by hand in those seconds is in the store too, and
 * that one should frame the map — it is what adding it asks for. So only layers
 * drawing a dataset the saved config restores are held.
 *
 * Free of kepler, so the rules can be tested with plain objects.
 */

/** kepler's layer type for a 3D tileset — its `LAYER_TYPES.tile3d`. */
const TILE3D_LAYER_TYPE = 'tile3d';

/** kepler's dataset type for one — its `DatasetType.TILE_3D`. */
const TILE3D_DATASET_TYPE = 'tile-3d';

/** The flag kepler's 3D tile layer sets once it has framed the map. Private to kepler. */
const FITTED_FLAG = '_hasFittedBounds';

/**
 * The ids of the 3D tilesets a saved config restores.
 *
 * Entries it cannot read are skipped rather than thrown on: this runs from the
 * viewport guard, and a hand-edited dashboard should cost a tileset its hold,
 * not the whole guard its load window.
 */
export function restoredTilesetIds(config: SavedMapConfig | null | undefined): Set<string> {
  const ids = new Set<string>();
  const datasets: unknown = config?.datasets;
  if (!Array.isArray(datasets)) {
    return ids;
  }
  for (const entry of datasets) {
    const data = (entry as { data?: { id?: unknown; type?: unknown } | null } | null)?.data;
    if (data && data.type === TILE3D_DATASET_TYPE && typeof data.id === 'string') {
      ids.add(data.id);
    }
  }
  return ids;
}

/**
 * Marks the restored 3D tile layers as already framed, and returns how many it marked.
 *
 * A layer that has framed the map already is left as it is and not counted, so
 * the count falls to zero once the work is done — which matters, because this is
 * called on every store change of the load window.
 */
export function holdTilesetFraming(
  layers: readonly unknown[] | null | undefined,
  restoredDataIds: ReadonlySet<string>
): number {
  if (restoredDataIds.size === 0) {
    return 0;
  }
  let held = 0;
  for (const layer of layers ?? []) {
    if (!layer || typeof layer !== 'object') {
      continue;
    }
    const candidate = layer as Record<string, unknown> & { config?: { dataId?: unknown } | null };
    const dataId = candidate.config?.dataId;
    if (
      candidate.type !== TILE3D_LAYER_TYPE ||
      typeof dataId !== 'string' ||
      !restoredDataIds.has(dataId) ||
      candidate[FITTED_FLAG] === true
    ) {
      continue;
    }
    candidate[FITTED_FLAG] = true;
    held += 1;
  }
  return held;
}
