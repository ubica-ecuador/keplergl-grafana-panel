import { useEffect, useState } from 'react';
import type { DataFrame } from '@grafana/data';

import { detectFields, type FieldRoleOverrides, resolveRoles } from '../data/detectFields';
import { GAZETTEERS, type Gazetteer, parseGazetteer, placedByName } from '../data/placeLookup';
import { resolveRemoteSource } from '../data/remoteSource';

/**
 * The gazetteer a panel's place names are looked up in, fetched once a query
 * needs it and shared by every panel that names the same file.
 *
 * Fetched only when a query places its rows by name: most maps never ask, and
 * Grafana's countries file is not small. Relative paths resolve against
 * Grafana's root, as Geomap's do. A file that fails to load leaves the rows
 * unplaced and says why in the console, which is what Geomap does too.
 */

const cache = new Map<string, Promise<Gazetteer>>();

function load(url: string): Promise<Gazetteer> {
  let pending = cache.get(url);
  if (!pending) {
    pending = fetch(url)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`${response.status} ${response.statusText}`);
        }
        return response.json();
      })
      .then(parseGazetteer)
      .catch((error) => {
        console.warn('Kepler panel: could not load the place names from', url, error);
        cache.delete(url);
        return new Map() as Gazetteer;
      });
    cache.set(url, pending);
  }
  return pending;
}

/** Whether any query places its rows by name. */
export function namesPlaces(frames: DataFrame[], mappings: Record<string, FieldRoleOverrides> | undefined): boolean {
  return frames.some((frame, index) => {
    const roles = resolveRoles(detectFields(frame), mappings?.[frame.refId ?? `${index}`]);
    return placedByName(roles) && !roles.geohash && Boolean(roles.lookup);
  });
}

export function useGazetteer(path: string | undefined, needed: boolean): Gazetteer | null {
  const url = needed
    ? resolveRemoteSource(path || GAZETTEERS.countries, typeof document === 'undefined' ? undefined : document.baseURI)
    : null;
  const [loaded, setLoaded] = useState<{ url: string; places: Gazetteer } | null>(null);
  useEffect(() => {
    if (!url) {
      return;
    }
    let live = true;
    void load(url).then((places) => {
      if (live) {
        setLoaded({ url, places });
      }
    });
    return () => {
      live = false;
    };
  }, [url]);
  return url && loaded?.url === url ? loaded.places : null;
}
