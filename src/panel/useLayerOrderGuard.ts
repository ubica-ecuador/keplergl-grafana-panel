import { useCallback, useEffect, useRef } from 'react';
import type { Store } from 'redux';

import { readLayerOrder, restoreLayerOrder } from './keplerAdapter';
import { decideLayerOrderRestore, type LayerOrderEntry } from './layerOrderGuard';

/** How long a refresh gets to merge its layers back before the guard stops watching. */
const GIVE_UP_MS = 15_000;

interface Watch {
  expected: LayerOrderEntry[];
  /** Layers already pending before the refresh; they are not the refresh's to wait for. */
  pendingBefore: number;
  until: number;
}

/**
 * Keeps the layer order a data refresh would otherwise reverse.
 *
 * Returns `capture`, to be called right before the refresh dispatches: it
 * remembers the order, watches the store until kepler has merged the parked
 * layers back, and restores the order if it came back different — see
 * `layerOrderGuard.ts` for why it does. Like every store-driven hook here, the
 * reconcile runs on a microtask so the restore is never dispatched from inside
 * the dispatch that triggered it.
 */
export function useLayerOrderGuard(store: Store): () => void {
  const watch = useRef<Watch | null>(null);
  const unsubscribe = useRef<(() => void) | null>(null);
  const scheduled = useRef(false);

  const stop = useCallback(() => {
    watch.current = null;
    unsubscribe.current?.();
    unsubscribe.current = null;
  }, []);

  const reconcile = useCallback(() => {
    const current = watch.current;
    if (!current) {
      return;
    }
    const state = readLayerOrder(store);
    if (!state || Date.now() > current.until) {
      stop();
      return;
    }
    const action = decideLayerOrderRestore({
      expected: current.expected,
      layerOrder: state.layerOrder,
      pending: Math.max(0, state.pending - current.pendingBefore),
    });
    if (action.kind === 'wait') {
      return;
    }
    stop();
    if (action.kind === 'restore') {
      restoreLayerOrder(store.dispatch, action.order);
    }
  }, [store, stop]);

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
    const state = readLayerOrder(store);
    if (!state) {
      return;
    }
    watch.current = { expected: state.layerOrder, pendingBefore: state.pending, until: Date.now() + GIVE_UP_MS };
    if (!unsubscribe.current) {
      unsubscribe.current = store.subscribe(schedule);
    }
  }, [store, schedule]);
}
