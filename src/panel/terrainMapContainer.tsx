import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMap } from '@vis.gl/react-maplibre';

import { ANCHORED_TYPES, anchorToTerrain, cachedElevation, centreElevation, type TerrainAnchor } from './terrainAnchor';

type DeckProps = Record<string, unknown>;
type OnDeckRender = (deckProps: DeckProps) => DeckProps | null;

/** The MapLibre map, as far as reading its relief goes. */
export interface ReliefMap {
  getTerrain(): { source?: string } | null | undefined;
  queryTerrainElevation(lngLat: [number, number]): number | null;
  on(type: string, listener: (event: { type: string; sourceId?: string }) => void): unknown;
  off(type: string, listener: (event: { type: string; sourceId?: string }) => void): unknown;
}

/** How long the relief may keep loading before the points are lifted again: one re-read per burst of tiles. */
const SETTLE_MS = 150;

/**
 * Lives inside kepler's bottom map, the one that draws the relief, and reports
 * it: the map once it exists, and a change whenever terrain is set or cleared
 * or more of its elevation tiles arrive.
 */
function ReliefWatch({ onMap, onChange }: { onMap: (map: ReliefMap | null) => void; onChange: () => void }) {
  const map = useMap().current?.getMap() as unknown as ReliefMap | undefined;
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
    map.on('terrain', listener);
    map.on('sourcedata', listener);
    return () => {
      map.off('terrain', listener);
      map.off('sourcedata', listener);
      onMap(null);
    };
  }, [map, onMap, onChange]);
  return null;
}

interface MapContainerProps {
  visState?: { layers?: Array<{ id?: string; type?: string | null }> };
  mapState?: { longitude?: number; latitude?: number; globe?: { enabled?: boolean } };
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
    const wanted = Boolean(keplerLayers?.some((layer) => ANCHORED_TYPES.has(layer.type ?? '')));
    const terrainOn = Boolean(wanted && map?.getTerrain() && !props.mapState?.globe?.enabled);
    // A new lookup, and so a new cache, for each version of the relief: what
    // changes when MapLibre's own answers would.
    const lookup = useMemo(
      () => (map ? { version, elevationAt: cachedElevation((lngLat) => map.queryTerrainElevation(lngLat)) } : null),
      [map, version]
    );

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
      const lifted = anchorToTerrain(layers, keplerLayers ?? [], anchor);
      return lifted === layers ? base : { ...base, layers: lifted };
    };

    const bottom = props.bottomMapContainerProps;
    const bottomMapContainerProps = {
      ...bottom,
      children: (
        <>
          {bottom?.children as React.ReactNode}
          <ReliefWatch onMap={setMap} onChange={onChange} />
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
