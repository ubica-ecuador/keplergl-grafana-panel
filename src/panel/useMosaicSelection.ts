import { useEffect } from 'react';
import { getPluginImportUtils } from '@grafana/runtime';
import type { Store } from 'redux';

import {
  applyLinkedFilter,
  hasFieldFilter,
  openFieldFilter,
  readDatasetRows,
  readDrawnAreas,
  readFieldType,
  readLinkableFilters,
  readMapState,
  readParkedFilterFields,
  readSyncSlices,
  readViewportBounds,
  removeFieldFilter,
} from './keplerAdapter';
import { MOSAIC_PANEL } from './mosaicLink';
import { MosaicSelectionLink, type MapLike, type MosaicRuntimeLike } from './mosaicSelectionLink';
import { SliceWatcher } from './sliceWatcher';

interface Params {
  store: Store;
  isReady: boolean;
  /** The Selection's name; empty leaves the map out of Mosaic. */
  selection: string;
  /** The longitude and latitude columns the view and the drawn area filter, or null. */
  columns: [string, string] | null;
  /** The view filters the Selection as a bbox. */
  viewport: boolean;
  /** The latest drawn figure filters the Selection. */
  area: boolean;
  /** False when the time filter follows the dashboard time range. */
  linkTime: boolean;
}

let loading: Promise<MosaicRuntimeLike> | undefined;

/**
 * Mosaic, from the Chaski app's Mosaic panel, which hands out the one copy the
 * panels share. Loaded once; again after a failure.
 */
function loadMosaic(): Promise<MosaicRuntimeLike> {
  loading ??= getPluginImportUtils()
    .importPanelPlugin(MOSAIC_PANEL)
    .then((plugin) => {
      const runtime = (plugin as unknown as { mosaicRuntime?: Partial<MosaicRuntimeLike> }).mosaicRuntime;
      if (typeof runtime?.sharedSelection !== 'function') {
        throw new Error(`the ${MOSAIC_PANEL} plugin of this Grafana shares no Selections with other panels`);
      }
      return runtime as MosaicRuntimeLike;
    })
    .catch((error: unknown) => {
      loading = undefined;
      throw error;
    });
  return loading;
}

/**
 * Links the map's filters, and optionally its view, to a Mosaic Selection of
 * the dashboard — see `mosaicLink.ts` for the rules.
 *
 * The store's filters and view are read once per frame at most: kepler
 * updates a range filter on every pointer move of a drag, and one clause per
 * frame is all Mosaic can draw. The Selection's events land on a microtask,
 * outside whatever Mosaic is in the middle of.
 */
export function useMosaicSelection({ store, isReady, selection, columns, viewport, area, linkTime }: Params): void {
  const [lng, lat] = columns ?? ['', ''];

  useEffect(() => {
    const name = selection.trim();
    if (!isReady || !name) {
      return;
    }
    const abort = new AbortController();
    let teardown = () => {};

    const map: MapLike = {
      filters: () => readLinkableFilters(store),
      parked: () => readParkedFilterFields(store),
      fieldType: (field) => readFieldType(store, field),
      hasFilter: (field) => hasFieldFilter(store, field),
      apply: (field, value) => applyLinkedFilter(store, store.dispatch, field, value),
      open: (field) => openFieldFilter(store, store.dispatch, field),
      remove: (field) => removeFieldFilter(store, store.dispatch, field),
      viewport: () => readViewportBounds(store),
      areas: () => readDrawnAreas(store),
      rows: () => readDatasetRows(store),
    };

    const start = async () => {
      const runtime = await loadMosaic();
      const shared = await runtime.sharedSelection(name, abort.signal);
      if (abort.signal.aborted) {
        return;
      }
      const link = new MosaicSelectionLink(runtime, shared, map, {
        linkTime,
        columns: lng && lat ? [lng, lat] : null,
        viewport,
        area,
      });

      const watcher = new SliceWatcher();
      let frame: number | null = null;
      const onStore = () => {
        const slices = lng && lat && viewport ? [...readSyncSlices(store), readMapState(store)] : readSyncSlices(store);
        if (!watcher.changed(slices) || frame !== null) {
          return;
        }
        frame = requestAnimationFrame(() => {
          frame = null;
          link.push();
        });
      };
      let pulling = false;
      const onValue = () => {
        if (pulling) {
          return;
        }
        pulling = true;
        queueMicrotask(() => {
          pulling = false;
          if (!abort.signal.aborted) {
            link.pull();
          }
        });
      };

      // What the others already hold lands first, then the map says what it filters.
      link.pull();
      link.push();
      const unsubscribe = store.subscribe(onStore);
      shared.addEventListener('value', onValue);
      teardown = () => {
        unsubscribe();
        shared.removeEventListener('value', onValue);
        if (frame !== null) {
          cancelAnimationFrame(frame);
        }
        link.release();
      };
    };

    start().catch((error: unknown) => {
      if (!abort.signal.aborted) {
        console.warn(`Kepler: not linked to the Mosaic selection ${name}:`, error);
      }
    });

    return () => {
      abort.abort();
      teardown();
    };
  }, [isReady, selection, lng, lat, viewport, area, linkTime, store]);
}
