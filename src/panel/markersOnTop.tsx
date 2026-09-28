import React from 'react';
import { MAP_LIB_OPTIONS } from '@kepler.gl/constants';
import { getBaseMapLibrary } from '@kepler.gl/utils';

import { MarkersAboveTopMap, type MarkersForTopMap } from './markersAboveTopMap';
import { DraggableMarkersLayer } from './markersDeckLayer';
import { MARKERS_TYPE } from './markersLayer';

type DeckProps = Record<string, unknown>;
type OnDeckRender = (deckProps: DeckProps) => DeckProps | null;

/**
 * Keeps the markers on top of everything else on the map.
 *
 * A marker is a handle, dragged to say where to measure from; buried under the
 * data or the streets it cannot be seen or grabbed. Two things bury it:
 *
 * - **Other kepler layers.** kepler draws them in its layer panel's order. The
 *   markers are moved last in the list kepler hands deck, whatever that order.
 * - **The basemap's top layers.** A basemap can keep its roads and labels above
 *   the data (the layer groups kepler shows as "top"); kepler draws those as a
 *   second MapLibre map above its deck canvas, so they cover every deck layer.
 *   A copy of the markers is drawn inside that top map, after its roads and
 *   labels (`markersAboveTopMap.tsx`). The top map takes no pointer events, so
 *   the copy in kepler's deck, right under it, stays the one grabbed; both
 *   follow a drag through their shared `MarkerDrag`.
 *
 * With a globe, or with no top layers, there is no top map and the first step
 * is all it takes. A Mapbox basemap gets only the first as well: its top map is
 * not a MapLibre map, and the copy is drawn through MapLibre's.
 */

function isMarkers(layer: unknown): layer is DraggableMarkersLayer {
  return layer instanceof DraggableMarkersLayer;
}

/** The deck layers with the markers moved last, each group in its order; the same list when there are none. */
export function liftMarkers(layers: unknown[]): unknown[] {
  const markers = layers.filter(isMarkers);
  if (markers.length === 0) {
    return layers;
  }
  return [...layers.filter((layer) => !isMarkers(layer)), ...markers];
}

interface MapContainerProps {
  visState?: { layers?: Array<{ type?: string | null }> };
  mapStyle?: { styleType?: string; mapStyles?: Record<string, { url?: string | null; style?: unknown }> };
  deckRenderCallbacks?: { onDeckRender?: OnDeckRender } & Record<string, unknown>;
  topMapContainerProps?: Record<string, unknown>;
}

/** kepler's `MapContainer`, keeping the markers on top of its layers and of its top map. */
export function withMarkersOnTop<P extends MapContainerProps>(MapContainer: React.ComponentType<P>): React.FC<P> {
  const MapContainerWithMarkersOnTop: React.FC<P> = (props) => {
    if (!props.visState?.layers?.some((layer) => layer.type === MARKERS_TYPE)) {
      return <MapContainer {...props} />;
    }

    // Filled while kepler renders, read by the top map's child after it: kepler
    // builds its deck — calling `onDeckRender` — before it creates the top map,
    // and React renders the top map's children only once kepler has returned.
    const forTopMap: MarkersForTopMap = { layers: null };
    const chained = props.deckRenderCallbacks?.onDeckRender;
    const onDeckRender = (deckProps: DeckProps) => {
      const base = chained ? chained(deckProps) : deckProps;
      const layers = base ? liftMarkers((base.layers as unknown[] | undefined) ?? []) : [];
      // The first call is the main deck's. kepler calls again for the overlay it
      // draws the geocoder's pin in, which holds nothing of ours.
      if (forTopMap.layers === null) {
        forTopMap.layers = layers.filter(isMarkers);
      }
      return base && layers !== base.layers ? { ...base, layers } : base;
    };

    const style = props.mapStyle?.mapStyles?.[props.mapStyle?.styleType ?? ''];
    const topMapContainerProps =
      getBaseMapLibrary(style ?? undefined) === MAP_LIB_OPTIONS.MAPLIBRE
        ? { ...props.topMapContainerProps, children: <MarkersAboveTopMap markers={forTopMap} /> }
        : props.topMapContainerProps;

    return (
      <MapContainer
        {...props}
        deckRenderCallbacks={{ ...props.deckRenderCallbacks, onDeckRender }}
        topMapContainerProps={topMapContainerProps}
      />
    );
  };

  return MapContainerWithMarkersOnTop;
}
