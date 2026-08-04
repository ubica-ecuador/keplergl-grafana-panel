import { useEffect, useRef } from 'react';
import type { Store } from 'redux';

import type { PanelDataset } from '../data/framesToDatasets';
import { addAutoLayer, autoLayerStatus, fitMapToBounds } from './keplerAdapter';

interface Params {
  store: Store;
  /** kepler only accepts actions once its instance has registered. */
  isReady: boolean;
  datasets: PanelDataset[];
  /**
   * Whether to auto-add layers. Off when a saved map configuration governs the
   * layers — then the user's config is authoritative, including a deliberate
   * absence of the flow or trip layer.
   */
  enabled: boolean;
}

/**
 * Adds the layers kepler does not create by itself: a flow layer for each
 * origin-destination dataset, and a trip layer for each trajectory one.
 *
 * Without this an OD query renders nothing at all, and a trajectory query
 * renders as loose points with no path. Like the time filter, a layer can only
 * be added once its dataset has actually landed in the store — kepler ingests
 * data asynchronously — so this reconciles from a store subscription and adds
 * each layer the moment its dataset appears. A per-layer `added` set makes it
 * fire once and survive refreshes; the microtask keeps the dispatch out of
 * kepler's own dispatch.
 */
export function useAutoLayers({ store, isReady, datasets, enabled }: Params): void {
  const added = useRef(new Set<string>());
  const datasetsRef = useRef(datasets);
  const enabledRef = useRef(enabled);
  // Updated in an effect, not during render: reconcile only runs on a microtask.
  useEffect(() => {
    datasetsRef.current = datasets;
    enabledRef.current = enabled;
  });

  const reconcile = useRef(() => {
    if (!enabledRef.current) {
      return;
    }
    for (const dataset of datasetsRef.current) {
      for (const layer of [dataset.tripLayer, dataset.flowLayer]) {
        if (!layer || added.current.has(layer.id)) {
          continue;
        }
        const { datasetLoaded, layerExists } = autoLayerStatus(store, dataset.id, layer.id);
        if (!datasetLoaded) {
          continue; // wait for kepler to finish ingesting the data
        }
        if (!layerExists) {
          const bounds = addAutoLayer(store, store.dispatch, layer, dataset.id);
          // Only flows need framing afterwards: `addDataToMap` had no flow layer
          // to measure, whereas a trip dataset carries the coordinate columns it
          // already framed the map on.
          if (bounds && layer.type === 'flow') {
            fitMapToBounds(store.dispatch, bounds);
          }
        }
        added.current.add(layer.id);
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

  useEffect(() => {
    if (!isReady || !enabled) {
      return;
    }
    schedule.current();
    return store.subscribe(schedule.current);
  }, [isReady, enabled, store]);

  useEffect(() => {
    if (isReady) {
      schedule.current();
    }
  }, [isReady, datasets]);
}
