import { useEffect, useRef } from 'react';
import type { Store } from 'redux';

import { rasterForWindow, type RasterDataset } from '../data/rasterDataset';
import {
  applyRasterStyle,
  ensureTimeFilter,
  pushTimeRange,
  readSyncSlices,
  readTimeDomain,
  readTimeRange,
  refreshRasters,
  swapRasterScene,
} from './keplerAdapter';
import { SliceWatcher } from './sliceWatcher';

interface Params {
  store: Store;
  /** kepler only accepts actions once its instance has registered. */
  isReady: boolean;
  /** The raster queries, each carrying its whole series of scenes. */
  rasters: RasterDataset[];
}

/**
 * Makes the map's time filter choose which scene of a raster series is drawn.
 *
 * A query that returns one row per pass of the satellite is a small catalogue,
 * and the time widget is the natural way to move through it: drag the window
 * and the map shows the most recent image inside it. The whole series is
 * already in the browser, so this costs no query — a drag that stays between
 * two passes changes nothing at all, and one that crosses a pass swaps the
 * scene and nothing else.
 *
 * Deliberately not built on the dashboard's time range or on variables. Both
 * would send the choice back through Grafana, and a query re-run replaces the
 * dataset the time filter is bound to — which resets the window, which
 * republishes, which re-runs the query. That loop is not hypothetical: it is
 * what this hook exists instead of.
 *
 * Scenes are swapped in place — the dataset's asset href is re-pointed and the
 * layer is told to refetch — so the layer the user styled is the same layer
 * throughout, and deck keeps the previous tiles on screen while the new ones
 * arrive. See `swapRasterScene`.
 *
 * Reconciliation runs on a **microtask** rather than inside the subscription:
 * dispatching while kepler is mid-dispatch re-enters its reducer and overflows
 * the stack. Same shape as `useTimeVariableSync`, for the same reason.
 */
export function useRasterTimeline({ store, isReady, rasters }: Params): void {
  const rastersRef = useRef(rasters);
  useEffect(() => {
    rastersRef.current = rasters;
  }, [rasters]);

  /** Datasets already given their colour ramp, so the user can then change it freely. */
  const dressed = useRef(new Set<string>());

  // The filter is opened to its full domain once, when this hook first finds
  // it. kepler creates a time filter narrowed to a slice of the domain, and
  // that slice is somewhere in the past — so without this the map would open on
  // an old scene while the panel had just drawn the newest one, and the change
  // would read as a glitch rather than as a choice. Opening it wide makes the
  // opening scene and the freshest scene the same thing.
  const opened = useRef(false);

  const reconcile = useRef(() => {
    const series = rastersRef.current;
    // Only a dated series has anything to follow. A single-scene query keeps
    // its old behaviour and never reaches kepler through this path.
    if (!series.some((raster) => raster.scenes.some((scene) => scene.time !== null))) {
      return;
    }
    if (!ensureTimeFilter(store, store.dispatch)) {
      return;
    }

    if (!opened.current) {
      const domain = readTimeDomain(store);
      if (domain) {
        pushTimeRange(store, store.dispatch, domain);
        opened.current = true;
      }
    }

    // The configured ramp, applied once per dataset — kepler creates the layer
    // asynchronously, so this is retried on each store change until it lands.
    // Once only: after that the ramp is the user's to change from the layer
    // panel, and re-imposing it on every store change would undo them.
    for (const raster of series) {
      if (raster.colormap && !dressed.current.has(raster.id)) {
        if (applyRasterStyle(store, store.dispatch, raster.id, { colormapId: raster.colormap })) {
          dressed.current.add(raster.id);
        }
      }
    }

    const window = readTimeRange(store);
    const selected = series
      .map((raster) => rasterForWindow(raster, window))
      .filter((raster): raster is RasterDataset => raster !== null);

    // Nothing in the window: nothing to draw, so the raster leaves the map.
    if (selected.length === 0) {
      refreshRasters(store, store.dispatch, []);
      return;
    }

    for (const raster of selected) {
      // The scene already showing: every drag that stays between two captures
      // lands here, and does nothing at all.
      if (readRasterScene(store, raster.id) === raster.cogUrl) {
        continue;
      }
      // In place if the dataset is there to re-point; the rebuild is only for
      // the first scene, or one that has just been removed and is coming back.
      if (!swapRasterScene(store, store.dispatch, raster)) {
        refreshRasters(store, store.dispatch, [raster]);
      }
    }
  });

  const pending = useRef(false);
  const schedule = useRef(() => {
    if (pending.current) {
      return;
    }
    pending.current = true;
    void Promise.resolve().then(() => {
      pending.current = false;
      reconcile.current();
    });
  });

  const watcher = useRef(new SliceWatcher());
  const onStoreChange = useRef(() => {
    if (watcher.current.changed(readSyncSlices(store))) {
      schedule.current();
    }
  });

  useEffect(() => {
    if (!isReady) {
      return;
    }
    schedule.current();
    const unsubscribe = store.subscribe(onStoreChange.current);
    return unsubscribe;
  }, [isReady, store, rasters]);
}

/**
 * The scene a raster dataset is currently drawing, or null if it holds none.
 *
 * Read from the asset's href rather than from `metadataUrl`, because that is
 * what an in-place swap changes: `metadataUrl` keeps naming the STAC document
 * the dataset was created from, whichever scene it ended up pointing at.
 */
function readRasterScene(store: Store, dataId: string): string | null {
  const state = store.getState() as {
    keplerGl?: Record<
      string,
      { visState?: { datasets?: Record<string, { metadata?: { assets?: Record<string, { href?: string }> } }> } }
    >;
  };
  const datasets = Object.values(state.keplerGl ?? {})[0]?.visState?.datasets ?? {};
  const assets = datasets[dataId]?.metadata?.assets ?? {};
  const asset = Object.values(assets).find((candidate) => typeof candidate?.href === 'string');
  return asset?.href ?? null;
}
