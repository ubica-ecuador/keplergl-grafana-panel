import type { DataFrame } from '@grafana/data';

import { routeDatasetId } from '../data/buildRoute';
import { esriDatasetId } from '../data/esriDataset';
import { frameLayerOf, type LayerBox } from '../data/frameLayer';
import { datasetId } from '../data/framesToDatasets';
import { rasterDatasetId } from '../data/rasterDataset';
import { wmsDatasetId } from '../data/wmsDataset';
import { xyzDatasetId } from '../data/xyzDataset';
import { zarrDatasetId } from '../data/zarrDataset';
import { armFit, type FitArm } from './fitOnVariables';
import type { MapBounds } from './keplerAdapter';
import { fitBoundsOfBox, MERCATOR_LIMIT, unionOfBounds } from './wmsExtent';

/**
 * Decides when the map frames a query that has been pointed at another layer.
 *
 * The panel frames its data once, on load, and a refresh never moves the view.
 * A query switched to another layer is not a refresh, though, even when the
 * new layer's columns are the old one's — another GeoParquet file of the same
 * schema, another file of a collection, a layer a variable names — and the
 * map that stays where the old layer was shows nothing of the new one. Its
 * frames say which layer they draw (`meta.custom.layer.key`, `frameLayer.ts`),
 * and so tell a new layer from a refresh of the same one.
 *
 * - **The first answer** of a query only records its layer: the load frames
 *   it, or keeps the saved view, as it always has.
 * - **The same layer again** — a refresh, a new time range — moves nothing.
 * - **Another layer** is framed: on its box (`meta.custom.layer.bbox`) when the
 *   frames give one, at once and even when the answer has no rows (the time
 *   range may hide them all; a notice says so); otherwise on its rows, once
 *   they reach kepler's layers (`armLayerFraming`). Another layer with neither
 *   box nor rows leaves the view where it is.
 * - **A query framed on its own box** — a WMS, an ArcGIS service, tiles with a
 *   `tiles_bbox` — is left to `useBoxFraming`, which frames each new service on
 *   that box already.
 *
 * Free of kepler, React and @grafana/runtime so the rules can be tested with
 * literal values; `useLayerFraming` applies them.
 */

/** The narrowest span, in degrees, the map frames a box on: a box of one point is framed at a street's zoom. */
export const MIN_BOX_SPAN = 0.05;

/** A query's answer, as far as the framing reads it. */
export interface QueryLayerAnswer {
  refId: string;
  /** The layer its frames name, or null when they name none. */
  key: string | null;
  /** The boxes its frames give for that layer; empty for none. */
  boxes: LayerBox[];
  /** Whether it answered any row. */
  hasRows: boolean;
  /** Whether one of its datasets is framed on a box of its own by `useBoxFraming`. */
  boxFramed: boolean;
}

/** What to do with an answer: the layers now known, by refId, and what to frame. */
export interface LayerFramingDecision {
  known: Map<string, string | null>;
  /** The boxes of the queries that changed layer, as one, or null for none. */
  box: MapBounds | null;
  /** The queries that changed layer without a box, framed on their rows once they land. */
  rows: string[];
}

/**
 * Every dataset id the panel gives a query's answer — its rows, their route,
 * its raster, Zarr, WMS, ArcGIS service or tiles — so that the framing reads
 * the bounds of that query's layers and no other's.
 */
export function queryDatasetIds(refId: string): string[] {
  const rows = datasetId(refId);
  return [
    rows,
    routeDatasetId(rows),
    rasterDatasetId(refId),
    zarrDatasetId(refId),
    wmsDatasetId(refId),
    esriDatasetId(refId),
    xyzDatasetId(refId),
  ];
}

/**
 * The answers of the queries in `frames`, one per refId.
 *
 * A query may give several frames: its key is theirs joined, in order and each
 * once, so that any of them pointing elsewhere is another layer; its boxes are
 * all those its frames give. `boxedIds` are the datasets `useBoxFraming`
 * frames on a box of their own.
 */
export function queryLayerAnswers(frames: readonly DataFrame[], boxedIds: ReadonlySet<string>): QueryLayerAnswer[] {
  const byRefId = new Map<string, { keys: string[]; boxes: LayerBox[]; hasRows: boolean }>();
  frames.forEach((frame, index) => {
    const refId = frame.refId ?? `${index}`;
    const entry = byRefId.get(refId) ?? { keys: [], boxes: [], hasRows: false };
    byRefId.set(refId, entry);
    const layer = frameLayerOf(frame);
    if (layer && !entry.keys.includes(layer.key)) {
      entry.keys.push(layer.key);
    }
    if (layer?.bbox) {
      entry.boxes.push(layer.bbox);
    }
    entry.hasRows ||= rowCount(frame) > 0;
  });
  return [...byRefId].map(([refId, { keys, boxes, hasRows }]) => ({
    refId,
    key: keys.length ? keys.join('\n') : null,
    boxes,
    hasRows,
    boxFramed: queryDatasetIds(refId).some((id) => boxedIds.has(id)),
  }));
}

function rowCount(frame: DataFrame): number {
  return typeof frame.length === 'number' ? frame.length : (frame.fields[0]?.values.length ?? 0);
}

/**
 * The rules above, for one answer of the panel's queries. `known` holds the
 * layer each query last named, by refId, null for a query whose frames named
 * none. A query absent from `answers` — failed, or still running — keeps its
 * entry, so that the same layer coming back is not taken for a new one.
 *
 * A query that names no layer is not framed by these rules, whatever it named
 * before (it is framed as any query is); one that starts naming a layer after
 * naming none has been pointed at that layer, and is.
 */
export function decideLayerFraming(
  known: ReadonlyMap<string, string | null>,
  answers: readonly QueryLayerAnswer[]
): LayerFramingDecision {
  const next = new Map(known);
  const boxes: MapBounds[] = [];
  const rows: string[] = [];
  for (const answer of answers) {
    const seen = known.has(answer.refId);
    const previous = known.get(answer.refId);
    next.set(answer.refId, answer.key);
    if (!seen || answer.key === null || answer.key === previous || answer.boxFramed) {
      continue;
    }
    if (answer.boxes.length) {
      boxes.push(...answer.boxes.map(boxFitBounds));
    } else if (answer.hasRows) {
      rows.push(answer.refId);
    }
  }
  return { known: next, box: unionOfBounds(boxes), rows };
}

/**
 * The bounds the map frames a layer's box on: unwrapped and inside Web
 * Mercator as a WMS's are (`fitBoundsOfBox`), and at least `MIN_BOX_SPAN` wide
 * and high around its middle — a box of one point, or one squeezed against a
 * pole by the projection's edge, would otherwise be framed at the deepest zoom
 * kepler has, or refused.
 */
export function boxFitBounds(box: LayerBox): MapBounds {
  let [west, south, east, north] = fitBoundsOfBox(box);
  if (east - west < MIN_BOX_SPAN) {
    const middle = (west + east) / 2;
    west = middle - MIN_BOX_SPAN / 2;
    east = middle + MIN_BOX_SPAN / 2;
  }
  if (north - south < MIN_BOX_SPAN) {
    const middle = (south + north) / 2;
    south = Math.max(-MERCATOR_LIMIT, Math.min(middle - MIN_BOX_SPAN / 2, MERCATOR_LIMIT - MIN_BOX_SPAN));
    north = south + MIN_BOX_SPAN;
  }
  return [west, south, east, north];
}

/**
 * A query switched to another layer whose rows the map waits for.
 *
 * The same arm as the fit on variables (`fitOnVariables.ts`), and for the same
 * reason: the answer that names the new layer is handed to kepler before its
 * rows reach the layers, which kepler merges through tasks of its own, and the
 * bounds those layers report until then are the old layer's. So the arm notes
 * the bounds of the query's layers before the rows are handed over, frames them
 * as soon as they move, and frames what they are after a short wait when they
 * do not — another file of the same extent, which the user may have panned away
 * from. Never the same extent twice, and given up after `FIT_ARM_MAX_MS`.
 *
 * Unlike the fit on variables it has no grace for later steps: the answer that
 * names the new layer brings that layer's rows, so once they are framed
 * elsewhere than the old ones the arm is spent, and a refresh of the same
 * layer after any framing lets it go — the view is the user's again.
 */
export interface LayerArm extends FitArm {
  /** The datasets of the queries that changed layer: whose layers' bounds are read. */
  ids: string[];
  /** The boxes of the other queries that changed layer in the same answer, framed with these rows. */
  box: MapBounds | null;
}

/**
 * A fresh arm over the datasets `ids` (`queryDatasetIds` of the queries that
 * changed layer), with `bounds` their layers' bounds before the rows are
 * handed over.
 */
export function armLayerFraming(now: number, bounds: string, ids: string[], box: MapBounds | null): LayerArm {
  return { ...armFit(now, bounds), ids, box };
}
