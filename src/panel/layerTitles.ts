import type { DataFrame } from '@grafana/data';

import { routeDatasetId } from '../data/buildRoute';
import { frameTitleOf, untitledLabelOf } from '../data/frameLayer';
import { datasetId } from '../data/framesToDatasets';
import { queryDatasetIds } from './layerFraming';

/**
 * Names the map's layers as their data source names them.
 *
 * A query whose frames name their layer's title (`meta.custom.layer.title`,
 * `frameTitleOf`) gives that title to its datasets, and kepler names the
 * layers it makes on them after it. Not every layer, though:
 *
 * - a map saved before its data source said a title keeps the names kepler
 *   gave its layers then — the frame's own name (`features`, `rasters`), or
 *   `Query A`;
 * - a query pointed at another layer, in its editor or by a variable, keeps
 *   its layers, and with them the old layer's name (`replaceDataInMap` keeps
 *   a layer's config);
 * - kepler cuts what looks like a file's extension off the name it gives a
 *   points or GeoJSON layer, so "CCI Biomass v5.01" became "CCI Biomass v5".
 *
 * So a layer on a query's datasets is renamed to the query's title while its
 * name is still one of those the panel or kepler gave it: the frame's own name
 * or the query's, a title the query named before, or kepler's cut of either.
 * A name the user gave it is never one of these, and stays.
 *
 * Free of kepler and React so the rules can be tested with literal values;
 * `useLayerTitles` applies them.
 */

/** What a dataset's layers are called, and the names they may still carry that the panel or kepler gave them. */
export interface WantedTitle {
  title: string;
  automatic: ReadonlySet<string>;
}

/** A kepler layer, as far as the naming reads it. */
export interface NamedLayer {
  id: string;
  config?: { dataId?: string | null; label?: string | null };
}

/** kepler's default name for a layer on a dataset of this label: the label without what looks like an extension. */
export function keplerCut(label: string): string {
  return label.replace(/\.[^/.]+$/, '');
}

/**
 * The titles the queries in `frames` give their datasets, by dataset id, and
 * the titles each query has named so far (`named`, by refId, this answer's
 * included): a title a query named before is a name the panel gave.
 */
export function wantedTitles(
  frames: readonly DataFrame[],
  earlier: ReadonlyMap<string, readonly string[]>
): { wanted: Map<string, WantedTitle>; named: Map<string, string[]> } {
  const named = new Map<string, string[]>([...earlier].map(([refId, titles]) => [refId, [...titles]]));
  const wanted = new Map<string, WantedTitle>();
  const done = new Set<string>();
  frames.forEach((frame, index) => {
    const refId = frame.refId ?? `${index}`;
    const title = frameTitleOf(frame);
    if (!title || done.has(refId)) {
      return;
    }
    done.add(refId);
    const before = named.get(refId) ?? [];
    const given = [untitledLabelOf(frame, refId), `Query ${refId}`, ...before.filter((t) => t !== title)];
    named.set(refId, before.includes(title) ? before : [...before, title]);

    const automatic = (names: string[], own: string) =>
      new Set([...names, ...names.map(keplerCut), keplerCut(own)].filter((name) => name !== own));
    const route = routeDatasetId(datasetId(refId));
    for (const id of queryDatasetIds(refId)) {
      const isRoute = id === route;
      // A route drawn from the rows is named after them (`framesToDatasets`).
      const own = isRoute ? `${title} · route` : title;
      wanted.set(id, { title: own, automatic: automatic(isRoute ? given.map((n) => `${n} · route`) : given, own) });
    }
  });
  return { wanted, named };
}

/** The layers to rename, and to what: those on a titled dataset whose name is still one the panel or kepler gave. */
export function layerTitleRenames(
  layers: readonly NamedLayer[],
  wanted: ReadonlyMap<string, WantedTitle>
): Array<{ layer: NamedLayer; label: string }> {
  const renames: Array<{ layer: NamedLayer; label: string }> = [];
  for (const layer of layers) {
    const want = layer.config?.dataId ? wanted.get(layer.config.dataId) : undefined;
    const label = layer.config?.label ?? '';
    if (want && label !== want.title && want.automatic.has(label)) {
      renames.push({ layer, label: want.title });
    }
  }
  return renames;
}
