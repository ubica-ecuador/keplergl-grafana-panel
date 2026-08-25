import { useEffect, useRef } from 'react';
import type { Store } from 'redux';

import { otherSlot, rasterForWindow, type RasterDataset } from '../data/rasterDataset';
import {
  applyRasterStyle,
  ensureTimeFilter,
  pushTimeRange,
  readSyncSlices,
  readTimeDomain,
  readTimeRange,
  refreshRasters,
  retireRasterSlot,
  showRasterInFreeSlot,
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
 * How long the outgoing scene stays on the map after the new one is added.
 *
 * Long enough for the incoming tiles to paint on a warm cache, short enough
 * that nobody reads it as lag. It is a cover, not a wait: the new scene is
 * already drawing underneath from the moment it is added, so overshooting costs
 * only a little memory and undershooting costs a blink.
 */
const RETIRE_DELAY_MS = 700;

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
 * Scenes are swapped by overlap, never in place: the new one is added to the
 * query's free slot and the old is dropped a moment later, so there is never a
 * frame with no image on the map. See `showRasterInFreeSlot`.
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

  /** The slot showing each query's scene, so the next change knows what to cover. */
  const shown = useRef(new Map<string, string>());
  /** Retirements not yet run, keyed by the slot they will drop. */
  const retiring = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  /** Styling waiting for its layer to exist, so a hand-picked colormap carries over. */
  const pendingStyle = useRef<{ dataId: string; style: Record<string, unknown> } | null>(null);

  const cancelRetire = useRef((id: string) => {
    const timer = retiring.current.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      retiring.current.delete(id);
    }
  });

  const retireNow = useRef((id: string) => {
    cancelRetire.current(id);
    retireRasterSlot(store.dispatch, id);
  });

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

    // Styling waits for kepler to create the layer, which it does
    // asynchronously — so this is retried on every store change until it lands.
    const waiting = pendingStyle.current;
    if (waiting && applyRasterStyle(store, store.dispatch, waiting.dataId, waiting.style)) {
      pendingStyle.current = null;
    }

    const window = readTimeRange(store);
    const selected = series
      .map((raster) => rasterForWindow(raster, window))
      .filter((raster): raster is RasterDataset => raster !== null);

    // Nothing in the window: no scene to cover with, so the raster simply goes.
    if (selected.length === 0) {
      for (const [key, slot] of shown.current) {
        retireNow.current(slot);
        shown.current.delete(key);
      }
      refreshRasters(store, store.dispatch, []);
      return;
    }

    for (const raster of selected) {
      const key = raster.id;
      const currentSlot = shown.current.get(key);
      const onScreen = currentSlot
        ? readRasterScene(store, currentSlot)
        : null;

      // The scene already showing: every drag that stays between two captures
      // lands here, and does nothing at all.
      if (onScreen === raster.metadataUrl) {
        continue;
      }

      // Any retirement still pending for this query must go before the swap.
      // A drag that changes scene twice inside the delay would otherwise leave
      // a timer aimed at the slot the second change just filled — and it would
      // fire, taking the visible image with it. Measured: one frame of bare
      // basemap, which is the very thing the overlap exists to prevent.
      cancelRetire.current(key);
      cancelRetire.current(otherSlot(key));

      const handover = showRasterInFreeSlot(store, store.dispatch, raster);
      shown.current.set(key, handover.shown);
      if (handover.style) {
        pendingStyle.current = { dataId: handover.shown, style: handover.style };
      }
      if (handover.retiring) {
        const going = handover.retiring;
        const timer = setTimeout(() => {
          retiring.current.delete(going);
          retireRasterSlot(store.dispatch, going);
        }, RETIRE_DELAY_MS);
        retiring.current.set(going, timer);
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
    const timers = retiring.current;
    return () => {
      unsubscribe();
      // A retirement that fires after the panel is gone would dispatch into a
      // store kepler has already torn down.
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
      timers.clear();
    };
  }, [isReady, store, rasters]);
}

/** The scene a raster slot is currently showing, or null if the slot is empty. */
function readRasterScene(store: Store, slot: string): string | null {
  const state = store.getState() as { keplerGl?: Record<string, { visState?: { datasets?: Record<string, { metadata?: { metadataUrl?: string } }> } }> };
  const datasets = Object.values(state.keplerGl ?? {})[0]?.visState?.datasets ?? {};
  return datasets[slot]?.metadata?.metadataUrl ?? null;
}
