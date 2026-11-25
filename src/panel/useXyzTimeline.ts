import { useEffect, useRef } from 'react';
import type { Store } from 'redux';

import { pickAsOf } from '../data/timeWindow';
import type { XyzDataset } from '../data/xyzDataset';
import {
  applyLayerVisConfig,
  ensureTimeFilter,
  pushTimeRange,
  readSyncSlices,
  readTimeDomain,
  readTimeRange,
  setRasterLayerVisible,
} from './keplerAdapter';
import { SliceWatcher } from './sliceWatcher';
import { opensToDomain, type TimeVariableMapping } from './timeVariableSync';
import { readVariableWindow } from './useTimeVariableSync';

interface Params {
  store: Store;
  /** kepler only accepts actions once its instance has registered. */
  isReady: boolean;
  /** The variables the map publishes its window to, or null when it publishes none. */
  timeVariables: TimeVariableMapping | null;
  /** The queries' tiles; those with `scenes` are walked. */
  layers: XyzDataset[];
  /** Whether the dashboard's range drives the map's time filter: then the filter is never opened to the dates. */
  followsDashboard?: boolean;
}

/**
 * Makes the map's time filter choose which date of a query's tiles is drawn, for tiles given a row per date (a
 * WMTS's time dimension, which the Spatial Catalog answers as the template at each date of the range).
 *
 * The tiles of each date are another template, and moving the clock re-points the layer at it (its `xyzUrl`, which
 * `xyzTileLayer` takes over the dataset's): no query and no dataset change, and deck refetches the tiles on screen.
 * The date is chosen as for a raster series: the most recent inside the window, else the most recent before it
 * (`pickAsOf`); a window before every date hides the layer. The rows themselves are the query's dataset, so kepler's
 * time filter already has their time column to hang on.
 *
 * Same structure as `useWmsTimeline`: reconciled on a microtask, never inside the store subscription.
 */
export function useXyzTimeline({ store, isReady, layers, timeVariables, followsDashboard = false }: Params): void {
  const layersRef = useRef(layers);
  const timeVariablesRef = useRef(timeVariables);
  const followsDashboardRef = useRef(followsDashboard);
  useEffect(() => {
    layersRef.current = layers;
    timeVariablesRef.current = timeVariables;
    followsDashboardRef.current = followsDashboard;
  });

  // Opened to the dates once per set of them, for a map the dashboard does not drive (as `useRasterTimeline`).
  const opened = useRef<string | null>(null);

  const reconcile = useRef(() => {
    const dated = layersRef.current.filter((xyz) => (xyz.scenes?.length ?? 0) > 1);
    if (dated.length === 0 || !ensureTimeFilter(store, store.dispatch)) {
      return;
    }
    const calendars = dated.map((xyz) => `${xyz.id}|${xyz.scenes![0].time}|${xyz.scenes!.length}`).join(';');
    if (followsDashboardRef.current) {
      opened.current = calendars;
    } else if (opensToDomain(opened.current === calendars, readVariableWindow(timeVariablesRef.current))) {
      const domain = readTimeDomain(store);
      if (domain) {
        pushTimeRange(store, store.dispatch, domain);
        opened.current = calendars;
      }
    }

    const window = readTimeRange(store);
    for (const xyz of dated) {
      const scene = pickAsOf(xyz.scenes!, (s) => s.time, window);
      if (!scene) {
        setRasterLayerVisible(store, store.dispatch, xyz.id, false);
        continue;
      }
      setRasterLayerVisible(store, store.dispatch, xyz.id, true);
      if (drawnUrl(store, xyz.id) !== scene.url) {
        applyLayerVisConfig(store, store.dispatch, xyz.id, { xyzUrl: scene.url });
      }
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
    return store.subscribe(onStoreChange.current);
  }, [isReady, store, layers]);
}

/** The template the layer on a dataset draws now: its `xyzUrl`, else its dataset's own. */
function drawnUrl(store: Store, dataId: string): string | null {
  const state = store.getState() as {
    keplerGl?: Record<
      string,
      {
        visState?: {
          layers?: Array<{ config?: { dataId?: string; visConfig?: { xyzUrl?: unknown } } }>;
          datasets?: Record<string, { metadata?: { url?: unknown } }>;
        };
      }
    >;
  };
  const visState = Object.values(state.keplerGl ?? {})[0]?.visState;
  const own = visState?.layers?.find((layer) => layer.config?.dataId === dataId)?.config?.visConfig?.xyzUrl;
  const url = typeof own === 'string' && own ? own : visState?.datasets?.[dataId]?.metadata?.url;
  return typeof url === 'string' ? url : null;
}
