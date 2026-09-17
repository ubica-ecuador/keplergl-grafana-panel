import { useEffect } from 'react';
import { locationService } from '@grafana/runtime';
import type { Store } from 'redux';

import { KEPLER_INSTANCE_ID } from './constants';
import { applyLayerVisConfigById, readMapState, readMarkersLayers } from './keplerAdapter';
import { dropWrites, LngLat, moveMarker, reconcileMarkers } from './markers';
import { MARKER_DROP_EVENT, MarkerDropDetail } from './markersDeckLayer';
import { readVariable } from './useVariableSync';

interface Params {
  store: Store;
  /** kepler only accepts actions once its instance has registered. */
  isReady: boolean;
  /** The panel's own element: drops bubble up to it from the map canvas. */
  element: HTMLElement | null;
}

/**
 * Keeps the markers layers and their dashboard variables in step, both ways.
 *
 * - **Drop → variables.** The deck layer announces a drop as a DOM event; this
 *   moves the marker in the layer and writes its pair to the URL, once.
 * - **Variables → markers.** On every location change, and whenever the store
 *   changes (a marker just added or re-bound in the layer panel), each marker
 *   goes to what its pair holds. Never writes a variable, so a dashboard
 *   loading with a shared link keeps the link's positions.
 *
 * Reconciling runs on a microtask, never inside the store subscriber: a kepler
 * dispatch from there re-enters its own reducer.
 */
export function useMarkerSync({ store, isReady, element }: Params): void {
  useEffect(() => {
    if (!isReady) {
      return;
    }

    let queued = false;
    const reconcile = () => {
      queued = false;
      const mapState = readMapState(store);
      const { longitude, latitude } = mapState ?? {};
      const center: LngLat | null =
        Number.isFinite(longitude) && Number.isFinite(latitude) ? [longitude as number, latitude as number] : null;
      for (const layer of readMarkersLayers(store)) {
        const next = reconcileMarkers(layer.markers, readVariable, center);
        if (next) {
          applyLayerVisConfigById(store, store.dispatch, layer.id, { markers: next });
        }
      }
    };
    const schedule = () => {
      if (queued) {
        return;
      }
      queued = true;
      void Promise.resolve().then(() => {
        if (queued) {
          reconcile();
        }
      });
    };

    let lastLayers: unknown = null;
    const onStoreChange = () => {
      // The layer list is replaced whenever any layer changes, and kept as it is
      // while the animation clock ticks — so this skips the frames of playback.
      const state = store.getState() as { keplerGl?: Record<string, { visState?: { layers?: unknown } }> };
      const layers = state.keplerGl?.[KEPLER_INSTANCE_ID]?.visState?.layers;
      if (layers === lastLayers) {
        return;
      }
      lastLayers = layers;
      schedule();
    };

    const unsubscribeStore = store.subscribe(onStoreChange);
    const unlisten = locationService.getHistory().listen(schedule);
    schedule();

    return () => {
      queued = false;
      unsubscribeStore();
      unlisten();
    };
  }, [store, isReady]);

  useEffect(() => {
    if (!isReady || !element) {
      return;
    }

    const onDrop = (event: Event) => {
      const { layerId, markerId, position } = (event as CustomEvent<MarkerDropDetail>).detail;
      const layer = readMarkersLayers(store).find((candidate) => candidate.id === layerId);
      const marker = layer?.markers.find((candidate) => candidate.id === markerId);
      if (!layer || !marker) {
        return;
      }
      const writes = dropWrites(marker, position, readVariable);
      // The layer first, so the reconcile the URL change triggers finds the
      // marker already where the variables are about to say it is.
      applyLayerVisConfigById(store, store.dispatch, layer.id, {
        markers: moveMarker(layer.markers, markerId, position),
      });
      if (Object.keys(writes).length > 0) {
        locationService.partial(writes, true);
      }
    };

    element.addEventListener(MARKER_DROP_EVENT, onDrop);
    return () => element.removeEventListener(MARKER_DROP_EVENT, onDrop);
  }, [store, isReady, element]);
}
