import { useEffect, useRef } from 'react';
import type { Store } from 'redux';

import { framesToDatasets } from '../data/framesToDatasets';
import type { SavedCatalogLayer } from '../data/mapConfig';
import { notifyMapError, readDatasetIds, readViewportBounds, refreshDatasets } from '../panel/keplerAdapter';
import { followedArea, readParquetLayer } from './catalogSource';

/** How long the view must hold still before the layers follow it. */
const SETTLE_MS = 700;

interface Params {
  store: Store;
  isReady: boolean;
  /** The map's catalog layers (GeoParquet read by area), saved with it. */
  layers: SavedCatalogLayer[];
  /** The saved configuration they came with: a new one is a new map, whose datasets are loaded afresh. */
  generation: unknown;
  /** A layer whose dataset the user removed from the map. */
  onRemoved: (id: string) => void;
  /** The dashboard's time range, which sensors and EDR layers follow. */
  range?: { from: number; to: number };
}

/**
 * Keeps the map's catalog layers loaded over its view: each GeoParquet is read by area through its catalog's data
 * source (only the row groups over the view), and its rows are put into kepler as a dataset (added, or replaced so
 * its layers stay), again when the view moves past the grid it is followed on and holds still.
 *
 * kepler keeps no dataset of rows in a saved map, so the layers are the map's own list (`catalogLayers` in its saved
 * configuration); a layer whose dataset the user removes leaves the list.
 */
export function useCatalogLayers({ store, isReady, layers, generation, onRemoved, range }: Params): void {
  const layersRef = useRef(layers);
  const rangeRef = useRef(range);
  useEffect(() => {
    rangeRef.current = range;
  });
  const onRemovedRef = useRef(onRemoved);
  useEffect(() => {
    layersRef.current = layers;
    onRemovedRef.current = onRemoved;
  });
  // By layer: what was asked last (its area and columns), and whether its dataset has reached the map since.
  const asked = useRef(new Map<string, string>());
  const shown = useRef(new Set<string>());
  // The last failure told for each layer, so a pan that fails the same way says nothing new.
  const told = useRef(new Map<string, string>());
  const schedule = useRef<() => void>(() => undefined);

  useEffect(() => {
    asked.current.clear();
    shown.current.clear();
  }, [generation]);

  useEffect(() => {
    if (!isReady) {
      return;
    }
    let live = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const run = () => {
      timer = null;
      const view = readViewportBounds(store);
      const area = followedArea(view ? [view.west, view.south, view.east, view.north] : null);
      const present = new Set(readDatasetIds(store));
      for (const layer of layersRef.current) {
        const inMap = present.has(layer.id);
        if (shown.current.has(layer.id) && !inMap && asked.current.has(layer.id)) {
          // It reached the map and is gone: the user removed it.
          asked.current.delete(layer.id);
          shown.current.delete(layer.id);
          onRemovedRef.current(layer.id);
          continue;
        }
        const bbox = layer.followView && area ? area : layer.bbox;
        // Sensors and EDR are read in the dashboard's time range, again when it changes.
        const timed = layer.queryType === 'sensors' || layer.queryType === 'edr';
        const when = timed ? rangeRef.current : undefined;
        const key = JSON.stringify([layer.target, bbox, layer.columns, when?.from, when?.to]);
        if (asked.current.get(layer.id) === key && (inMap || !shown.current.has(layer.id))) {
          continue;
        }
        asked.current.set(layer.id, key);
        readParquetLayer(layer, bbox, when)
          .then((frame) => {
            if (!live || !frame || asked.current.get(layer.id) !== key) {
              return;
            }
            const [dataset] = framesToDatasets([{ ...frame, refId: layer.id }]);
            if (dataset) {
              refreshDatasets(store, store.dispatch, [{ ...dataset, id: layer.id, label: layer.label }]);
              shown.current.add(layer.id);
            }
          })
          .catch((err: unknown) => {
            if (asked.current.get(layer.id) === key) {
              asked.current.delete(layer.id);
              // Said once per layer and reason: a pan asks again, and the same refusal need not pile up.
              const message = `${layer.label}: ${String((err as Error)?.message ?? err)}`;
              if (live && told.current.get(layer.id) !== message) {
                told.current.set(layer.id, message);
                notifyMapError(store.dispatch, message);
              }
            }
          });
      }
    };
    schedule.current = () => {
      if (timer !== null) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => live && run(), SETTLE_MS);
    };
    schedule.current();
    // The view's grid cell and the map's datasets are what can call for a read.
    let seen = '';
    const unsubscribe = store.subscribe(() => {
      const view = readViewportBounds(store);
      const now = JSON.stringify([
        followedArea(view ? [view.west, view.south, view.east, view.north] : null),
        readDatasetIds(store).filter((id) => id.startsWith('catalog-')),
      ]);
      if (now !== seen) {
        seen = now;
        schedule.current();
      }
    });
    return () => {
      live = false;
      unsubscribe();
      if (timer !== null) {
        clearTimeout(timer);
      }
    };
  }, [store, isReady]);

  // A layer added (or the list restored) is read at once, and timed ones again for a new time range.
  useEffect(() => {
    schedule.current();
  }, [layers, generation, range?.from, range?.to]);
}
