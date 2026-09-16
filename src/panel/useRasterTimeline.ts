import { useEffect, useRef } from 'react';
import type { Store } from 'redux';

import { rasterForWindow, rasterStyleKey, type RasterDataset } from '../data/rasterDataset';
import {
  applyRasterStyle,
  ensureTimeFilter,
  isTimeFilterAnimating,
  pushTimeRange,
  readSyncSlices,
  readTimeDomain,
  readTimeRange,
  reconcileRasterLayerType,
  refreshRasters,
  setRasterLayerVisible,
  swapRasterScene,
} from './keplerAdapter';
import { makeSettler, pacingFor, SETTLE_MS } from './settle';
import { SliceWatcher } from './sliceWatcher';
import { opensToDomain, type TimeVariableMapping } from './timeVariableSync';
import { readVariableWindow } from './useTimeVariableSync';

interface Params {
  store: Store;
  /** kepler only accepts actions once its instance has registered. */
  isReady: boolean;
  /**
   * The variables the map publishes its window to, or null when it publishes
   * none. Their presence is what tells this timeline to leave the clock alone.
   */
  timeVariables: TimeVariableMapping | null;
  /** The raster queries, each carrying its whole series of scenes. */
  rasters: RasterDataset[];
}

/**
 * Keeps the layer drawing a raster query in step with the query, and makes the
 * map's time filter choose which of its scenes is drawn.
 *
 * Two jobs, and only the second one is about time. The first — the layer's type
 * and its styling — runs for every raster, dated or not: which of them a query
 * needs is decided by its band combination, which a dashboard variable can
 * change at any moment on a panel whose scene query carries no time column at
 * all.
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
export function useRasterTimeline({ store, isReady, rasters, timeVariables }: Params): void {
  const rastersRef = useRef(rasters);
  useEffect(() => {
    rastersRef.current = rasters;
  }, [rasters]);

  const timeVariablesRef = useRef(timeVariables);
  useEffect(() => {
    timeVariablesRef.current = timeVariables;
  }, [timeVariables]);

  /**
   * Layers already given their style, so the user can then change it freely.
   * Keyed by layer id *and* style — see the loop below for why.
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

    // The layer drawing each raster, put back in step with the raster itself:
    // first its type, then its style. Neither has anything to do with the
    // clock, so both run before the dated check below — a query that returns
    // one undated scene still has a band combination, and gating its styling
    // on a time column is what made every index draw true colour.
    for (const raster of series) {
      // A change of band combination can change which kepler layer type the
      // dataset needs; nothing in kepler notices. `reconcileRasterLayerType`
      // says why, and mints a new layer id when it acts — which is exactly
      // what makes the dressing below run again for the replacement.
      reconcileRasterLayerType(store, store.dispatch, raster.id);

      // The configured ramp and preset, applied once per layer *and style* —
      // kepler creates the layer asynchronously, so this is retried on each
      // store change until it lands. After that the style is the user's to
      // change from the layer panel, and re-imposing it on every store change
      // would undo them — except a band combination changes the style from
      // outside, and the layer must be dressed again when that happens. See
      // `rasterDressKey` below for the rule that tells the two apart.
      const layerId = readRasterLayerId(store, raster.id);
      const key = rasterDressKey(raster, layerId);
      if (key && !dressed.current.has(key)) {
        const style = {
          ...(raster.colormap ? { colormapId: raster.colormap } : {}),
          ...(raster.preset ? { preset: raster.preset } : {}),
        };
        if (applyRasterStyle(store, store.dispatch, raster.id, style)) {
          dressed.current.add(key);
        }
      }
    }

    // Only a dated series has a clock to follow. A single-scene query keeps
    // its old behaviour and never reaches kepler through the path below.
    if (!series.some((raster) => raster.scenes.some((scene) => scene.time !== null))) {
      return;
    }
    if (!ensureTimeFilter(store, store.dispatch)) {
      return;
    }

    if (opensToDomain(opened.current, readVariableWindow(timeVariablesRef.current))) {
      const domain = readTimeDomain(store);
      if (domain) {
        pushTimeRange(store, store.dispatch, domain);
        opened.current = true;
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

  // Built on first use rather than during render. `makeSettler` is an ordinary
  // function call, and handing it a closure over `reconcile` at render time is
  // what `react-hooks/refs` flags: it cannot see that the job is only ever run
  // from a timeout. Constructed once and kept, so the cooldown a drag is
  // building up survives the re-renders Grafana's deep clone of the panel data
  // causes.
  const settlerRef = useRef<ReturnType<typeof makeSettler> | null>(null);
  const settler = useRef(() => {
    if (settlerRef.current === null) {
      settlerRef.current = makeSettler(SETTLE_MS, () => reconcile.current());
    }
    return settlerRef.current;
  });
  // Paced only once the map has opened. The opening frames are a conversation —
  // find the filter, widen it to its domain, let the range sync land — and
  // spacing them out reorders it, so the map comes up on the newest scene
  // instead of the one the dashboard's range asked for. Dragging is the burst
  // worth pacing, and it cannot happen before the widget is on screen.
  // Playback is the exception: pacing it swallows the animation whole, and it
  // costs nothing to let through because the reconcile above dispatches only
  // when the scene actually changes. See `pacingFor`.
  const schedule = useRef(() =>
    pacingFor({ opened: opened.current, animating: isTimeFilterAnimating(store) }) === 'paced'
      ? settler.current().schedule()
      : settler.current().scheduleNow()
  );

  const watcher = useRef(new SliceWatcher());
  const onStoreChange = useRef(() => {
    if (watcher.current.changed(readSyncSlices(store))) {
      schedule.current();
    }
  });


  // Cancelled on unmount and nowhere else. Hanging it off the subscription
  // effect looked tidier and starved the reconcile outright: that effect
  // re-runs whenever its inputs change identity — which Grafana's deep clone of
  // the panel data makes frequent — so the pending run was cancelled and
  // rescheduled faster than it could ever fire, and the clock stopped moving
  // the map at all.
  useEffect(() => () => settlerRef.current?.cancel(), []);

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
 * Whether a raster's style still needs to be (re-)applied, and the key to
 * remember it by if so — null when there is nothing to dress, or nowhere yet
 * to dress it.
 *
 * Pure and exported so the "once per layer *and* style" rule can be pinned
 * without a kepler store: feed it the layer id the reconcile found and the
 * raster of the moment, and compare the key it returns against what is
 * already in `dressed`. Keyed by style, not by layer alone, on purpose —
 * dressing once per layer is what keeps the user's own changes from the layer
 * panel, and a band combination changes the style from *outside*, so the same
 * layer must be dressed again when that happens rather than being skipped as
 * already done.
 *
 * Null for an archive or a painted COG regardless of `colormap`/`preset`:
 * both arrive as a finished picture, so kepler's colormap and band presets
 * have nothing in the browser to act on. Null too before the layer exists —
 * kepler builds it asynchronously — and before the raster carries any style
 * of its own, which is the ordinary true-colour case.
 */
export function rasterDressKey(raster: RasterDataset, layerId: string | null): string | null {
  if ((!raster.colormap && !raster.preset) || raster.kind === 'pmtiles' || raster.kind === 'painted') {
    return null;
  }
  return layerId ? `${layerId}|${rasterStyleKey(raster)}` : null;
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
