import { useEffect } from 'react';
import type { Store } from 'redux';

import { fitMapToBounds, keepSavedFraming, readLayerBoundsUnion, readMapState, restoreViewport } from './keplerAdapter';
import { restoredTilesetIds } from './tile3dFraming';
import { decideViewportGuard, GUARD_WINDOW_MS, savedViewportOf } from './viewportGuard';
import type { SavedMapConfig } from '../data/mapConfig';

interface Params {
  store: Store;
  /** kepler only takes viewport updates once its instance has registered. */
  isReady: boolean;
  /** The saved config the current map was built from, if any. */
  mapConfig?: SavedMapConfig | null;
  /** Bumped by the load effect on every rebuild; 0 means never armed. */
  arm: number;
}

/**
 * Keeps the intended viewport alive through the load window.
 *
 * kepler's internal view state (`MapViewStateContext`) is seeded with the
 * default viewport at mount, and its debounced write-back races the saved
 * config's `addDataToMap` — whichever lands last wins, which is why a saved
 * map sometimes opened on kepler's default San Francisco instead of its own
 * viewport. This hook is armed on each rebuild and, for a bounded window,
 * puts the viewport back whenever the map lands exactly on the default
 * triple: the saved config's viewport when there is one, the data bounds —
 * what `centerMap` meant to do — when there is not.
 *
 * The first pass runs on arming, before the data lands, so a saved viewport
 * also applies *early* — the map opens framed right rather than flashing the
 * default while the query runs. The decision rules, window and attempt cap
 * live in `viewportGuard.ts`; the cap and the exact-default fingerprint are
 * what guarantee the guard can never fight the user's own panning.
 *
 * It also holds the 3D tilesets a saved config restores from framing the map
 * around themselves when they load, which would otherwise replace the saved
 * zoom a second after it landed — see `tile3dFraming.ts`.
 *
 * Same structural rule as the sibling hooks: dispatches happen on a
 * microtask, never inside the store subscription.
 */
export function useViewportGuard({ store, isReady, mapConfig, arm }: Params): void {
  useEffect(() => {
    if (!isReady || arm === 0) {
      return;
    }

    const armedAt = Date.now();
    const saved = savedViewportOf(mapConfig);
    // Only a map that has a viewport of its own needs its tilesets held back
    // from framing themselves; one without is meant to be framed on its data.
    const tilesets = saved ? restoredTilesetIds(mapConfig) : new Set<string>();
    let attempts = 0;
    let disarmed = false;
    let pending = false;
    let unsubscribe = () => {};
    let expiry: ReturnType<typeof setTimeout> | null = null;

    const disarm = () => {
      disarmed = true;
      unsubscribe();
      if (expiry !== null) {
        clearTimeout(expiry);
        expiry = null;
      }
    };

    const check = () => {
      if (disarmed) {
        return;
      }
      // A restored 3D tileset frames the map around itself when its tileset
      // loads — later, on its own, ignoring the `centerMap` the load set. Its
      // layer only appears once kepler's dataset tasks settle, which is why the
      // hold runs here, on every change of the window, and not after
      // `loadDatasets`. Setting a flag is not a dispatch, so this path is safe
      // for it. See `tile3dFraming.ts`.
      if (tilesets.size > 0) {
        keepSavedFraming(store, tilesets);
      }
      const mapState = readMapState(store);
      if (!mapState || typeof mapState.latitude !== 'number' || typeof mapState.longitude !== 'number') {
        return;
      }
      const action = decideViewportGuard({
        elapsedMs: Date.now() - armedAt,
        attempts,
        mapState: mapState as { latitude: number; longitude: number; zoom: number },
        saved,
        bounds: readLayerBoundsUnion(store),
      });
      if (action.kind === 'disarm') {
        disarm();
      } else if (action.kind === 'restore') {
        attempts += 1;
        restoreViewport(store, store.dispatch, action.viewport);
      } else if (action.kind === 'fit') {
        attempts += 1;
        fitMapToBounds(store.dispatch, action.bounds);
      }
    };

    const schedule = () => {
      if (pending || disarmed) {
        return;
      }
      pending = true;
      void Promise.resolve().then(() => {
        pending = false;
        check();
      });
    };

    schedule();
    unsubscribe = store.subscribe(schedule);
    expiry = setTimeout(disarm, GUARD_WINDOW_MS + 500);
    return disarm;
  }, [isReady, arm, mapConfig, store]);
}
