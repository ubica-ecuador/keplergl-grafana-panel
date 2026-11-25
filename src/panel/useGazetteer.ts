import { useEffect, useMemo, useState } from 'react';
import type { DataFrame } from '@grafana/data';

import { detectFields, type FieldRoleOverrides, resolveRoles } from '../data/detectFields';
import { GAZETTEERS, type Gazetteer, parseGazetteer, placedByName } from '../data/placeLookup';
import { resolveRemoteSource } from '../data/remoteSource';
import type { QueryOptions } from '../types';

/**
 * The gazetteers a panel's place names are looked up in, one per query that
 * names places, each fetched once a query needs it and shared by every query
 * and panel that names the same file.
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
      .catch(() => {
        // Rows whose place cannot be looked up stay in the table, undrawn.
        cache.delete(url);
        return new Map() as Gazetteer;
      });
    cache.set(url, pending);
  }
  return pending;
}

/**
 * The gazetteer each query that places its rows by name looks them up in, by
 * refId: the query's own (`queryOptions`), or Grafana's countries.
 */
export function gazetteerPaths(
  frames: DataFrame[],
  mappings: Record<string, FieldRoleOverrides> | undefined,
  queryOptions: Record<string, QueryOptions> | undefined
): Record<string, string> {
  const paths: Record<string, string> = {};
  frames.forEach((frame, index) => {
    const refId = frame.refId ?? `${index}`;
    const roles = resolveRoles(detectFields(frame), mappings?.[refId]);
    if (placedByName(roles) && !roles.geohash && roles.lookup) {
      paths[refId] = queryOptions?.[refId]?.gazetteer || GAZETTEERS.countries;
    }
  });
  return paths;
}

/**
 * The gazetteers of {@link gazetteerPaths}, by refId, each `null` until its
 * file has loaded. A file two queries name is fetched once.
 */
export function useGazetteers(paths: Record<string, string>): Record<string, Gazetteer | null> {
  const base = typeof document === 'undefined' ? undefined : document.baseURI;
  // Which query reads which file, as one string: a refresh that names the same files is the same signature, so
  // nothing loads again and the datasets built from the result are not rebuilt.
  const signature = Object.entries(paths)
    .map(([refId, path]) => `${refId}\t${resolveRemoteSource(path, base)}`)
    .sort()
    .join('\n');
  const [loaded, setLoaded] = useState<ReadonlyMap<string, Gazetteer>>(() => new Map());
  useEffect(() => {
    const urls = new Set(signature ? signature.split('\n').map((line) => line.split('\t')[1]) : []);
    let live = true;
    for (const url of urls) {
      void load(url).then((places) => {
        if (live) {
          setLoaded((previous) => (previous.get(url) === places ? previous : new Map(previous).set(url, places)));
        }
      });
    }
    return () => {
      live = false;
    };
  }, [signature]);
  return useMemo(() => {
    const byQuery: Record<string, Gazetteer | null> = {};
    for (const line of signature ? signature.split('\n') : []) {
      const [refId, url] = line.split('\t');
      byQuery[refId] = loaded.get(url) ?? null;
    }
    return byQuery;
  }, [signature, loaded]);
}
