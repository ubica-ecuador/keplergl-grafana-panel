import { useMemo } from 'react';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { useControl, useMap } from '@vis.gl/react-maplibre';

import type { DraggableMarkersLayer } from './markersDeckLayer';

/** The markers deck layers kepler drew this render; null until its main deck has been handed over. */
export interface MarkersForTopMap {
  layers: DraggableMarkersLayer[] | null;
}

/**
 * Makes `map.transform` readable on a MapLibre 6 map; false when the map has
 * no transform to be found.
 *
 * deck.gl 9.3 draws into a MapLibre map reading `map.transform` — its height,
 * its near and far planes — and MapLibre 6 moved the transform to
 * `map._camera`, so deck throws on every frame of the map. A getter on this one
 * map instance gives the transform back where deck looks for it, and follows
 * the camera when it swaps its transform for another (a change of projection).
 * A map that still has its own is left alone.
 */
export function exposeTransform(map: object): boolean {
  if ('transform' in map) {
    return true;
  }
  const camera = (map as { _camera?: { transform?: unknown } })._camera;
  if (!camera?.transform) {
    return false;
  }
  Object.defineProperty(map, 'transform', { configurable: true, get: () => camera.transform });
  return true;
}

/**
 * Draws the markers inside kepler's top map, after its roads and labels.
 *
 * Rendered as a child of that map, whose MapLibre instance it reaches through
 * `useControl` — the way deck.gl documents adding itself to a react-map-gl map.
 * Interleaved: deck draws into the top map's own WebGL context, in the same
 * frame as its roads, so no third canvas is opened and the copy cannot lag a
 * frame behind the map while it pans.
 *
 * Copies, not the layers kepler drew: a deck layer belongs to one deck. Each
 * copy stays out of the pointer's way, as the top map does; the one below it,
 * in kepler's deck, is the one grabbed. On a map deck cannot draw into, it
 * draws nothing and the markers stay where kepler put them, under the roads.
 */
export function MarkersAboveTopMap({ markers }: { markers: MarkersForTopMap }): null {
  const map = useMap().current?.getMap();
  const drawable = useMemo(() => (map ? exposeTransform(map) : false), [map]);
  const overlay = useControl(() => new MapboxOverlay({ interleaved: true, layers: [] }) as never) as MapboxOverlay;
  const layers = drawable ? (markers.layers ?? []) : [];
  overlay.setProps({ layers: layers.map((layer) => layer.clone({ interactive: false })) });
  return null;
}
