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
  setRasterLayerVisible,
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
 * A COG's scenes are swapped in place — the dataset's asset href is re-pointed
 * and the layer is told to refetch — so the layer the user styled is the same
 * layer throughout, and deck keeps the previous tiles on screen while the new
 * ones arrive. A PMTiles archive cannot be moved that way and falls to the
 * rebuild below; `swapRasterScene` says why.
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

  /**
   * Layers already given their colour ramp, so the user can then change it
   * freely. Keyed by layer id rather than by dataset: should a layer ever be
   * rebuilt, the ramp is owed to the new one too.
   */
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

    // The configured ramp, applied once per layer — kepler creates the layer
    // asynchronously, so this is retried on each store change until it lands.
    // Once only: after that the ramp is the user's to change from the layer
    // panel, and re-imposing it on every store change would undo them.
    for (const raster of series) {
      // Nothing to dress on an archive: its tiles are images already drawn, so
      // kepler offers opacity and nothing else for them. The ramp was chosen
      // when the file was built.
      // Neither an archive nor a painted COG is coloured in the browser: both
      // arrive as finished pictures, so kepler's colormap has nothing to act on.
      if (!raster.colormap || raster.kind === 'pmtiles' || raster.kind === 'painted') {
        continue;
      }
      const layerId = readRasterLayerId(store, raster.id);
      if (layerId && !dressed.current.has(layerId)) {
        if (applyRasterStyle(store, store.dispatch, raster.id, { colormapId: raster.colormap })) {
          dressed.current.add(layerId);
        }
      }
    }

    const window = readTimeRange(store);
    const selected = series
      .map((raster) => rasterForWindow(raster, window))
      .filter((raster): raster is RasterDataset => raster !== null);

    // Nothing in the window: hide the layer rather than drop the dataset. A
    // window with no scene is a passing state — playback crosses one on every
    // lap — and rebuilding the layer afterwards would hand the user a fresh one
    // with default styling each time round.
    if (selected.length === 0) {
      for (const raster of series) {
        setRasterLayerVisible(store, store.dispatch, raster.id, false);
      }
      return;
    }

    for (const raster of selected) {
      setRasterLayerVisible(store, store.dispatch, raster.id, true);
      // The scene already showing: every drag that stays between two captures
      // lands here, and does nothing at all.
      if (readRasterScene(store, raster) === raster.sourceUrl) {
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

/** The id of the layer drawing a raster dataset, or null before it exists. */
function readRasterLayerId(store: Store, dataId: string): string | null {
  const state = store.getState() as {
    keplerGl?: Record<string, { visState?: { layers?: Array<{ id: string; config?: { dataId?: string } }> } }>;
  };
  const layers = Object.values(state.keplerGl ?? {})[0]?.visState?.layers ?? [];
  return layers.find((layer) => layer.config?.dataId === dataId)?.id ?? null;
}

/**
 * The scene a raster dataset is currently drawing, or null if it holds none.
 *
 * Read from wherever that dataset's scene actually lives, which is not the
 * same field for both formats. For a COG it is the asset's href: `metadataUrl`
 * keeps naming the STAC document the dataset was created from, whichever scene
 * it ended up pointing at. For an archive `metadataUrl` *is* the scene.
 */
function readRasterScene(store: Store, raster: RasterDataset): string | null {
  const state = store.getState() as {
    keplerGl?: Record<
      string,
      {
        visState?: {
          datasets?: Record<string, { metadata?: { metadataUrl?: string; assets?: Record<string, { href?: string }> } }>;
        };
      }
    >;
  };
  const datasets = Object.values(state.keplerGl ?? {})[0]?.visState?.datasets ?? {};
  const metadata = datasets[raster.id]?.metadata;
  if (raster.kind === 'pmtiles') {
    return metadata?.metadataUrl ?? null;
  }
  const asset = Object.values(metadata?.assets ?? {}).find((candidate) => typeof candidate?.href === 'string');
  return asset?.href ?? null;
}
