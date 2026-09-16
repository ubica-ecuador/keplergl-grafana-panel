import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { Store } from 'redux';

import type { SavedMapConfig } from '../data/mapConfig';
import { readSplitMaps, toggleLayerInSplitMap } from './keplerAdapter';
import { decideSplitMapRepairs, savedSplitAssignment } from './splitMapsGuard';

/**
 * How long a load gets to build the layers its split names before the guard
 * stops watching.
 *
 * Generous on purpose: the layers it waits for come from a catalogue search and
 * a tile server, and the measured case took 13 s from mount. A guard that gave
 * up sooner would leave exactly the dashboards it exists for unrepaired.
 */
const GIVE_UP_MS = 60_000;

/**
 * Keeps the saved per-side layer assignment of a split map through a refresh.
 *
 * Returns `arm`, to be called wherever data is loaded or refreshed: from then
 * on it watches the store and toggles layers back onto the side the saved
 * config put them on, until every layer that config names has been placed — see
 * `splitMapsGuard.ts` for what overwrites the assignment and when.
 *
 * Armed rather than always on, so that between refreshes the user can move a
 * layer from one half to the other in the side panel and have it stay moved.
 * Like every store-driven hook here, the reconcile runs on a microtask so a
 * toggle is never dispatched from inside the dispatch that triggered it.
 */
export function useSplitMapsGuard({
  store,
  mapConfig,
}: {
  store: Store;
  mapConfig?: SavedMapConfig | null;
}): () => void {
  const desired = useMemo(() => savedSplitAssignment(mapConfig), [mapConfig]);
  const until = useRef(0);
  const unsubscribe = useRef<(() => void) | null>(null);
  const scheduled = useRef(false);

  const stop = useCallback(() => {
    until.current = 0;
    unsubscribe.current?.();
    unsubscribe.current = null;
  }, []);

  const reconcile = useCallback(() => {
    if (!desired || Date.now() > until.current) {
      stop();
      return;
    }
    const live = readSplitMaps(store);
    if (!live) {
      return;
    }
    const action = decideSplitMapRepairs({ desired, splitMaps: live.splitMaps, layers: live.layers });
    if (action.kind === 'done') {
      stop();
      return;
    }
    if (action.kind === 'wait') {
      return;
    }
    for (const { mapIndex, layerId } of action.toggles) {
      toggleLayerInSplitMap(store.dispatch, mapIndex, layerId);
    }
    if (action.settled) {
      stop();
    }
  }, [desired, store, stop]);

  const schedule = useCallback(() => {
    if (scheduled.current) {
      return;
    }
    scheduled.current = true;
    void Promise.resolve().then(() => {
      scheduled.current = false;
      reconcile();
    });
  }, [reconcile]);

  useEffect(() => stop, [stop]);

  return useCallback(() => {
    if (!desired) {
      return;
    }
    until.current = Date.now() + GIVE_UP_MS;
    if (!unsubscribe.current) {
      unsubscribe.current = store.subscribe(schedule);
    }
    // The state that needs repairing may already be in the store — a refresh
    // that dispatched nothing more leaves no change to subscribe to.
    schedule();
  }, [desired, store, schedule]);
}
