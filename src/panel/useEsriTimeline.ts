import { useEffect, useRef } from 'react';
import type { Store } from 'redux';

import { mosaicRuleForTime, type EsriDataset } from '../data/esriDataset';
import { pickLatestWithin } from '../data/timeWindow';
import {
  applyEsriMosaicRule,
  ensureTimeFilter,
  isTimeFilterAnimating,
  pushTimeRange,
  readSyncSlices,
  readTimeDomain,
  readTimeRange,
  setRasterLayerVisible,
} from './keplerAdapter';
import { makeSettler, pacingFor, SETTLE_MS } from './settle';
import { SliceWatcher } from './sliceWatcher';

interface Params {
  store: Store;
  /** kepler only accepts actions once its instance has registered. */
  isReady: boolean;
  /** The Image Service queries, each carrying the moments it offered. */
  layers: EsriDataset[];
}

/**
 * Makes the map's time filter choose which slice of a mosaic is drawn.
 *
 * A service holds every year behind one endpoint, so walking the timeline costs
 * no query and no dataset change: the moment's own mosaic rule lands in the
 * layer's `visConfig`, `esriImageLayer` puts it in the render request, and deck
 * refetches the tiles on screen. A drag that stays between two moments produces
 * nothing at all.
 *
 * Simpler than `useZarrTimeline` by one job, and the reason is worth stating: a
 * Zarr query names a store rather than a calendar, so the moments have to be
 * put on the map as rows before kepler has a field to hang a time filter on.
 * A dated Image Service query already *is* rows — one per year, each with the
 * rule that draws it — so the clock has something to read the moment it loads.
 *
 * Reconciliation runs on a **microtask** rather than inside the subscription:
 * dispatching while kepler is mid-dispatch re-enters its reducer and overflows
 * the stack. Same shape as the raster, WMS and Zarr timelines, for the same
 * reason.
 */
export function useEsriTimeline({ store, isReady, layers }: Params): void {
  const layersRef = useRef(layers);
  useEffect(() => {
    layersRef.current = layers;
  }, [layers]);

  // The filter is opened to its full domain once. kepler creates a time filter
  // narrowed to a slice somewhere in the past, so without this the map would
  // open on an old year while having just drawn the newest one, and the change
  // would read as a glitch rather than as a choice.
  const opened = useRef(false);

  const reconcile = useRef(() => {
    const dated = layersRef.current.filter((service) => (service.moments?.length ?? 0) > 0);
    if (dated.length === 0) {
      return;
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
    for (const service of dated) {
      const moment = pickLatestWithin(service.moments ?? [], (one) => one.time, window);
      // Nothing in the window: hide the layer rather than drop the dataset. A
      // window with no moment is a passing state — playback crosses one on
      // every lap — and rebuilding afterwards would hand back a layer with
      // default styling, which reads as the map resetting itself.
      if (moment === null) {
        setRasterLayerVisible(store, store.dispatch, service.id, false);
        continue;
      }

      const rule = mosaicRuleForTime(service, moment.time);
      // A moment with no rule is one the service was never told how to draw.
      if (!rule) {
        setRasterLayerVisible(store, store.dispatch, service.id, false);
        continue;
      }

      setRasterLayerVisible(store, store.dispatch, service.id, true);
      applyEsriMosaicRule(store, store.dispatch, service.id, rule);
    }
  });

  // Built on first use rather than during render. `makeSettler` is an ordinary
  // function call, and handing it a closure over `reconcile` at render time is
  // what `react-hooks/refs` flags: it cannot see that the job is only ever run
  // from a timeout. Constructed once and kept, so the cooldown a drag is
  // building up survives the re-renders Grafana's deep clone of the panel data
  // causes.
  const settlerRef = useRef<ReturnType<typeof makeSettler> | null>(null);
  const settler = useRef(() => {
    if (settlerRef.current === null) {
      settlerRef.current = makeSettler(SETTLE_MS, () => reconcile.current());
    }
    return settlerRef.current;
  });
  // Paced only once the map has opened. The opening frames are a conversation —
  // find the filter, widen it to its domain, let the range sync land — and
  // spacing them out reorders it, so the map comes up on the newest scene
  // instead of the one the dashboard's range asked for. Dragging is the burst
  // worth pacing, and it cannot happen before the widget is on screen.
  // Playback is the exception: pacing it swallows the animation whole, and it
  // costs nothing to let through because the reconcile above dispatches only
  // when the scene actually changes. See `pacingFor`.
  const schedule = useRef(() =>
    pacingFor({ opened: opened.current, animating: isTimeFilterAnimating(store) }) === 'paced'
      ? settler.current().schedule()
      : settler.current().scheduleNow()
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
  useEffect(() => () => settlerRef.current?.cancel(), []);

  useEffect(() => {
    if (!isReady) {
      return;
    }
    schedule.current();
    const unsubscribe = store.subscribe(onStoreChange.current);
    return unsubscribe;
  }, [isReady, store, layers]);
}
