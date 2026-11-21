import { useEffect, useRef } from 'react';
import type { Store } from 'redux';

import type { EsriDataset } from '../data/esriDataset';
import type { SavedMapConfig } from '../data/mapConfig';
import type { WmsBox, WmsDataset } from '../data/wmsDataset';
import type { XyzDataset } from '../data/xyzDataset';
import { fitMapToBox, hasLayerOnDataset, type MapBounds, readMapState } from './keplerAdapter';
import { savedViewportOf } from './viewportGuard';
import { type BoxFrame, decideWmsFraming, fitBoundsOfBox, judgedView, unionOfBounds } from './wmsExtent';

/**
 * A layer the map may frame on its box: the dataset it is drawn from, what
 * makes it the same layer across refreshes, and the box its query gave.
 */
export interface BoxedLayer {
  /** The dataset id, as kepler holds it: the decision waits for kepler's layer on it. */
  id: string;
  /** Equal across refreshes of the same layer; a new one is a new layer, framed afresh. */
  identity: string;
  bbox: WmsBox | null;
  /**
   * The first zoom level the layer has tiles at (`tiles_min_zoom`): the frame
   * goes no further out, or the map would ask for no tile of it.
   */
  minZoom?: number;
}

/** A query's WMS layer: the same service and layer is the same layer, whatever its dates. */
export function boxedWms(wms: WmsDataset): BoxedLayer {
  return { id: wms.id, identity: `${wms.serviceUrl}|${wms.layerName}`, bbox: wms.bbox };
}

/** A query's ArcGIS service: the same endpoint is the same layer, whatever year its rule draws. */
export function boxedEsri(esri: EsriDataset): BoxedLayer {
  return { id: esri.id, identity: esri.serviceUrl, bbox: esri.bbox ?? null };
}

/** A query's tiles: the same template is the same layer. */
export function boxedXyz(xyz: XyzDataset): BoxedLayer {
  return {
    id: xyz.id,
    identity: xyz.url,
    bbox: xyz.bbox,
    ...(xyz.minZoom !== undefined ? { minZoom: xyz.minZoom } : {}),
  };
}

interface Params {
  store: Store;
  /** kepler only accepts actions once its instance has registered. */
  isReady: boolean;
  /**
   * The layers a query gave a box to: its WMS layers, its ArcGIS services and
   * its tiles (`boxedWms`, `boxedEsri`, `boxedXyz`).
   */
  layers: BoxedLayer[];
  /** The saved config the map was built from: whether it has a view of its own. */
  mapConfig?: SavedMapConfig | null;
  /** Told what the view was just framed on, so the viewport guard defends it. */
  onFramed: (frame: BoxFrame) => void;
}

/**
 * Frames the map on a query's WMS layer, ArcGIS service or tiles when they
 * arrive where nobody can see them — the rule is `decideWmsFraming`, the same
 * for all three: a service that draws pictures, with no rows for kepler to
 * frame on, and only its box to say where it is.
 *
 * Once per layer: a refresh that brings the same one back, which the
 * dashboard's auto-refresh does every few seconds, is not a new layer, and
 * moving the view for it would fight the user's own panning. A query that
 * starts naming another service or layer is asked again.
 *
 * The decision waits for kepler's own layer on the dataset. For a WMS that
 * exists only once the service's capabilities have answered, and that is not a
 * nicety: a map with no saved view is framed by kepler on its rows when they
 * land; the rows are processed in the page and the capabilities come over the
 * network, so waiting for the layer is what puts this framing after kepler's
 * and keeps it. Tiles have their layer at once, in the same load.
 *
 * Several layers arriving together are framed together, on the union of their
 * boxes, rather than each in turn with the last one winning; and no further
 * out than the highest of their first zoom levels, so none of them is left
 * where it has no tile to ask for (`raisedToMinZoom`).
 *
 * Same structural rule as the sibling hooks: the dispatch happens on a
 * microtask, never inside the store subscription.
 */
export function useBoxFraming({ store, isReady, layers, mapConfig, onFramed }: Params): void {
  const layersRef = useRef(layers);
  const configRef = useRef(mapConfig);
  const onFramedRef = useRef(onFramed);
  // Updated in an effect, not during render: reconcile only runs on a microtask.
  useEffect(() => {
    layersRef.current = layers;
    configRef.current = mapConfig;
    onFramedRef.current = onFramed;
  });

  /** Per dataset id, the identity already decided on. */
  const decided = useRef(new Map<string, string>());

  const reconcile = useRef(() => {
    const saved = savedViewportOf(configRef.current);
    const fits: MapBounds[] = [];
    let minZoom: number | undefined;
    for (const layer of layersRef.current) {
      if (!layer.bbox || decided.current.get(layer.id) === layer.identity || !hasLayerOnDataset(store, layer.id)) {
        continue;
      }
      const decision = decideWmsFraming({
        box: layer.bbox,
        hasSavedView: saved !== null,
        view: judgedView(readMapState(store), saved),
      });
      if (decision === 'wait') {
        continue;
      }
      decided.current.set(layer.id, layer.identity);
      if (decision === 'fit') {
        fits.push(fitBoundsOfBox(layer.bbox));
        if (layer.minZoom !== undefined) {
          minZoom = Math.max(minZoom ?? layer.minZoom, layer.minZoom);
        }
      }
    }
    const bounds = unionOfBounds(fits);
    if (bounds) {
      const frame: BoxFrame = { bounds, ...(minZoom !== undefined ? { minZoom } : {}) };
      fitMapToBox(store, store.dispatch, frame);
      onFramedRef.current(frame);
    }
  });

  const pending = useRef(false);
  const schedule = useRef(() => {
    // Nothing left to decide: a store change costs one comparison per layer.
    const open = layersRef.current.some((layer) => layer.bbox && decided.current.get(layer.id) !== layer.identity);
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
