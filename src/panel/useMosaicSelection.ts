import { useEffect } from 'react';
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
import { MosaicSelectionLink, type MapLike, type MosaicRuntimeLike } from './mosaicSelectionLink';
import { SliceWatcher } from './sliceWatcher';
import { type ChaskiLink, useChaskiLink } from './pluginLinks';

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

/**
 * Mosaic as the Chaski app lends it: the copy its Mosaic panels share, so the
 * map's clauses land on the same Selections as theirs.
 */
async function mosaicOf(link: ChaskiLink): Promise<MosaicRuntimeLike> {
  const runtime = (await link.mosaicRuntime()) as Partial<MosaicRuntimeLike> | null | undefined;
  if (typeof runtime?.sharedSelection !== 'function') {
    throw new Error('the Chaski app of this Grafana shares no Selections with other panels');
  }
  return runtime as MosaicRuntimeLike;
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
  const chaskiLink = useChaskiLink();

  useEffect(() => {
    const name = selection.trim();
    if (!isReady || !name || !chaskiLink) {
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
      const runtime = await mosaicOf(chaskiLink);
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

    // A Chaski app that lends no Mosaic, or a Selection it cannot share,
    // leaves the map out of it: the map still draws and filters on its own.
    start().catch(() => undefined);

    return () => {
      abort.abort();
      teardown();
    };
  }, [isReady, selection, lng, lat, viewport, area, linkTime, store, chaskiLink]);
}
