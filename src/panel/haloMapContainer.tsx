import React, { createContext, useContext, useMemo } from 'react';
import { MapContainerFactory } from '@kepler.gl/components';

import { selectionHalo, type HaloRing, type Selection } from './selectionHalo';
import { haloDeckLayers, haloOutlines } from './selectionHaloDeckLayers';
import { haloInputFrom, type VisStateLike } from './selectionHaloInput';

type Factory = typeof MapContainerFactory;

type DeckProps = Record<string, unknown>;
type OnDeckRender = (deckProps: DeckProps) => DeckProps | null;

/**
 * The selection halo's seam into kepler.
 *
 * kepler draws nothing to mark what the dashboard has selected — only the
 * object under the pointer — so the panel adds it. `MapContainer` accepts
 * `deckRenderCallbacks.onDeckRender`, which sees every prop kepler is about to
 * hand DeckGL, layers included, and may return them changed; but `KeplerGl`
 * never passes one to the map (only the image exporter uses it). Hence this
 * wrapper around `MapContainerFactory`, the same way the plugin already wraps
 * the map control and the popup. It dispatches nothing, and nothing it draws
 * enters kepler's layer list or a saved configuration.
 */

/** The dashboard's selection, from `KeplerMap`; null in a panel without click mappings. */
export const HaloContext = createContext<Selection | null>(null);

/** kepler's deck props with the halo drawn last, after any callback already in place. */
export function withHaloLayers(deckProps: DeckProps, halo: unknown[], chained?: OnDeckRender): DeckProps | null {
  const base = chained ? chained(deckProps) : deckProps;
  if (!base || !halo.length) {
    return base;
  }
  return { ...base, layers: [...((base.layers as unknown[] | undefined) ?? []), ...halo] };
}

interface MapContainerProps {
  visState?: VisStateLike;
  mapState?: { zoom?: number; globe?: { enabled?: boolean } };
  /** 0, or 1 on the right of a split map. */
  index?: number;
  deckRenderCallbacks?: { onDeckRender?: OnDeckRender } & Record<string, unknown>;
}

const NO_RINGS: readonly HaloRing[] = [];
const NO_OUTLINES: readonly object[] = [];

/**
 * kepler's `MapContainer`, drawing the selection halo on top of its layers.
 *
 * kepler renders the container again on every hover, every frame of a pan and
 * every tick of an animation, each time with a new vis state object. The halo
 * is worked out again only when what it is made of changes — the selection,
 * the layers, the datasets, the filters, the split, this side; the rings also
 * on a zoom, which sizes them — so deck is handed the same arrays and neither
 * re-reads the rings nor re-parses the shapes on a repaint.
 */
export function withSelectionHalo<P extends MapContainerProps>(MapContainer: React.ComponentType<P>): React.FC<P> {
  const MapContainerWithHalo: React.FC<P> = (props) => {
    const context = useContext(HaloContext);
    const selection = context && Object.keys(context).length && props.visState ? context : null;
    const side = props.index ?? 0;
    const zoom = props.mapState?.zoom ?? 0;

    const { layers, datasets, filters, splitMaps } = props.visState ?? {};
    const visState = useMemo<VisStateLike>(
      () => ({ layers, datasets, filters, splitMaps }),
      [layers, datasets, filters, splitMaps]
    );
    const outlines = useMemo(
      () =>
        selection
          ? // The shapes do not depend on the zoom; only the rings' size does.
            haloOutlines(selectionHalo(haloInputFrom({ visState, zoom: 0, index: side, selection })).shapes)
          : NO_OUTLINES,
      [selection, visState, side]
    );
    const rings = useMemo(
      () => (selection ? selectionHalo(haloInputFrom({ visState, zoom, index: side, selection })).rings : NO_RINGS),
      [selection, visState, side, zoom]
    );

    if (!selection) {
      return <MapContainer {...props} />;
    }

    const halo = haloDeckLayers({ rings, outlines }, side, { globe: Boolean(props.mapState?.globe?.enabled) });
    const chained = props.deckRenderCallbacks?.onDeckRender;
    const deckRenderCallbacks = {
      ...props.deckRenderCallbacks,
      onDeckRender: (deckProps: DeckProps) => withHaloLayers(deckProps, halo, chained),
    };

    return <MapContainer {...props} deckRenderCallbacks={deckRenderCallbacks} />;
  };

  return MapContainerWithHalo;
}

CustomMapContainerFactory.deps = MapContainerFactory.deps;

function CustomMapContainerFactory(...deps: Parameters<Factory>) {
  return withSelectionHalo(
    MapContainerFactory(...deps) as unknown as React.ComponentType<MapContainerProps>
  ) as unknown as ReturnType<Factory>;
}

/** The recipe `injectComponents` expects to swap the stock map container. */
export function replaceMapContainer(): [Factory, Factory] {
  return [MapContainerFactory, CustomMapContainerFactory as unknown as Factory];
}
