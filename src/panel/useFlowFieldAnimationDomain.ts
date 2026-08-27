import { useEffect, useRef } from 'react';
import type { Store } from 'redux';

import { readFlowFieldLayers, republishAnimationDomain } from './keplerAdapter';

interface Params {
  store: Store | null;
  /** kepler only accepts actions once its instance has registered. */
  isReady: boolean;
}

/**
 * Puts the flow fields' animation windows on the map's clock.
 *
 * kepler republishes the animation domain when a layer's columns or visibility
 * change, and at no other time. Everything that moves a flow field's window
 * travels through `visConfig` instead — the dashboard range it starts from, the
 * length of the cycle — so without this the clock at the bottom of the map shows
 * a window the lines were never traced in, and on first load it does not appear
 * at all: an animatable layer is only animatable once it has a domain, and the
 * layer has none until it has traced.
 *
 * The nudge fires on the *layers'* own windows changing, not on a disagreement
 * with `animationConfig`. Those two are legitimately different whenever another
 * animatable layer is on the map — kepler merges every window into one — and a
 * hook chasing that difference would dispatch for ever.
 */
export function useFlowFieldAnimationDomain({ store, isReady }: Params): void {
  const published = useRef<string | null>(null);

  useEffect(() => {
    if (!store || !isReady) {
      return;
    }

    published.current = null;
    let queued = false;

    const onChange = () => {
      const layers = readFlowFieldLayers(store).filter((layer) => layer.domain);
      const windows = layers.map((layer) => `${layer.id}:${layer.domain}`).join('|');
      if (windows === published.current || queued) {
        return;
      }

      published.current = windows;
      if (layers.length === 0) {
        return;
      }

      queued = true;
      // A microtask, not a straight call: dispatching from inside a subscriber
      // re-enters kepler's own reducer.
      void Promise.resolve().then(() => {
        queued = false;
        // One layer is enough — kepler merges every animatable window in the
        // same pass — but they are all asserted so that a layer added while
        // another was already animating is not skipped.
        for (const layer of layers) {
          republishAnimationDomain(store, store.dispatch, layer.id);
        }
      });
    };

    const unsubscribe = store.subscribe(onChange);
    onChange();

    return () => {
      queued = false;
      unsubscribe();
    };
  }, [store, isReady]);
}
