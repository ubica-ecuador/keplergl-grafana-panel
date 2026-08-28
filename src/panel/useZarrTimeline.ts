import { useEffect, useRef } from 'react';
import type { Store } from 'redux';

import { pickLatestWithin } from '../data/timeWindow';
import { labelForTime, type ZarrDataset } from '../data/zarrDataset';
import {
  applyZarrLabel,
  ensureTimeFilter,
  pushTimeRange,
  readSyncSlices,
  readTimeDomain,
  readTimeRange,
  setRasterLayerVisible,
  syncZarrCalendar,
} from './keplerAdapter';
import { makeSettler, SETTLE_MS } from './settle';
import { SliceWatcher } from './sliceWatcher';

interface Params {
  store: Store;
  /** kepler only accepts actions once its instance has registered. */
  isReady: boolean;
  /** The Zarr queries, each carrying the moments it offered. */
  layers: ZarrDataset[];
}

/**
 * Makes the map's time filter choose which slice of a Zarr variable is drawn.
 *
 * A Zarr store holds every moment in one place, so walking the timeline costs
 * no query and no dataset change: the store's own index label lands in the
 * layer's `visConfig`, `zarrTileLayer` puts it in the tile url as TiTiler's
 * `sel`, and deck refetches the tiles on screen. A drag that stays between two
 * dates produces nothing at all.
 *
 * Simpler than `useWmsTimeline` by exactly one job: there is no service layer to
 * pin, because a Zarr dataset is built from the query and no upstream refresh
 * ever rewrites it.
 *
 * Reconciliation runs on a **microtask** rather than inside the subscription:
 * dispatching while kepler is mid-dispatch re-enters its reducer and overflows
 * the stack. Same shape as `useRasterTimeline` and `useWmsTimeline`, and for
 * the same reason.
 */
export function useZarrTimeline({ store, isReady, layers }: Params): void {
  const layersRef = useRef(layers);
  useEffect(() => {
    layersRef.current = layers;
  }, [layers]);

  // The filter is opened to its full domain once. kepler creates a time filter
  // narrowed to a slice somewhere in the past, so without this the map would
  // open on an old date while having just drawn the newest one.
  const opened = useRef(false);

  const reconcile = useRef(() => {
    const dated = layersRef.current.filter((zarr) => zarr.times.length > 0);
    if (dated.length === 0) {
      return;
    }

    // The clock has to exist before it can be read. A query naming only a store
    // and a variable brings no time column, so the moments it offered are put
    // on the map as rows — otherwise kepler has no field to hang a time filter
    // on and the widget never appears at all.
    for (const zarr of dated) {
      syncZarrCalendar(store, store.dispatch, zarr);
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

    const window = readTimeRange(store);
    for (const zarr of dated) {
      const moment = pickLatestWithin(zarr.times, (time) => time, window);
      // Nothing in the window: hide the layer rather than drop the dataset. A
      // window with no date is a passing state — playback crosses one on every
      // lap — and rebuilding afterwards would hand back a layer with default
      // styling, which the user reads as the map resetting itself.
      if (moment === null) {
        setRasterLayerVisible(store, store.dispatch, zarr.id, false);
        continue;
      }

      const label = labelForTime(zarr, moment);
      // A moment with no label is a moment the store cannot be asked about;
      // sending a guess would answer 500 and paint nothing anyway.
      if (!label) {
        setRasterLayerVisible(store, store.dispatch, zarr.id, false);
        continue;
      }

      setRasterLayerVisible(store, store.dispatch, zarr.id, true);
      applyZarrLabel(store, store.dispatch, zarr.id, label);
    }
  });

  // Waits for the window to hold still before acting on it. A drag walks the
  // clock across every bin between where it started and where it ends, and
  // each of those is a scene that would otherwise be fetched in full — see
  // `settle.ts` for the measurements. Also keeps the dispatch off kepler's own
  // stack, which is what the microtask this replaces was for: dispatching
  // while kepler is mid-dispatch re-enters its reducer and overflows.
  const settler = useRef(makeSettler(SETTLE_MS, () => reconcile.current()));
  // Paced only once the map has opened. The opening frames are a conversation —
  // find the filter, widen it to its domain, let the range sync land — and
  // spacing them out reorders it, so the map comes up on the newest scene
  // instead of the one the dashboard's range asked for. Dragging is the burst
  // worth pacing, and it cannot happen before the widget is on screen.
  const schedule = useRef(() =>
    opened.current ? settler.current.schedule() : settler.current.scheduleNow()
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
  useEffect(() => () => settler.current.cancel(), []);

  useEffect(() => {
    if (!isReady) {
      return;
    }
    schedule.current();
    const unsubscribe = store.subscribe(onStoreChange.current);
    return unsubscribe;
  }, [isReady, store, layers]);
}
