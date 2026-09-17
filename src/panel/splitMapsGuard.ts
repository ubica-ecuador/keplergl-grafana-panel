/**
 * Puts the per-side layer assignment of a split map back after a data refresh
 * threw it away.
 *
 * A dashboard can open as a swipe comparison: the saved config's `splitMaps`
 * says which layer belongs to which half. That only works while every layer it
 * names already exists. Layers built on a query that has not answered yet — a
 * raster scene resolved from a catalogue, say — are parked in
 * `layerToBeMerged`, and their side assignment waits with them in
 * `splitMapsToBeMerged` (`mergeSplitMaps`, @kepler.gl/reducers
 * `vis-state-merger`).
 *
 * It does not survive the wait. The panel refreshes a dataset with
 * `replaceDataInMap`, and `prepareStateForDatasetReplace`
 * (@kepler.gl/reducers `vis-state-updaters`, 3.3.0-alpha.12) does
 *
 *     if (nextState.layerToBeMerged?.length) {
 *       nextState.splitMapsToBeMerged = serializedState?.splitMaps ?? [];
 *     }
 *
 * — so *any* parked layer, for any reason, makes a refresh overwrite the parked
 * assignment with whatever the split currently shows. Measured on the fire
 * dashboard: the authored `{s2scene: false, s2scene-before: true}` pair was
 * replaced by the two live panes at the first refresh, and by `{}` once the
 * replaced layers had been removed; the next merge then took `mergeSplitMaps`'
 * empty-entry branch (`merged.push(sm)`), which *appends* rather than folds in,
 * leaving four panes. When the raster layers finally arrived,
 * `addNewLayersToSplitMap` added them to every pane as visible: both halves of
 * the curtain drawing the same thing, with no error anywhere.
 *
 * The same family of bug as `layerOrderGuard.ts` — same function, same
 * `layerToBeMerged.length` condition, a different piece of state clobbered.
 *
 * Free of kepler and React so the decision can be tested with literal values.
 * The caller reads the store, dispatches the toggles this returns, and stops
 * once it reports `done`.
 */

import type { SavedMapConfig } from '../data/mapConfig';
import { foldSurplusPanes } from './splitMapsNormalise';

/** One pane of the authored split: which layers it draws, by layer id. */
export interface SavedSplitPane {
  layers: Record<string, boolean>;
}

/** The authored assignment, plus what each of its layer ids was drawn from. */
export interface SavedSplitAssignment {
  /** Pane index -> layer id -> whether that pane draws it. */
  panes: Array<Record<string, boolean>>;
  /** Layer id -> the dataset it was built on, for ids kepler has since reminted. */
  dataIdOf: Record<string, string>;
}

/** A layer as the store holds it, narrowed to what the decision needs. */
export interface LiveLayer {
  id: string;
  dataId?: string;
}

/** One `toggleLayerForMap`: flip this layer's membership of this pane. */
export interface SplitMapToggle {
  mapIndex: number;
  layerId: string;
}

/** What the guard should do with the state it just read. */
export interface SplitMapsDecision {
  /** Toggles to dispatch now, in pane order. */
  toggles: SplitMapToggle[];
  /**
   * Authored layer ids that sit exactly where the config asks, right now.
   *
   * The caller accumulates these for as long as it is armed and hands them back
   * as `placed`: a layer this guard has already put in its place is never moved
   * again, so a user who drags it to the other half afterwards keeps it there.
   */
  placed: string[];
  /** Every authored layer is present and placed: nothing left to watch for. */
  done: boolean;
}

/**
 * The per-side assignment a saved config asks for, or null if it asks for none.
 *
 * Null for a config with no split, or one whose split has a single pane: there
 * is nothing to keep a layer on the right side of.
 *
 * Only the panes kepler can draw are read. A config saved while the pane list
 * was doubling carries more than two, and reading them all would leave the
 * guard waiting for panes that the fold in `splitMapsNormalise.ts` has just
 * removed — until its 60 s window ran out, having repaired nothing.
 */
export function savedSplitAssignment(config: SavedMapConfig | null | undefined): SavedSplitAssignment | null {
  const visState = (config?.config as { visState?: Record<string, unknown> } | undefined)?.visState;
  const splitMaps = visState?.splitMaps as SavedSplitPane[] | undefined;
  if (!Array.isArray(splitMaps) || splitMaps.length < 2) {
    return null;
  }

  const panes = foldSurplusPanes(splitMaps).map((pane) => {
    const layers = pane?.layers ?? {};
    return Object.fromEntries(
      Object.entries(layers)
        .filter(([, value]) => typeof value === 'boolean')
        .map(([id, value]) => [id, value as boolean])
    );
  });

  // A config whose panes all agree asks for nothing this guard has to defend:
  // that is what kepler produces by itself when it adds a layer to both halves.
  const named = panes.flatMap((pane) => Object.keys(pane));
  const differs = named.some((id) => panes.some((pane) => pane[id] !== panes[0][id]));
  if (!differs) {
    return null;
  }

  const savedLayers = (visState?.layers as Array<{ id?: string; config?: { dataId?: string } }> | undefined) ?? [];
  const dataIdOf: Record<string, string> = {};
  for (const layer of savedLayers) {
    if (typeof layer?.id === 'string' && typeof layer?.config?.dataId === 'string') {
      dataIdOf[layer.id] = layer.config.dataId;
    }
  }

  return { panes, dataIdOf };
}

/**
 * Which panes to toggle which layer on, to get back to the authored assignment.
 *
 * Each authored layer is repaired **once** per arming: the ids in `placed` —
 * everything the caller has already seen sitting right — are read but never
 * moved. That is the whole of the difference between defending the assignment
 * against kepler, which loses it in one go, and fighting the user, who moves
 * one layer at a time and means it.
 *
 * `done` says every authored layer was found and placed; until then the caller
 * keeps watching, because the ones still missing are exactly the asynchronous
 * layers this guard exists for.
 *
 * Panes beyond the authored ones are never read and never touched: folding away
 * the surplus kepler's merge leaves behind is `splitMapsNormalise.ts`' job.
 */
export function decideSplitMapRepairs({
  desired,
  splitMaps,
  layers,
  placed = [],
}: {
  desired: SavedSplitAssignment;
  /** kepler's current `visState.splitMaps`. */
  splitMaps: SavedSplitPane[];
  /** kepler's current `visState.layers`. */
  layers: LiveLayer[];
  /** Authored ids already put in their place during this arming. */
  placed?: string[];
}): SplitMapsDecision {
  // Not split (yet, or any more). Nothing to assign, and forcing a split open
  // is not this guard's business.
  if (splitMaps.length < desired.panes.length) {
    return { toggles: [], placed: [], done: false };
  }

  const alreadyPlaced = new Set(placed);
  const toggles: SplitMapToggle[] = [];
  const correct = new Set<string>();
  const wrong = new Set<string>();
  let allFound = true;

  desired.panes.forEach((pane, mapIndex) => {
    const live = splitMaps[mapIndex]?.layers ?? {};
    for (const [savedId, want] of Object.entries(pane)) {
      const layerId = resolveLayerId(savedId, desired, layers);
      if (!layerId) {
        allFound = false;
        continue;
      }
      if (Boolean(live[layerId]) === want) {
        correct.add(savedId);
        continue;
      }
      wrong.add(savedId);
      // Already put right once during this arming: this is the user moving it,
      // not kepler losing it.
      if (!alreadyPlaced.has(savedId)) {
        toggles.push({ mapIndex, layerId });
      }
    }
  });

  // A layer counts as placed only when every authored pane agrees about it.
  const nowPlaced = [...correct].filter((savedId) => !wrong.has(savedId));
  return { toggles, placed: nowPlaced, done: allFound && wrong.size === 0 };
}

/**
 * The live layer an authored id refers to now, or null while it is missing.
 *
 * By id first. kepler mints a **new id** when a layer's type changes — which is
 * what a change of band combination does to a raster layer, through
 * `reconcileRasterLayerType` — so an id that no longer matches is looked up by
 * the dataset it was built on instead. Only when exactly one live layer answers
 * to that dataset and it is not already spoken for by another authored id: two
 * layers over one dataset (points and a heatmap, say) would otherwise be told
 * apart by a coin toss.
 */
function resolveLayerId(savedId: string, desired: SavedSplitAssignment, layers: LiveLayer[]): string | null {
  if (layers.some((layer) => layer.id === savedId)) {
    return savedId;
  }
  const dataId = desired.dataIdOf[savedId];
  if (!dataId) {
    return null;
  }
  const spokenFor = new Set(Object.keys(desired.dataIdOf));
  const candidates = layers.filter((layer) => layer.dataId === dataId && !spokenFor.has(layer.id));
  return candidates.length === 1 ? candidates[0].id : null;
}
