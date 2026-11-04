import type { DataFrame } from '@grafana/data';

import type { FieldRoles } from './detectFields';
import { ROUTE_COLUMNS } from './buildRoute';
import type { KeplerRow } from './toKeplerDataset';

/**
 * A network on the map: one query of nodes placed by coordinates, one of edges
 * naming two nodes each.
 *
 * Grafana's node graph shape, which Geomap's network layer draws: the edges
 * are the frame named `edges` or the one with `source` and `target` columns,
 * the nodes are another frame with an `id` and coordinates. An edge has no
 * position of its own, so without this its query reached kepler as rows with
 * nothing to draw. The edges' rows gain both ends, from their nodes, under the
 * same column names a route's segments use, and the line layer draws them.
 */

export const NODE_ID = 'id';
export const EDGE_SOURCE = 'source';
export const EDGE_TARGET = 'target';

export function isEdgeFrame(frame: DataFrame): boolean {
  const names = new Set(frame.fields.map((f) => f.name));
  return frame.name === 'edges' || (names.has(EDGE_SOURCE) && names.has(EDGE_TARGET));
}

/** Node id → [latitude, longitude], from a frame with an `id` column and point coordinates. */
export function nodePositions(frame: DataFrame, roles: FieldRoles): Map<string, [number, number]> | null {
  const ids = frame.fields.find((f) => f.name === NODE_ID);
  const lat = frame.fields.find((f) => f.name === roles.latitude);
  const lng = frame.fields.find((f) => f.name === roles.longitude);
  if (!ids || !lat || !lng) {
    return null;
  }
  const positions = new Map<string, [number, number]>();
  for (let i = 0; i < frame.length; i++) {
    const [y, x] = [lat.values[i], lng.values[i]];
    if (ids.values[i] != null && Number.isFinite(y) && Number.isFinite(x)) {
      positions.set(String(ids.values[i]), [y, x]);
    }
  }
  return positions;
}

/**
 * The edges' rows with both ends, in frame order; an edge whose source or
 * target is not among the nodes is left out, as Geomap leaves it.
 */
export function placeEdges(frame: DataFrame, rows: KeplerRow[], positions: Map<string, [number, number]>): KeplerRow[] {
  const sources = frame.fields.find((f) => f.name === EDGE_SOURCE)?.values ?? [];
  const targets = frame.fields.find((f) => f.name === EDGE_TARGET)?.values ?? [];
  const placed: KeplerRow[] = [];
  rows.forEach((row, i) => {
    const from = positions.get(String(sources[i]));
    const to = positions.get(String(targets[i]));
    if (from && to) {
      placed.push({
        ...row,
        [ROUTE_COLUMNS.lat0]: from[0],
        [ROUTE_COLUMNS.lng0]: from[1],
        [ROUTE_COLUMNS.lat1]: to[0],
        [ROUTE_COLUMNS.lng1]: to[1],
      });
    }
  });
  return placed;
}
