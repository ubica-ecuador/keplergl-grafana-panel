import { FieldType } from '@grafana/data';

import { KEPLER_COLUMN, type KeplerColumn, type KeplerRow } from './toKeplerDataset';

/**
 * A query drawn as one route: each row joined to the next, in the order the
 * query returns them.
 *
 * kepler has no layer that joins rows in order without a trip id and a clock,
 * which a route does not need (Geomap's route layer is exactly this). Its line
 * layer draws a segment per row between two coordinate pairs, so the route is
 * the query's rows as segments: row i keeps all its columns and gains the start
 * (its own position) and the end (row i + 1's). A colour or width by field then
 * applies per segment, from its starting row, as Geomap's does.
 */

/** The segment's ends, under the names kepler's line layer is configured with. */
export const ROUTE_COLUMNS = { lat0: 'lat0', lng0: 'lng0', lat1: 'lat1', lng1: 'lng1' } as const;

const ROUTE_THICKNESS = 4.5;

/** The line layer the panel adds for a route when no saved map governs the layers. */
export interface RouteLayerConfig {
  id: string;
  type: 'line';
  config: {
    dataId: string;
    label: string;
    columnMode: 'points';
    columns: typeof ROUTE_COLUMNS;
    isVisible: boolean;
    visConfig: { thickness: number };
  };
  visualChannels: Record<string, unknown>;
}

export function buildRouteLayer(dataId: string, label: string): RouteLayerConfig {
  return {
    id: `line-${dataId}`,
    type: 'line',
    config: {
      dataId,
      label,
      columnMode: 'points',
      columns: { ...ROUTE_COLUMNS },
      isVisible: true,
      // About 3 px: kepler's default of 2 draws a route at 1.3 px, too faint
      // to read over a street map.
      visConfig: { thickness: ROUTE_THICKNESS },
    },
    visualChannels: {},
  };
}

/** The dataset id of a query's route, beside the query's own dataset. */
export function routeDatasetId(queryDatasetId: string): string {
  return `${queryDatasetId}-route`;
}

export function buildRouteSegments(rows: KeplerRow[]): KeplerRow[] {
  const lat = KEPLER_COLUMN.latitude;
  const lng = KEPLER_COLUMN.longitude;
  const segments: KeplerRow[] = [];
  for (let i = 0; i < rows.length - 1; i++) {
    const from = rows[i];
    const to = rows[i + 1];
    if (!isCoordinate(from[lat]) || !isCoordinate(from[lng]) || !isCoordinate(to[lat]) || !isCoordinate(to[lng])) {
      continue;
    }
    segments.push({
      ...from,
      [ROUTE_COLUMNS.lat0]: from[lat],
      [ROUTE_COLUMNS.lng0]: from[lng],
      [ROUTE_COLUMNS.lat1]: to[lat],
      [ROUTE_COLUMNS.lng1]: to[lng],
    });
  }
  return segments;
}

/** The route's columns when there are no segments, so a saved layer on it is not parked. */
export function routeColumns(columns: KeplerColumn[]): KeplerColumn[] {
  const ends = Object.values(ROUTE_COLUMNS);
  return [
    ...columns.filter((c) => !ends.includes(c.name as never)),
    ...ends.map((name) => ({ name, type: FieldType.number })),
  ];
}

function isCoordinate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
