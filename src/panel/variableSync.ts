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
 * as a variable value. `range` and `timeRange` are windows (timeRange has its
 * own sync) and `polygon` is spatial, so none of those drive a variable.
 */
const VARIABLE_FILTER_TYPES = new Set(['select', 'multiSelect', 'input']);

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
