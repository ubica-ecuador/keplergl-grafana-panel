import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMap } from '@vis.gl/react-maplibre';
import { MapView } from '@deck.gl/core';

import { drapeSampler } from './reliefDrape';
import { type NativeRaster, nativeKey, type RasterMap, splitNativeRasters, syncNativeRasters } from './reliefRasters';
import {
  ANCHORED_TYPES,
  anchorToTerrain,
  DRAPED_TYPES,
  cachedElevation,
  centreElevation,
  type TerrainAnchor,
} from './terrainAnchor';

type DeckProps = Record<string, unknown>;
type OnDeckRender = (deckProps: DeckProps) => DeckProps | null;

/** The MapLibre map, as far as reading its relief goes. */
export interface ReliefMap {
  getTerrain(): { source?: string } | null | undefined;
  queryTerrainElevation(lngLat: [number, number]): number | null;
  on(type: string, listener: (event: { type: string; sourceId?: string }) => void): unknown;
  off(type: string, listener: (event: { type: string; sourceId?: string }) => void): unknown;
}

/**
 * deck's far plane on a relief basemap. kepler sets a multiplier of 1.2: the plane sits just past the furthest point
 * of z = 0 in view, and everything lowered below it — the ground of a valley under a summit at the centre, a raster
 * lying on it — is cut off: from straight above, a whole raster vanished. A surface `below` metres under the plane
 * of the centre needs the far plane `1 + below / (D cos pitch)` times further (math.gl's `getProjectionParameters`,
 * D the camera's distance to the centre, 1.5 viewport heights). deck caps it at ten times D whatever the multiplier.
 */
export function farZMultiplierFor(
  below: number,
  mapState: { zoom?: number; latitude?: number; pitch?: number; height?: number } | undefined
): number | null {
  const { zoom, latitude, pitch = 0, height } = mapState ?? {};
  if (!(below > 0) || typeof zoom !== 'number' || typeof latitude !== 'number' || !(Number(height) > 0)) {
    return null;
  }
  const pixelsPerMetre = (512 * 2 ** zoom) / (40075016.686 * Math.cos((latitude * Math.PI) / 180));
  const belowInHeights = (below * pixelsPerMetre) / Number(height);
  const cosPitch = Math.max(0.01, Math.cos((pitch * Math.PI) / 180));
  // kepler's 1.2 kept as the margin; quarter steps, so a pan changes the view only now and then.
  return Math.min(10, Math.ceil(1.2 * (1 + belowInHeights / (1.5 * cosPitch)) * 4) / 4);
}

/** kepler's flat-map view with the far plane pushed back to `farZMultiplier`; anything else as it is. */
function viewsForRelief(views: unknown, farZMultiplier: number | null): unknown {
  if (!farZMultiplier || !(views instanceof MapView)) {
    return views;
  }
  const props = (views as unknown as { props: Record<string, unknown> }).props;
  if (Number(props.farZMultiplier) >= farZMultiplier) {
    return views;
  }
  return new MapView({ ...props, farZMultiplier } as never);
}

/** How long the relief may keep loading before the points are lifted again: one re-read per burst of tiles. */
const SETTLE_MS = 150;

/**
 * Lives inside kepler's bottom map, the one that draws the relief, and reports
 * it: the map once it exists, and a change whenever terrain is set or cleared
 * or more of its elevation tiles arrive. It also keeps the rasters handed to
 * MapLibre (`reliefRasters.ts`) in its style: a new base map style drops them,
 * and a style that was still loading refused them.
 */
function ReliefWatch({
  onMap,
  onChange,
  natives,
}: {
  onMap: (map: ReliefMap | null) => void;
  onChange: () => void;
  natives: { current: NativeRaster[] };
}) {
  const map = useMap().current?.getMap() as unknown as (ReliefMap & RasterMap) | undefined;
  useEffect(() => {
    if (!map) {
      return;
    }
    onMap(map);
    const listener = (event: { type: string; sourceId?: string }) => {
      const source = map.getTerrain()?.source;
      if (event.type === 'terrain' || (source && event.sourceId === source)) {
        onChange();
      }
    };
    const restyled = () => {
      syncNativeRasters(map, natives.current);
    };
    map.on('terrain', listener);
    map.on('sourcedata', listener);
    map.on('styledata', restyled);
    return () => {
      map.off('terrain', listener);
      map.off('sourcedata', listener);
      map.off('styledata', restyled);
      syncNativeRasters(map, []);
      onMap(null);
    };
  }, [map, onMap, onChange, natives]);
  return null;
}

interface MapContainerProps {
  visState?: { layers?: Array<{ id?: string; type?: string | null }> };
  mapState?: {
    longitude?: number;
    latitude?: number;
    zoom?: number;
    pitch?: number;
    height?: number;
    globe?: { enabled?: boolean };
  };
  deckRenderCallbacks?: { onDeckRender?: OnDeckRender } & Record<string, unknown>;
  bottomMapContainerProps?: Record<string, unknown>;
}

/**
 * kepler's `MapContainer`, with the markers and the symbols standing on the
 * basemap's relief (`terrainAnchor.ts`). A map with neither layer renders as
 * kepler's; so does a flat basemap, once the map has said it has no terrain.
 */
export function withTerrainAnchor<P extends MapContainerProps>(MapContainer: React.ComponentType<P>): React.FC<P> {
  const MapContainerOnRelief: React.FC<P> = (props) => {
    const [map, setMap] = useState<ReliefMap | null>(null);
    const [version, setVersion] = useState(0);
    const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
    // The ground the rasters' grids have met on this map, one object for its life, filled in by the grids.
    const [range] = useState(() => ({ low: Infinity, high: -Infinity }));
    // The rasters MapLibre draws for deck on the relief, as last handed over, and their key.
    const natives = useRef<NativeRaster[]>([]);
    const nativesKey = useRef(nativeKey([]));
    const onChange = useCallback(() => {
      if (pending.current === null) {
        pending.current = setTimeout(() => {
          pending.current = null;
          setVersion((v) => v + 1);
        }, SETTLE_MS);
      }
    }, []);
    useEffect(
      () => () => {
        if (pending.current !== null) {
          clearTimeout(pending.current);
        }
      },
      []
    );

    const keplerLayers = props.visState?.layers;
    const wanted = Boolean(
      keplerLayers?.some((layer) => ANCHORED_TYPES.has(layer.type ?? '') || DRAPED_TYPES.has(layer.type ?? ''))
    );
    const terrainOn = Boolean(wanted && map?.getTerrain() && !props.mapState?.globe?.enabled);
    // A new lookup, and so a new cache, for each version of the relief: what
    // changes when MapLibre's own answers would.
    const lookup = useMemo(() => {
      if (!map) {
        return null;
      }
      const elevationAt = cachedElevation((lngLat) => map.queryTerrainElevation(lngLat));
      return { version, elevationAt, drapeAt: drapeSampler(map as never, elevationAt), range };
    }, [map, version, range]);

    if (!wanted) {
      return <MapContainer {...props} />;
    }

    // Read at kepler's centre, which is the one deck draws this frame with;
    // MapLibre's own catches up only once kepler has handed it the new view.
    const anchor: TerrainAnchor | null =
      terrainOn && map && lookup
        ? {
            ...lookup,
            centre: centreElevation(
              (lngLat) => map.queryTerrainElevation(lngLat),
              props.mapState?.longitude,
              props.mapState?.latitude
            ),
          }
        : null;

    const chained = props.deckRenderCallbacks?.onDeckRender;
    const onDeckRender = (deckProps: DeckProps) => {
      const base = chained ? chained(deckProps) : deckProps;
      if (!base) {
        return base;
      }
      const layers = (base.layers as unknown[] | undefined) ?? [];
      // On the relief the tile templates go to MapLibre, which lays them on its own terrain.
      const { kept, native } = anchor ? splitNativeRasters(layers) : { kept: layers, native: [] };
      const key = nativeKey(native);
      if (key !== nativesKey.current) {
        nativesKey.current = key;
        natives.current = native;
        // Not while kepler renders: MapLibre's style changes fire events back into React.
        queueMicrotask(() => {
          if (map && natives.current === native) {
            syncNativeRasters(map as unknown as RasterMap, native);
          }
        });
      }
      const lifted = anchorToTerrain(kept, keplerLayers ?? [], anchor);
      const below = anchor && Number.isFinite(range.low) ? anchor.centre - range.low : 0;
      const views = anchor ? viewsForRelief(base.views, farZMultiplierFor(below, props.mapState)) : base.views;
      return lifted === layers && views === base.views ? base : { ...base, layers: lifted, views };
    };

    const bottom = props.bottomMapContainerProps;
    const bottomMapContainerProps = {
      ...bottom,
      children: (
        <>
          {bottom?.children as React.ReactNode}
          <ReliefWatch onMap={setMap} onChange={onChange} natives={natives} />
        </>
      ),
    };

    return (
      <MapContainer
        {...props}
        deckRenderCallbacks={{ ...props.deckRenderCallbacks, onDeckRender }}
        bottomMapContainerProps={bottomMapContainerProps}
      />
    );
  };

  return MapContainerOnRelief;
}
