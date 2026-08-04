import { useEffect, useRef } from 'react';
import type { Store } from 'redux';

import { PanelDataset, stackExaggeration, traceWind } from '../data/framesToDatasets';

import { readMapState, replaceDatasetData } from './keplerAdapter';
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
  const lastTraced = useRef<MapStateLike | null>(null);

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

      // `replaceDataInMap`, not `refreshDatasets`: `updateVisData` leaves the
      // row count untouched for an id kepler already knows. See the adapter.
      for (const dataset of windDatasets) {
        replaceDatasetData(store.dispatch, {
          ...dataset,
          rows: traceWind(
            dataset.wind!.field,
            dataset.wind!.baseMs,
            viewport,
            dataset.wind!.share,
            dataset.wind!.rawAltitudeMeters * exaggeration
          ),
        });
      }
    };

    const onChange = () => {
      // Restarting the timer on every change is the settle detection: it only
      // fires once the view has been still for `SETTLE_MS`. It also keeps the
      // dispatch out of the subscription callback, which would otherwise
      // re-enter kepler's reducer.
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
