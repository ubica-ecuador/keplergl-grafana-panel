import { useEffect, useRef } from 'react';
import type { Store } from 'redux';

import type { PanelDataset } from '../data/framesToDatasets';
import { addAutoLayer, autoLayerStatus, fitMapToBounds } from './keplerAdapter';

interface Params {
  store: Store;
  /** kepler only accepts actions once its instance has registered. */
  isReady: boolean;
  datasets: PanelDataset[];
  /** Called once a layer has been added, so the viewport guard can re-arm. */
  onLayerAdded: () => void;
  /**
   * Whether to auto-add layers. Off when a saved map configuration governs the
   * layers — then the user's config is authoritative, including a deliberate
   * absence of the flow or trip layer.
   */
  enabled: boolean;
}

/**
 * Adds the layers kepler does not create by itself: a flow layer for each
 * origin-destination dataset, a trip layer for each trajectory one, and a flow
 * field for each grid of velocities.
 *
 * Without this an OD query renders nothing at all, a trajectory query renders as
 * loose points with no path, and a velocity grid renders as the lattice of dots
 * it literally is. Like the time filter, a layer can only
 * be added once its dataset has actually landed in the store — kepler ingests
 * data asynchronously — so this reconciles from a store subscription and adds
 * each layer the moment its dataset appears. A per-layer `added` set makes it
 * fire once and survive refreshes; the microtask keeps the dispatch out of
 * kepler's own dispatch.
 */
export function useAutoLayers({ store, isReady, datasets, enabled, onLayerAdded }: Params): void {
  const added = useRef(new Set<string>());
  const datasetsRef = useRef(datasets);
  const enabledRef = useRef(enabled);
  const onAdded = useRef(onLayerAdded);
  // Updated in an effect, not during render: reconcile only runs on a microtask.
  useEffect(() => {
    datasetsRef.current = datasets;
    enabledRef.current = enabled;
    onAdded.current = onLayerAdded;
  });

  const reconcile = useRef(() => {
    if (!enabledRef.current) {
      return;
    }
    for (const dataset of datasetsRef.current) {
      for (const layer of [dataset.tripLayer, dataset.flowLayer, dataset.flowFieldLayer]) {
        if (!layer || added.current.has(layer.id)) {
          continue;
        }
        const { datasetLoaded, layerExists } = autoLayerStatus(store, dataset.id, layer.id);
        if (!datasetLoaded) {
          continue; // wait for kepler to finish ingesting the data
        }
        if (!layerExists) {
          const bounds = addAutoLayer(store, store.dispatch, layer, dataset.id);
          // Flows and flow fields need framing afterwards; a trip dataset does
          // not, carrying the coordinate columns kepler already framed on.
          //
          // `addDataToMap` had no flow layer to measure. It did have a Point
          // layer to measure for a velocity grid — and this layer supersedes
          // it, so whatever framing that produced is being thrown away here
          // anyway. Leaving it to the viewport guard is not enough: the guard
          // watches a six-second window, and a map that loads more slowly than
          // that keeps kepler's default view. Which for a flow field is not a
          // cosmetic difference — the line count follows the share of the
          // screen the data covers, so a field entirely off-screen traces
          // nothing at all, and the map is blank with nothing logged.
          //
          // Safe against a saved viewport because this hook is off entirely
          // when a saved config governs the layers.
          if (bounds && (layer.type === 'flow' || layer.type === 'flowfield')) {
            fitMapToBounds(store.dispatch, bounds);
          }
          // Whatever this layer did to the viewport now needs defending.
          // kepler's internal view state was seeded with its default at mount
          // and writes back on a debounce; a layer added after the data landed
          // is well outside the guard's original window, so the echo lands last
          // and the map returns to San Francisco. Re-arming gives the guard a
          // fresh window over the viewport this addition intended.
          onAdded.current();
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
