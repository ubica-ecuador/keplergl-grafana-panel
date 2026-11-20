import { useEffect, useRef } from 'react';
import type { Store } from 'redux';

import type { SavedMapConfig } from '../data/mapConfig';
import type { WmsDataset } from '../data/wmsDataset';
import { fitMapToBounds, hasLayerOnDataset, type MapBounds, readMapState } from './keplerAdapter';
import { savedViewportOf } from './viewportGuard';
import { decideWmsFraming, fitBoundsOfBox, judgedView, unionOfBounds } from './wmsExtent';

interface Params {
  store: Store;
  /** kepler only accepts actions once its instance has registered. */
  isReady: boolean;
  /** The WMS queries, each with the box its query gave, if any. */
  layers: WmsDataset[];
  /** The saved config the map was built from: whether it has a view of its own. */
  mapConfig?: SavedMapConfig | null;
  /** Told the bounds the view was just framed on, so the viewport guard defends them. */
  onFramed: (bounds: MapBounds) => void;
}

/**
 * Frames the map on a query's WMS layer when it arrives where nobody can see
 * it — the rule is `decideWmsFraming`.
 *
 * Once per service and layer: a refresh that brings the same pair back, which
 * the dashboard's auto-refresh does every few seconds, is not a new layer, and
 * moving the view for it would fight the user's own panning. A query that
 * starts naming another layer is asked again.
 *
 * The decision waits for kepler's own layer on the dataset, which exists only
 * once the service's capabilities have answered. That is not a nicety. A map
 * with no saved view is framed by kepler on its rows when they land; the rows
 * are processed in the page and the capabilities come over the network, so
 * waiting for the layer is what puts this framing after kepler's and keeps it.
 *
 * Several layers arriving together are framed together, on the union of their
 * boxes, rather than each in turn with the last one winning.
 *
 * Same structural rule as the sibling hooks: the dispatch happens on a
 * microtask, never inside the store subscription.
 */
export function useWmsFraming({ store, isReady, layers, mapConfig, onFramed }: Params): void {
  const layersRef = useRef(layers);
  const configRef = useRef(mapConfig);
  const onFramedRef = useRef(onFramed);
  // Updated in an effect, not during render: reconcile only runs on a microtask.
  useEffect(() => {
    layersRef.current = layers;
    configRef.current = mapConfig;
    onFramedRef.current = onFramed;
  });

  /** Per dataset id, the service and layer already decided on. */
  const decided = useRef(new Map<string, string>());

  const reconcile = useRef(() => {
    const saved = savedViewportOf(configRef.current);
    const fits: MapBounds[] = [];
    for (const wms of layersRef.current) {
      const identity = `${wms.serviceUrl}|${wms.layerName}`;
      if (!wms.bbox || decided.current.get(wms.id) === identity || !hasLayerOnDataset(store, wms.id)) {
        continue;
      }
      const decision = decideWmsFraming({
        box: wms.bbox,
        hasSavedView: saved !== null,
        view: judgedView(readMapState(store), saved),
      });
      if (decision === 'wait') {
        continue;
      }
      decided.current.set(wms.id, identity);
      if (decision === 'fit') {
        fits.push(fitBoundsOfBox(wms.bbox));
      }
    }
    const bounds = unionOfBounds(fits);
    if (bounds) {
      fitMapToBounds(store.dispatch, bounds);
      onFramedRef.current(bounds);
    }
  });

  const pending = useRef(false);
  const schedule = useRef(() => {
    // Nothing left to decide: a store change costs one comparison per layer.
    const open = layersRef.current.some(
      (wms) => wms.bbox && decided.current.get(wms.id) !== `${wms.serviceUrl}|${wms.layerName}`
    );
    if (pending.current || !open) {
      return;
    }
    pending.current = true;
    void Promise.resolve().then(() => {
      pending.current = false;
      reconcile.current();
    });
  });

  useEffect(() => {
    if (!isReady) {
      return;
    }
    schedule.current();
    return store.subscribe(schedule.current);
  }, [isReady, store]);

  useEffect(() => {
    if (isReady) {
      schedule.current();
    }
  }, [isReady, layers]);
}
