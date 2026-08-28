import { useEffect, useRef } from 'react';
import type { Store } from 'redux';

import { applyLayerVisConfigById, readFlowFieldLayers, readMapState } from './keplerAdapter';
import { outdatedFlowContexts } from './flowFieldContext';
import { cameraFromMapState, MapStateLike, sameCamera } from './windViewport';

/**
 * How long the view must hold still before the streamlines are traced again.
 *
 * This is the equivalent of the `stationary` watch in Esri's implementation,
 * which reloads its visualisation whenever the view settles. Tracing during a
 * drag would throw away most of the work — and would fight the gesture, since
 * every frame would replace the lines under the cursor.
 */
const SETTLE_MS = 250;

interface Params {
  store: Store | null;
  /** kepler only accepts actions once its instance has registered. */
  isReady: boolean;
  /**
   * Epoch ms the streamline animation starts from — the dashboard range's start.
   *
   * Started at "now" instead, the animation runs into the future, and the
   * default time sync — which pushes the dashboard range onto the map as a
   * filter — hides the whole layer.
   */
  baseMs: number;
}

/**
 * Tells the flow field layers what the map is showing, whenever that changes.
 *
 * Traced once in geographic space, streamlines drift apart as the user zooms in
 * — a handful of lines across an empty screen — and mat together as they zoom
 * out. Following the viewport keeps the count and the on-screen length steady at
 * every scale, which is what makes the visualisation hold up while navigating.
 *
 * What travels is the *context*, not the geometry: a viewport, a clock and the
 * height of the tallest level. The layer does the tracing, off the back of a
 * `visConfig` change. That is the whole reason this is a few numbers rather than
 * a dataset swap — replacing a dataset stops the playback and resets the
 * playhead, and the previous version of this hook had to capture and restore
 * both on every pan.
 */
export function useFlowFieldContext({ store, isReady, baseMs }: Params): void {
  const baseRef = useRef(baseMs);
  const publishRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    baseRef.current = baseMs;
  });

  useEffect(() => {
    if (!store || !isReady) {
      return;
    }

    let timer: ReturnType<typeof setTimeout> | null = null;
    let queued = false;
    /** The view as of the last store notification, for spotting that it moved. */
    let lastSeen: MapStateLike | null = null;

    const pending = () =>
      outdatedFlowContexts(readFlowFieldLayers(store), cameraFromMapState(readMapState(store)), baseRef.current);

    const publish = () => {
      timer = null;
      queued = false;
      for (const patch of pending()) {
        applyLayerVisConfigById(store, store.dispatch, patch.id, { flowContext: patch.context });
      }
    };
    publishRef.current = publish;

    const onChange = () => {
      const mapState = readMapState(store);

      // Only a change to the *camera* restarts the settle timer — tilt and
      // rotation included, since both change which ground is on screen.
      //
      // Restarting it on any store notification looks equivalent and is not:
      // while the animation plays, kepler advances the playhead on every frame,
      // so the store changes sixty times a second and a timer that resets on
      // each one never fires. Panning with the animation running would then
      // never re-trace at all.
      if (!sameCamera(mapState, lastSeen)) {
        lastSeen = mapState;
        if (timer) {
          clearTimeout(timer);
        }
        timer = setTimeout(publish, SETTLE_MS);
        return;
      }

      // A layer that has only just appeared should not have to wait for the
      // view to move before it is told where the view is.
      if (timer || queued || pending().length === 0) {
        return;
      }
      queued = true;
      // The microtask is not cosmetic: dispatching from inside a subscriber
      // re-enters kepler's own reducer.
      void Promise.resolve().then(() => {
        if (queued) {
          publish();
        }
      });
    };

    const unsubscribe = store.subscribe(onChange);
    onChange();

    return () => {
      if (timer) {
        clearTimeout(timer);
      }
      queued = false;
      publishRef.current = () => undefined;
      unsubscribe();
    };
  }, [store, isReady]);

  // A new dashboard range moves the clock the streamlines run on, and nothing
  // in the map's own state changes to announce it.
  useEffect(() => {
    if (!store || !isReady) {
      return;
    }
    const publish = publishRef.current;
    void Promise.resolve().then(publish);
  }, [store, isReady, baseMs]);
}
