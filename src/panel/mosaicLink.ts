/**
 * Pure helpers for linking the map to a Mosaic Selection of the dashboard.
 *
 * The Chaski app shares one copy of Mosaic among its panels, and a page of
 * Selections by name. A map linked to one of them takes part like a brush
 * does: each filter on the map is a clause on its column, sent as the slider
 * moves, and the clauses the other panels make on a column the map carries
 * land on the map's filter of that column. No variable and no URL in between,
 * so the other panels follow a drag while it happens, at Mosaic's speed.
 *
 * Crossfilter rules: the map is never filtered by its own clauses, and one
 * column has one window — the last panel to move it wins, and the others show
 * it. Free of kepler, React, Mosaic and @grafana/runtime, so the rules can be
 * tested with literal values; `useMosaicSelection` does the wiring.
 */

/** The Chaski app's Mosaic panel, whose module carries the copy of Mosaic the panels share. */
export const MOSAIC_PANEL = 'ubica-chaski-mosaic-panel';

/** kepler's filter types the link carries; every other type stays on the map. */
export const RANGE_FILTER_TYPE = 'range';
export const MULTI_SELECT_FILTER_TYPE = 'multiSelect';
const TIME_RANGE_FILTER_TYPE = 'timeRange';

/** What the map needs of a Mosaic selection clause. */
export interface ClauseLike {
  source?: unknown;
  value?: unknown;
  meta?: { type?: string };
}

/** A filter on the map, as the link reads it: one column, with its data's extent and its type. */
export interface LinkableFilter {
  field: string;
  type: string;
  value: unknown;
  domain?: unknown;
  /** kepler's type of the column: `timestamp`, `real`, `integer`, `string`… */
  fieldType?: string;
}

/** What a map filter says, as a clause would. `open` filters nothing: the clause goes. */
export type FilterClause =
  | { kind: 'interval'; field: string; value: [number, number]; time: boolean; domain: [number, number] | null }
  | { kind: 'points'; field: string; values: Array<string | number> }
  | { kind: 'open'; field: string };

/** What another panel's clause asks of a column on the map. */
export interface ForeignValue {
  field: string;
  kind: 'interval' | 'points';
  /** In kepler's units: epoch ms for a time, the values as the map's column holds them. */
  value: [number, number] | Array<string | number>;
  /** Tells one clause value from another, so a value already on the map is not applied again. */
  key: string;
}

/** The interval clause's values, from Mosaic's Dates or numbers to epoch ms or numbers. */
const toNumber = (value: unknown): number =>
  value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Number(value);

function pair(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length !== 2) {
    return null;
  }
  const lo = toNumber(value[0]);
  const hi = toNumber(value[1]);
  return Number.isFinite(lo) && Number.isFinite(hi) ? [Math.min(lo, hi), Math.max(lo, hi)] : null;
}

/**
 * Twelve significant digits: kepler and Mosaic hand back the same window in
 * floating point that differs in the last bits, and that is not a move.
 */
const digits = (n: number) => String(Number(n.toPrecision(12)));

/** The clause a map filter makes, or null for a filter the link does not carry. */
export function filterClause(filter: LinkableFilter): FilterClause | null {
  const { field, type, value } = filter;
  if (type === RANGE_FILTER_TYPE || type === TIME_RANGE_FILTER_TYPE) {
    const window = pair(value);
    if (!window) {
      return { kind: 'open', field };
    }
    const domain = pair(filter.domain);
    // A window over the whole of the data filters nothing: kepler seeds a new filter that way.
    if (domain && window[0] <= domain[0] && window[1] >= domain[1]) {
      return { kind: 'open', field };
    }
    return { kind: 'interval', field, value: window, time: type === TIME_RANGE_FILTER_TYPE, domain };
  }
  if (type === MULTI_SELECT_FILTER_TYPE) {
    const values = Array.isArray(value)
      ? value.filter((v): v is string | number => typeof v === 'string' || typeof v === 'number')
      : [];
    return values.length ? { kind: 'points', field, values } : { kind: 'open', field };
  }
  return null;
}

/** The key of what a map filter says, comparable with a {@link ForeignValue}'s. */
export function filterKey(clause: FilterClause): string {
  if (clause.kind === 'interval') {
    return intervalKey(clause.value);
  }
  return clause.kind === 'points' ? pointsKey(clause.values) : 'open';
}

const intervalKey = ([lo, hi]: [number, number]) => `interval:${digits(lo)}:${digits(hi)}`;
const pointsKey = (values: Array<string | number>) => `points:${JSON.stringify(values.map(String).sort())}`;

/**
 * What the other panels' clauses ask of each column, by column.
 *
 * Only clauses on one column, of the two kinds a map filter can show: an
 * interval (a brush) or points (picked values). A later clause on a column
 * wins over an earlier one, as the Selection's own order says.
 */
export function foreignValues(
  clauses: readonly ClauseLike[],
  columnsOf: (clause: ClauseLike) => string[],
  isOwn: (source: unknown) => boolean
): Map<string, ForeignValue> {
  const found = new Map<string, ForeignValue>();
  for (const clause of clauses) {
    if (isOwn(clause.source) || clause.value == null) {
      continue;
    }
    const columns = columnsOf(clause);
    if (columns.length !== 1) {
      continue;
    }
    const [field] = columns;
    const type = clause.meta?.type;
    if (type === 'interval') {
      const window = pair(clause.value);
      if (window) {
        found.set(field, { field, kind: 'interval', value: window, key: intervalKey(window) });
      }
    } else if (type === 'point') {
      // clausePoints holds one array per pick (`[[v], [w]]`); clausePoint the value itself.
      const values = (Array.isArray(clause.value) ? clause.value : [[clause.value]])
        .map((v) => (Array.isArray(v) ? v[0] : v))
        .filter((v): v is string | number => typeof v === 'string' || typeof v === 'number');
      if (values.length) {
        found.set(field, { field, kind: 'points', value: values, key: pointsKey(values) });
      }
    }
  }
  return found;
}

/** A foreign value as the map's filter on that column takes it. */
export function keplerFilterValue(foreign: ForeignValue, fieldType?: string): unknown {
  if (foreign.kind === 'interval') {
    return foreign.value;
  }
  const numeric = fieldType === 'integer' || fieldType === 'real';
  return (foreign.value as Array<string | number>).map((v) => (numeric ? Number(v) : String(v)));
}

/**
 * A pixel scale over the filter's extent, so Mosaic can pre-aggregate the
 * other panels for this window as it does for its own brushes. kepler's slider
 * has no pixel axis to give; a thousand steps is finer than any slider drawn.
 */
export const SCALE_STEPS = 1000;

export function intervalScale(clause: Extract<FilterClause, { kind: 'interval' }>) {
  if (!clause.domain || clause.domain[0] === clause.domain[1]) {
    return undefined;
  }
  const domain = clause.time ? clause.domain.map((ms) => new Date(ms)) : clause.domain;
  return { type: clause.time ? 'utc' : 'linear', domain, range: [0, SCALE_STEPS] };
}

/** The bbox the map shows, as `[[west, east], [south, north]]` on the longitude and latitude columns. */
export function viewportExtent(
  bounds: { west: number; south: number; east: number; north: number } | null
): [[number, number], [number, number]] | null {
  if (!bounds) {
    return null;
  }
  const { west, south, east, north } = bounds;
  if (![west, south, east, north].every((v) => Number.isFinite(v))) {
    return null;
  }
  const lng = (v: number) => Math.round(Math.min(180, Math.max(-180, v)) * 1e6) / 1e6;
  const lat = (v: number) => Math.round(Math.min(90, Math.max(-90, v)) * 1e6) / 1e6;
  return [
    [lng(west), lng(east)],
    [lat(south), lat(north)],
  ];
}

/** The longitude and latitude columns of `"lng, lat"`, or null unless there are exactly two. */
export function parseViewportColumns(text: string | undefined): [string, string] | null {
  const columns = (text ?? '')
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);
  return columns.length === 2 ? [columns[0], columns[1]] : null;
}
