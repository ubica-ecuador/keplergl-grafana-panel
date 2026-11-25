import { useEffect, useRef } from 'react';
import type { Store } from 'redux';

import { pickAsOf } from '../data/timeWindow';
import type { WmsDataset } from '../data/wmsDataset';
import {
  applyWmsLayerChoice,
  applyWmsStyle,
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
import { opensToDomain, type TimeVariableMapping } from './timeVariableSync';
import { readVariableWindow } from './useTimeVariableSync';

interface Params {
  store: Store;
  /** kepler only accepts actions once its instance has registered. */
  isReady: boolean;
  /**
   * The variables the map publishes its window to, or null when it publishes
   * none. Their presence is what tells this timeline to leave the clock alone.
   */
  timeVariables: TimeVariableMapping | null;
  /** The WMS queries, each carrying the dates it offered. */
  layers: WmsDataset[];
  /**
   * Whether the dashboard's range drives the map's time filter. Then the filter
   * is never opened to the layer's dates: the range sync puts the window the
   * dashboard asks for, as for a raster series (`useRasterTimeline`).
   */
  followsDashboard?: boolean;
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
 * And, on the way, the style the query names (`wms_style`) and its legend
 * (`legend_url`), followed on every change: a new picture of the same layer,
 * and what kepler's map legend shows of it (`applyWmsStyle`).
 *
 * Reconciliation runs on a **microtask** rather than inside the subscription:
 * dispatching while kepler is mid-dispatch re-enters its reducer and overflows
 * the stack. Same shape as `useRasterTimeline`, for the same reason.
 */
export function useWmsTimeline({ store, isReady, layers, timeVariables, followsDashboard = false }: Params): void {
  const layersRef = useRef(layers);
  useEffect(() => {
    layersRef.current = layers;
  }, [layers]);

  const followsDashboardRef = useRef(followsDashboard);
  useEffect(() => {
    followsDashboardRef.current = followsDashboard;
  }, [followsDashboard]);

  const timeVariablesRef = useRef(timeVariables);
  useEffect(() => {
    timeVariablesRef.current = timeVariables;
  }, [timeVariables]);

  /**
   * The layer choices already pinned: a dataset and the service layer its query
   * names (`pinKey`).
   *
   * Once per choice: after that the choice is the user's to change from the
   * layer panel — the WMS layer offers exactly that dropdown — and re-imposing
   * it on every store change would undo them mid-click. A query that names
   * another layer is another choice, pinned again: keyed by the dataset alone,
   * the map went on asking for the layer before (DWD's satellite picture) in
   * the style of the new one (AICON's wind), and the service refused it.
   */
  const pinned = useRef(new Set<string>());

  // The filter is opened to its full domain once per set of layers. kepler
  // creates a time filter narrowed to a slice of the domain somewhere in the
  // past, so without this the map would open on an old date while having just
  // drawn the newest one; a query that names another layer brings its own dates.
  const opened = useRef<string | null>(null);

  const reconcile = useRef(() => {
    const wmsLayers = layersRef.current;
    if (wmsLayers.length === 0) {
      return;
    }

    for (const wms of wmsLayers) {
      if (!pinned.current.has(pinKey(wms)) && applyWmsLayerChoice(store, store.dispatch, wms)) {
        pinned.current.add(pinKey(wms));
      }
      applyWmsStyle(store, store.dispatch, wms.id, wms.style, wms.legendUrl);
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

    const calendars = dated.map(calendarKey).join(';');
    // Not when the dashboard's range drives the filter: the window is the range, and opening it to the service's
    // dates drew the newest picture whatever date the dashboard asked for.
    if (followsDashboardRef.current) {
      opened.current = calendars;
    } else if (opensToDomain(opened.current === calendars, readVariableWindow(timeVariablesRef.current))) {
      const domain = readTimeDomain(store);
      // Once the filter holds the dates: kepler rebuilds a calendar's domain after the store change that replaced
      // it, and a window opened on the one before would stay on the dates of the layer before.
      if (domain && dated.every((wms) => covers(domain, wms.times))) {
        pushTimeRange(store, store.dispatch, domain);
        opened.current = calendars;
      }
    }

    const window = readTimeRange(store);
    for (const wms of dated) {
      const moment = pickAsOf(wms.times, (time) => time, window);
      // Nothing as of the window (it lies before every date): hide the layer
      // rather than drop the dataset. It is a passing state — playback starts there
      // on every lap — and rebuilding afterwards would cost a fresh capabilities
      // document and hand back a layer with default styling.
      if (moment === null) {
        setRasterLayerVisible(store, store.dispatch, wms.id, false);
        continue;
      }
      setRasterLayerVisible(store, store.dispatch, wms.id, true);
      // ISO 8601 with Z, which is what a WMS `TIME` is defined in and what
      // GeoServer answers to.
      applyWmsTime(
        store,
        store.dispatch,
        wms.id,
        new Date(moment).toISOString(),
        earlierWithin(wms.times, moment, window)
      );
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

/** A layer choice: the dataset, and the service layer its query names there. */
function pinKey(wms: WmsDataset): string {
  return `${wms.id}|${wms.serviceUrl}|${wms.layerName}`;
}

/**
 * A layer choice and its dates, first, last and how many. The dates change with the layer (the capabilities
 * document is read once per page), so another key is another layer to open the clock on.
 */
function calendarKey(wms: WmsDataset): string {
  return `${pinKey(wms)}|${wms.times.length}|${wms.times[0]}|${wms.times[wms.times.length - 1]}`;
}

/** Whether a time domain holds a calendar's earliest and latest dates (in whatever order they came). */
function covers(domain: { from: number; to: number }, times: number[]): boolean {
  return times.every((time) => time >= domain.from && time <= domain.to);
}

/** How many dates before the moment a refused step asks, at most: each is a request. */
const MAX_EARLIER = 3;

/**
 * The dates before a moment in the window, latest first, at most `MAX_EARLIER`: what the deck layer asks when the
 * service refuses the moment (a dimension that promises more dates than the service holds).
 */
export function earlierWithin(
  times: readonly number[],
  moment: number,
  window: { from: number; to: number } | null
): string[] {
  const from = window?.from ?? -Infinity;
  return times
    .filter((time) => time < moment && time >= from)
    .sort((a, b) => b - a)
    .slice(0, MAX_EARLIER)
    .map((time) => new Date(time).toISOString());
}
