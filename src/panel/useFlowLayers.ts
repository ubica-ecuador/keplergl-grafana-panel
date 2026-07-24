import { useEffect, useRef } from 'react';
import type { Store } from 'redux';

import type { PanelDataset } from '../data/framesToDatasets';
import { addFlowLayer, fitMapToBounds, flowLayerStatus } from './keplerAdapter';

interface Params {
  store: Store;
  /** kepler only accepts actions once its instance has registered. */
  isReady: boolean;
  datasets: PanelDataset[];
  /**
   * Whether to auto-add flow layers. Off when a saved map configuration governs
   * the layers — then the user's config is authoritative, including a deliberate
   * absence of the flow layer.
   */
  enabled: boolean;
}

/**
 * Adds a flow layer for each origin-destination dataset.
 *
 * kepler does not auto-detect flow layers, so an OD query would render nothing
 * without this. Like the time filter, the layer can only be added once the
 * dataset has actually landed in the store — kepler ingests data asynchronously
 * — so this reconciles from a store subscription and adds each layer the moment
 * its dataset appears. A per-layer `added` set makes it fire once and survive
 * refreshes; the microtask keeps the dispatch out of kepler's own dispatch.
 */
export function useFlowLayers({ store, isReady, datasets, enabled }: Params): void {
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
      const layer = dataset.flowLayer;
      if (!layer || added.current.has(layer.id)) {
        continue;
      }
      const { datasetLoaded, layerExists } = flowLayerStatus(store, dataset.id, layer.id);
      if (!datasetLoaded) {
        continue; // wait for kepler to finish ingesting the data
      }
      if (!layerExists) {
        // addDataToMap could not frame the map on an OD dataset — there was no
        // flow layer yet to measure — so frame it now on the layer kepler built.
        const bounds = addFlowLayer(store, store.dispatch, layer, dataset.id);
        if (bounds) {
          fitMapToBounds(store.dispatch, bounds);
        }
      }
      added.current.add(layer.id);
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
