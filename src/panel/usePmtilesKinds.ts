import { useEffect, useMemo, useRef, useState } from 'react';

import { fetchPmtilesHeader, type PmtilesHeader } from '../data/pmtilesHeader';
import type { XyzDataset } from '../data/xyzDataset';

/**
 * A query's PMTiles archives, told apart before they are drawn: vector tiles
 * or pictures, as each archive's header says (`pmtilesHeader.ts`).
 *
 * kepler draws the two with two layers and two dataset types, and a picture
 * archive handed to its vector layer is decoded as vector tiles, tile after
 * tile in error. So an archive waits off the map until its header has been
 * read — one range request of 127 bytes, remembered for the page by address —
 * and one whose header cannot be read stays off it, said over the map.
 */

/** What the panel knows of an archive: its header, or why it has none. */
export type ArchiveRead = { header: PmtilesHeader } | { error: string };

/**
 * The layers with each archive resolved: what it holds, and its box when the
 * query gave none (the header's, for framing and the cut). An archive not
 * read yet is left out, and one that could not be read is left out and named
 * in `unread`, worded for the notice over the map.
 */
export function resolvePmtiles(
  layers: XyzDataset[],
  read: Readonly<Record<string, ArchiveRead | undefined>>
): { layers: XyzDataset[]; unread: string[] } {
  const out: XyzDataset[] = [];
  const unread: string[] = [];
  for (const layer of layers) {
    if (layer.format !== 'pmtiles') {
      out.push(layer);
      continue;
    }
    const known = read[layer.url];
    if (!known) {
      continue;
    }
    if ('error' in known) {
      unread.push(`${queryNameOf(layer)} gives a PMTiles archive this map could not read: ${known.error}.`);
      continue;
    }
    out.push({ ...layer, pmtilesKind: known.header.kind, bbox: layer.bbox ?? known.header.bbox });
  }
  return { layers: out, unread };
}

/** The archives a list of layers names, each once. */
export function archivesOf(layers: XyzDataset[]): string[] {
  return [...new Set(layers.filter((layer) => layer.format === 'pmtiles').map((layer) => layer.url))];
}

/** The headers read on this page, by address: every panel over the same archive asks once. */
const headers = new Map<string, Promise<PmtilesHeader>>();

function headerOf(url: string): Promise<PmtilesHeader> {
  let pending = headers.get(url);
  if (!pending) {
    pending = fetchPmtilesHeader(url);
    headers.set(url, pending);
    // A failure is not remembered: the next answer of the query asks again.
    pending.catch(() => headers.delete(url));
  }
  return pending;
}

/** Forgets the headers read so far (tests). */
export function forgetPmtilesHeaders(): void {
  headers.clear();
}

export function usePmtilesKinds(layers: XyzDataset[]): { layers: XyzDataset[]; unread: string[] } {
  const [read, setRead] = useState<Record<string, ArchiveRead>>({});
  const asking = useRef(new Set<string>());
  // Whether the panel is still there for an answer, across changes of the
  // query: an answer asked for by the previous one is this one's too.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    for (const url of archivesOf(layers)) {
      const known = read[url];
      if ((known && 'header' in known) || asking.current.has(url)) {
        continue;
      }
      asking.current.add(url);
      const answer = (entry: ArchiveRead) => {
        asking.current.delete(url);
        if (mounted.current) {
          setRead((current) => ({ ...current, [url]: entry }));
        }
      };
      headerOf(url).then(
        (header) => answer({ header }),
        (error: unknown) => answer({ error: messageOf(error) })
      );
    }
    // `read` left out on purpose: a failure it records must not ask again at
    // once, only when the query answers anew.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layers]);

  return useMemo(() => resolvePmtiles(layers, read), [layers, read]);
}

/** "services (query A)", from what a layer carries: the frame's name, and the ref id in its own id. */
function queryNameOf(layer: XyzDataset): string {
  const refId = /^grafana-(.+)-tiles$/.exec(layer.id)?.[1] ?? '';
  return layer.label && layer.label !== refId && layer.label !== `Query ${refId}`
    ? `${layer.label} (query ${refId})`
    : `Query ${refId}`;
}

function messageOf(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  // A refused cross-origin read reaches the page as a bare TypeError.
  return /failed to fetch|networkerror|load failed/i.test(text)
    ? 'the request failed (offline, or refused by CORS)'
    : text;
}
