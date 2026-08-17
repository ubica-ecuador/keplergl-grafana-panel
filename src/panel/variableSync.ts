/**
 * Pure helpers for driving dashboard variables from kepler's filters.
 *
 * Free of kepler, React and @grafana/runtime so it can be unit-tested with plain
 * objects. The hook (`useVariableSync`) reads real filter state through this and
 * writes the variables.
 */

/** Ties a kepler filter (by the column it filters) to a dashboard variable. */
export interface VariableMapping {
  field: string;
  variable: string;
  /**
   * The variable for the upper bound, which is what makes this a *range*
   * mapping: the filter on `field` is numeric, `variable` carries its min and
   * `variableTo` its max — the same two-variable encoding `timeVariables` uses,
   * so a consumer writes `speed BETWEEN '$speedMin' AND '$speedMax'`. Absent,
   * the mapping is the scalar kind above and a range filter on the field is
   * ignored.
   */
  variableTo?: string;
  /**
   * What drives the variable. The default, `filter`, is the two-way binding
   * above: the filter on `field` and the variable mirror each other. `click`
   * instead publishes the value of `field` for the entity clicked on the map —
   * one way only, and by the click-sync rules in `clickSync.ts` — which is what
   * turns "click a vehicle" into "the rest of the dashboard shows that
   * vehicle".
   */
  source?: 'filter' | 'click';
}

/** Whether a mapping publishes a numeric range as a min/max variable pair. */
export function isRangeMapping(mapping: VariableMapping): boolean {
  return Boolean(mapping.variable && mapping.variableTo);
}

/** Whether a mapping is driven by the clicked entity rather than a filter. */
export function isClickMapping(mapping: VariableMapping): boolean {
  return mapping.source === 'click';
}

/**
 * The mappings, split by the state that drives each: `scalar` and `range`
 * mirror a kepler filter both ways, `click` publishes the clicked entity one
 * way. The split is exclusive — in particular a click mapping stays a click
 * mapping whatever else it names, so a stray `variableTo` cannot promote it
 * into the range reconcile and have a variable pair create a filter no click
 * ever asked for.
 */
export function partitionMappings(mappings: VariableMapping[]): {
  scalar: VariableMapping[];
  range: VariableMapping[];
  click: VariableMapping[];
} {
  const scalar: VariableMapping[] = [];
  const range: VariableMapping[] = [];
  const click: VariableMapping[] = [];
  for (const mapping of mappings) {
    (isClickMapping(mapping) ? click : isRangeMapping(mapping) ? range : scalar).push(mapping);
  }
  return { scalar, range, click };
}

/** The little kepler filter shape this reads. */
interface FilterLike {
  name?: string[] | string;
  type?: string;
  value?: unknown;
}

/**
 * Filter types whose value maps cleanly to a Grafana variable.
 *
 * `select`/`input` carry a scalar, `multiSelect` an array — all directly usable
 * as a variable value. The windows travel by other roads: `timeRange` has its
 * own sync (`timeVariableSync.ts`) and `range` publishes as a min/max variable
 * pair when its mapping names both (see {@link isRangeMapping}). `polygon` is
 * spatial (`areaSync.ts`), so it never drives a scalar variable.
 */
const VARIABLE_FILTER_TYPES = new Set(['select', 'multiSelect', 'input']);

/**
 * Whether a filter's value can drive a mapped variable at all.
 *
 * The point is less the accepted set than the rejected one: a `polygon`
 * filter's `name` is the *labels of the layers* it applies to, not a column, so
 * without this guard a layer labelled like a mapped column would feed a GeoJSON
 * Feature into the field sync as that column's value.
 */
export function isVariableFilter(filter: FilterLike): boolean {
  return VARIABLE_FILTER_TYPES.has(filter.type ?? '');
}

/**
 * The value each mapped variable should hold, from the current filters.
 *
 * Only mappings with a matching, value-bearing filter appear — a mapping whose
 * filter is absent or empty is left out rather than written blank, so it does
 * not clobber a variable's own default.
 */
export function filterVariableValues(filters: FilterLike[], mappings: VariableMapping[]): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const { field, variable } of mappings) {
    const filter = filters.find((f) => matchesField(f, field) && VARIABLE_FILTER_TYPES.has(f.type ?? ''));
    if (filter && hasValue(filter.value)) {
      values[variable] = filter.value;
    }
  }
  return values;
}

/**
 * The kepler filter each mapped field should hold, from the current variables.
 *
 * The inverse of {@link filterVariableValues}: a variable's value becomes the
 * multi-select values for a filter on its field. A field always appears, with
 * `null` meaning "clear the filter" — either the variable is unset or it is
 * Grafana's `$__all`, both of which mean no restriction.
 */
export function variableFilterValues(
  variableStates: Record<string, unknown>,
  mappings: VariableMapping[]
): Record<string, string[] | null> {
  const values: Record<string, string[] | null> = {};
  for (const { field, variable } of mappings) {
    const selected = toStringValues(variableStates[variable]);
    values[field] = selected.length ? selected : null;
  }
  return values;
}

/**
 * A canonical key for a selection, shared by both sync directions so neither
 * echoes the other.
 *
 * A scalar and its one-element array compare equal, order does not matter, and
 * every empty / `$__all` form collapses to a single "no filter" key.
 */
export function normalizeFilterKey(value: unknown): string {
  const values = toStringValues(value);
  return values.length ? JSON.stringify([...values].sort()) : 'ALL';
}

/** What a reconcile should do about one mapped field. */
export type SyncAction =
  { kind: 'agreed' } | { kind: 'toMap'; values: string[] | null } | { kind: 'toVariable'; value: unknown };

/**
 * Which side of a mapped field has moved, and so which way to sync it.
 *
 * The `lastSynced` key is what tells the two directions apart: it is the value
 * both sides were last known to agree on, so whichever side still matches it is
 * the side that did not move. On the first pass there is no such value, and a
 * variable that already carries a selection wins — that is what makes a
 * dashboard opened at `?var-category=parks` filter the map rather than the other
 * way round.
 *
 * The caller records `lastSynced` itself, and — this is the point of pulling the
 * decision out here — only once the map has actually taken the filter. Recording
 * it optimistically is what used to clobber a preset variable: the map is not
 * ready to be filtered until its datasets have loaded, so the write was lost,
 * and the next pass read the map's empty filter as "the user cleared it" and
 * published `$__all` over the variable that was meant to be driving.
 */
export function decideFieldSync({
  filterValue,
  desired,
  lastSynced,
}: {
  /** The value of the map's filter on this field, if it has one. */
  filterValue: unknown;
  /** What the variable says the filter should be; `null` is no restriction. */
  desired: string[] | null;
  /** The value both sides last agreed on, or undefined on the first pass. */
  lastSynced: string | undefined;
}): SyncAction {
  const mapKey = normalizeFilterKey(filterValue);
  const variableKey = normalizeFilterKey(desired);

  if (mapKey === variableKey) {
    return { kind: 'agreed' };
  }

  const allKey = normalizeFilterKey(null);
  const variableDrives = lastSynced === undefined ? variableKey !== allKey : mapKey === lastSynced;

  return variableDrives ? { kind: 'toMap', values: desired } : { kind: 'toVariable', value: filterValue };
}

/**
 * The ordered numeric pair a kepler `range` filter holds, or null.
 *
 * Strict about shape because the value reaches us untyped from kepler state: an
 * inverted or non-finite pair is treated as no value rather than propagated to
 * a variable someone will interpolate into SQL.
 */
export function rangeFilterPair(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length !== 2) {
    return null;
  }
  const [min, max] = value;
  if (typeof min !== 'number' || typeof max !== 'number') {
    return null;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) {
    return null;
  }
  return [min, max];
}

/**
 * The range the mapped variable pair currently describes, or null.
 *
 * Mirrors `readWindowFromVariables` in `timeVariableSync.ts`: both bounds must
 * be present, numeric and ordered — a half-set or inverted pair means "no
 * window", never a filter that hides everything.
 */
export function readRangeFromVariables(
  values: Record<string, unknown>,
  mapping: VariableMapping
): [number, number] | null {
  if (!isRangeMapping(mapping)) {
    return null;
  }
  const min = parseRangeBound(values[mapping.variable]);
  const max = parseRangeBound(values[mapping.variableTo!]);
  if (min === null || max === null || min > max) {
    return null;
  }
  return [min, max];
}

/**
 * The value each of the pair's variables should hold for `pair`.
 *
 * A null pair writes both variables *blank* rather than leaving them: the
 * filter is gone, and keeping the old values would freeze the arbitration —
 * with the map at "no filter" and the variables at the old pair, neither side
 * ever matches the last agreement again, so the variables could never drive.
 */
export function rangeVariableWrites(pair: [number, number] | null, mapping: VariableMapping): Record<string, string> {
  if (!isRangeMapping(mapping)) {
    return {};
  }
  return {
    [mapping.variable]: pair ? String(pair[0]) : '',
    [mapping.variableTo!]: pair ? String(pair[1]) : '',
  };
}

/** A numeric bound from whatever the variable holds; null for every "no value" form. */
function parseRangeBound(raw: unknown): number | null {
  // Grafana repeats a variable in the URL when it is multi-value; a bound is
  // single-valued, so the first entry is the one that means anything.
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed === '' || trimmed === ALL_VALUE) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Coerces any variable/filter value to a list of real selections. */
function toStringValues(value: unknown): string[] {
  const list = Array.isArray(value) ? value : value === null || value === undefined ? [] : [value];
  return list.map(String).filter((v) => v !== '' && v !== ALL_VALUE);
}

/** Grafana's sentinel for a multi-value variable's "All" selection. */
const ALL_VALUE = '$__all';

function matchesField(filter: FilterLike, field: string): boolean {
  return Array.isArray(filter.name) ? filter.name.includes(field) : filter.name === field;
}

function hasValue(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (typeof value === 'string') {
    return value.length > 0;
  }
  return true;
}
