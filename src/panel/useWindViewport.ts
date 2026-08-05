import { useEffect, useRef } from 'react';
import type { Store } from 'redux';

import { PanelDataset, stackExaggeration, traceWind } from '../data/framesToDatasets';

import {
  readAnimationTime,
  readIsAnimating,
  pushAnimationTime,
  readMapState,
  replaceDatasetData,
  resumeAnimation,
} from './keplerAdapter';
import { MapStateLike, sameMapState, viewportFromMapState } from './windViewport';

/**
 * How long the view must hold still before the streamlines are traced again.
 *
 * This is the equivalent of the `stationary` watch in Esri's implementation,
 * which reloads its visualisation whenever the view settles. Tracing during a
 * drag would throw away most of the work — and would fight the gesture, since
 * every frame would replace the lines under the cursor.
 */
const SETTLE_MS = 250;

/**
 * Re-traces the wind streamlines whenever the map settles on a new view.
 *
 * Traced once in geographic space, streamlines drift apart as the user zooms in
 * — a handful of lines across an empty screen — and mat together as they zoom
 * out. Following the viewport keeps the count and the on-screen length steady at
 * every scale, which is what makes the visualisation hold up while navigating.
 *
 * Only the geometry is replaced. The field itself and the animation clock travel
 * on the dataset, so re-tracing neither re-runs the query nor shifts the playhead.
 */
export function useWindViewport(store: Store | null, datasets: PanelDataset[], isReady: boolean): void {
  const datasetsRef = useRef(datasets);
  /** The view the streamlines currently on the map were traced for. */
  const lastTraced = useRef<MapStateLike | null>(null);
  /** The view as of the last store notification, for spotting that it moved. */
  const lastSeen = useRef<MapStateLike | null>(null);

  // Kept in a ref rather than closed over: the subscription is set up once, and
  // a stale closure would keep re-tracing the datasets from the first render.
  useEffect(() => {
    datasetsRef.current = datasets;
    // New query results arrive already traced for whatever view was current, so
    // forget the last view and let the next settle decide.
    lastTraced.current = null;
  }, [datasets]);

  useEffect(() => {
    if (!store || !isReady) {
      return;
    }

    let timer: ReturnType<typeof setTimeout> | null = null;

    const retrace = () => {
      timer = null;

      const mapState = readMapState(store);
      const viewport = viewportFromMapState(mapState);
      if (!viewport || sameMapState(mapState, lastTraced.current)) {
        return;
      }

      const windDatasets = datasetsRef.current.filter((dataset) => dataset.wind);
      if (windDatasets.length === 0) {
        return;
      }

      // The exaggeration follows the view, so it has to be recomputed here as
      // well; reusing the one baked into the first trace would flatten the stack
      // on zooming in and blow it off the screen on zooming out.
      const tallest = Math.max(...windDatasets.map((d) => d.wind!.rawAltitudeMeters));
      const exaggeration = stackExaggeration(tallest, viewport);

      lastTraced.current = mapState;

      // Replacing a dataset stops the playback and resets the playhead, so both
      // are captured first and put back once the swap has landed.
      const wasAnimating = readIsAnimating(store);
      const playhead = readAnimationTime(store);

      // Straight to `replaceDatasetData` rather than through the refresh path:
      // this is a re-trace of the same query's results, not new data arriving.
      for (const dataset of windDatasets) {
        replaceDatasetData(store.dispatch, {
          ...dataset,
          rows: traceWind(
            dataset.wind!.field,
            dataset.wind!.baseMs,
            viewport,
            dataset.wind!.share,
            dataset.wind!.rawAltitudeMeters * exaggeration,
            dataset.wind!.density
          ),
        });
      }

      // Put the clock back. The swap completes through a react-palm task, so the
      // restore waits a tick rather than reading the store straight back.
      if (wasAnimating || playhead !== null) {
        setTimeout(() => {
          if (playhead !== null) {
            pushAnimationTime(store, store.dispatch, playhead);
          }
          if (wasAnimating) {
            resumeAnimation(store, store.dispatch);
          }
        }, 0);
      }
    };

    const onChange = () => {
      // Only a change to the *view* restarts the settle timer.
      //
      // Restarting it on any store notification looks equivalent and is not:
      // while the animation plays, kepler advances the playhead on every frame,
      // so the store changes sixty times a second and a timer that resets on
      // each one never fires. Panning with the animation running would then
      // never re-trace at all.
      const mapState = readMapState(store);
      if (sameMapState(mapState, lastSeen.current)) {
        return;
      }
      lastSeen.current = mapState;

      // The delay is the settle detection proper: it fires once the view has
      // held still for `SETTLE_MS`. It also keeps the dispatch out of the
      // subscription callback, which would otherwise re-enter kepler's reducer.
      if (timer) {
        clearTimeout(timer);
      }
      timer = setTimeout(retrace, SETTLE_MS);
    };

    const unsubscribe = store.subscribe(onChange);
    onChange();

    return () => {
      if (timer) {
        clearTimeout(timer);
      }
      unsubscribe();
    };
  }, [store, isReady]);
}
