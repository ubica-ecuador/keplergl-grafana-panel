import React, { useCallback } from 'react';
import { getBaseMapAttributions } from '@kepler.gl/utils';

/**
 * Every source's credit in the base map's attribution, not just the first ones.
 *
 * kepler collects the attributions of a non-Mapbox style from its sources
 * (`MapContainer._collectBasemapAttributions`), and stops at the first
 * `sourcedata` event that yields any. A source with its tiles in the style has
 * its attribution at once; one with a TileJSON `url` has it only once that
 * document is in. So a style with both showed the first kind alone: Open
 * Waters' Seamap credited OpenStreetMap, from VersaTiles' source, and never
 * "© Open Waters", which its CC BY licence asks for and which comes in its
 * TileJSON a moment later.
 *
 * The panel gives kepler's map container a collector that keeps going: it
 * collects again on each source's metadata or load and once more when the map
 * is idle, when MapLibre has every source in (`map.loaded()` waits for each
 * TileJSON), and stops there. It replaces kepler's method on the instance, read
 * through a ref, since `MapContainerFactory` hands out kepler's class wrapped
 * in `withTheme`, which forwards the ref. kepler calls the method from its own
 * `style.load` handler, so every base map the map switches to goes through it.
 * Should kepler drop or rename the method, the instance is left as it is.
 */

interface SourceDataEvent {
  isSourceLoaded?: boolean;
  sourceDataType?: string;
}

/** The part of a MapLibre map the collector uses, and `getBaseMapAttributions` reads. */
export interface AttributionMap {
  on(type: string, listener: (event?: SourceDataEvent) => void): unknown;
  off(type: string, listener: (event?: SourceDataEvent) => void): unknown;
}

/** The part of kepler's `MapContainer` instance the collector reads and replaces. */
export interface AttributionHost {
  _map?: AttributionMap | null;
  _collectBasemapAttributions?: () => void;
  _removeBasemapAttributionListeners?: () => void;
  _basemapSourceDataListener?: ((event?: SourceDataEvent) => void) | null;
  _basemapIdleListener?: (() => void) | null;
  state?: { basemapAttributions?: string[] } | null;
  setState?: (update: { basemapAttributions: string[] }) => void;
}

const PATCHED = Symbol('everyBasemapAttribution');

const sameList = (a: readonly string[], b: readonly string[] | undefined) =>
  Boolean(b) && a.length === b!.length && a.every((value, i) => value === b![i]);

/**
 * Replaces `host`'s collector with one that collects every source's credit.
 * Does nothing to a host without kepler's methods, or one already given it.
 *
 * @param collect what reads the credits off the map; kepler's own by default
 */
export function collectEveryBasemapAttribution(
  host: AttributionHost,
  collect: (map: AttributionMap) => string[] = (map) => getBaseMapAttributions(map as never)
): void {
  const patched = host as AttributionHost & { [PATCHED]?: boolean };
  if (
    patched[PATCHED] ||
    typeof host._collectBasemapAttributions !== 'function' ||
    typeof host._removeBasemapAttributionListeners !== 'function' ||
    typeof host.setState !== 'function'
  ) {
    return;
  }
  patched[PATCHED] = true;
  const removeListeners = host._removeBasemapAttributionListeners;

  host._collectBasemapAttributions = () => {
    const map = host._map;
    if (!map) {
      return;
    }
    removeListeners();
    const update = () => {
      const found = collect(map);
      // Never empties the list: kepler may have put OpenStreetMap's credit there
      // for a style drawn from its tiles before any source had one.
      if (found.length && !sameList(found, host.state?.basemapAttributions)) {
        host.setState!({ basemapAttributions: found });
      }
    };
    const onSourceData = (event?: SourceDataEvent) => {
      if (event?.isSourceLoaded || event?.sourceDataType === 'metadata') {
        update();
      }
    };
    const onIdle = () => {
      removeListeners();
      update();
    };
    host._basemapSourceDataListener = onSourceData;
    host._basemapIdleListener = onIdle;
    map.on('sourcedata', onSourceData);
    map.on('idle', onIdle);
  };
}

/** kepler's `MapContainer`, its base map credited by every source. */
export function withEveryBasemapAttribution<P extends object>(MapContainer: React.ComponentType<P>): React.FC<P> {
  const Container = MapContainer as unknown as React.ComponentType<P & { ref?: React.Ref<unknown> }>;
  const EveryBasemapAttribution: React.FC<P> = (props) => {
    const ref = useCallback((instance: unknown) => {
      if (instance) {
        collectEveryBasemapAttribution(instance as AttributionHost);
      }
    }, []);
    return <Container {...props} ref={ref} />;
  };
  return EveryBasemapAttribution;
}
