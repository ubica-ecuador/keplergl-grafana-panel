import { useEffect, useRef } from 'react';
import type { Store } from 'redux';

import { pickLatestWithin } from '../data/timeWindow';
import type { WmsDataset } from '../data/wmsDataset';
import {
  applyWmsLayerChoice,
  applyWmsTime,
  ensureTimeFilter,
  pushTimeRange,
  readSyncSlices,
  readTimeDomain,
  readTimeRange,
  setRasterLayerVisible,
  syncWmsCalendar,
} from './keplerAdapter';
import { SliceWatcher } from './sliceWatcher';

interface Params {
  store: Store;
  /** kepler only accepts actions once its instance has registered. */
  isReady: boolean;
  /** The WMS queries, each carrying the dates it offered. */
  layers: WmsDataset[];
}

/**
 * Makes the map's time filter choose which moment of a WMS is drawn.
 *
 * A time-aware service — a GeoServer over an ImageMosaic — holds one picture
 * per pass, and asking for a date is a parameter on the request rather than a
 * different url. So walking the timeline costs no query and no dataset change
 * at all: the date lands in the layer's `visConfig`, `wmsTimeLayer` puts it on
 * the next request, and deck refetches one image. A drag that stays between two
 * dates produces nothing.
 *
 * Two jobs, and only the second is about time:
 *
 * 1. **Pin the layer.** kepler's metadata refresh overwrites the single-layer
 *    list the panel supplied with everything the service publishes, and the
 *    layer was built from the first entry of whichever list landed first. Left
 *    alone, a query asking for `persiann_pdir_24h` on GeoGLOWS draws
 *    `imerg_early_run_24h` — a plausible-looking map of the wrong thing. This
 *    runs on every store change until it lands, because the refresh is
 *    asynchronous and the layer may not exist yet.
 * 2. **Follow the clock**, but only for a query that offered dates. A fixed
 *    layer keeps kepler's own behaviour, which is the service's default slice.
 *
 * Reconciliation runs on a **microtask** rather than inside the subscription:
 * dispatching while kepler is mid-dispatch re-enters its reducer and overflows
 * the stack. Same shape as `useRasterTimeline`, for the same reason.
 */
export function useWmsTimeline({ store, isReady, layers }: Params): void {
  const layersRef = useRef(layers);
  useEffect(() => {
    layersRef.current = layers;
  }, [layers]);

  /**
   * Datasets whose layer has been pinned to the right service layer.
   *
   * Once only: after that the choice is the user's to change from the layer
   * panel — the WMS layer offers exactly that dropdown — and re-imposing it on
   * every store change would undo them mid-click.
   */
  const pinned = useRef(new Set<string>());

  // The filter is opened to its full domain once. kepler creates a time filter
  // narrowed to a slice of the domain somewhere in the past, so without this
  // the map would open on an old date while having just drawn the newest one.
  const opened = useRef(false);

  const reconcile = useRef(() => {
    const wmsLayers = layersRef.current;
    if (wmsLayers.length === 0) {
      return;
    }

    for (const wms of wmsLayers) {
      if (!pinned.current.has(wms.id) && applyWmsLayerChoice(store, store.dispatch, wms)) {
        pinned.current.add(wms.id);
      }
    }

    const dated = wmsLayers.filter((wms) => wms.times.length > 0);
    if (dated.length === 0) {
      return;
    }

    // The clock has to exist before it can be read. A query naming only a
    // service brings no time column, so the calendar the service published is
    // put on the map as rows — otherwise kepler has no field to hang a time
    // filter on and the widget never appears at all.
    for (const wms of dated) {
      syncWmsCalendar(store, store.dispatch, wms);
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
    for (const wms of dated) {
      const moment = pickLatestWithin(wms.times, (time) => time, window);
      // Nothing in the window: hide the layer rather than drop the dataset. A
      // window with no date is a passing state — playback crosses one on every
      // lap — and rebuilding afterwards would cost a fresh capabilities
      // document and hand back a layer with default styling.
      if (moment === null) {
        setRasterLayerVisible(store, store.dispatch, wms.id, false);
        continue;
      }
      setRasterLayerVisible(store, store.dispatch, wms.id, true);
      // ISO 8601 with Z, which is what a WMS `TIME` is defined in and what
      // GeoServer answers to.
      applyWmsTime(store, store.dispatch, wms.id, new Date(moment).toISOString());
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
    return unsubscribe;
  }, [isReady, store, layers]);
}
