import type { AdHocVariableFilter, DataFrame } from '@grafana/data';

import { clickedRowFrame } from './dataLinks';

/**
 * Ad hoc filters from the entity clicked on the map, the way Grafana's table
 * adds them from a cell: "Filter for value" adds `field = value` to the
 * dashboard's ad hoc filter variable, "Filter out value" adds `field != value`,
 * and every query of that datasource on the dashboard is filtered by it.
 *
 * Grafana does the adding: the panel context's `onAddAdHocFilter` finds the ad
 * hoc variable of the panel's datasource and appends the filter, or swaps the
 * operator of the same key and value. The panel only decides when to offer it
 * and what the item says.
 *
 * When: the panel names the fields to offer (`adHocFilterFields`), and the
 * dashboard has an ad hoc filter variable for the panel's datasource. Grafana
 * tells the panel the second through its query request: the dashboard's query
 * runner sets `request.filters` (an empty list when nothing is filtered yet)
 * only when such a variable exists. Without one, `onAddAdHocFilter` would
 * create a "Filters" variable for a datasource that may not apply it at all,
 * and a Mixed panel would get one for "-- Mixed --"; the map offers nothing
 * instead.
 *
 * Free of kepler and React, like dataLinks.ts.
 */

/** The two operators Grafana's table offers, as its AdHocFilterItem spells them. */
export type AdHocOperator = '=' | '!=';

/** What `onAddAdHocFilter` takes: @grafana/ui's AdHocFilterItem. */
export interface AdHocFilterItem {
  key: string;
  value: string;
  operator: AdHocOperator;
}

/** One field of the clicked entity the popup offers as a filter. */
export interface EntityFilter {
  /** The query's column name: what the datasource filters on. */
  key: string;
  /** The value, as text: what the variable holds. */
  value: string;
  /** Whether the dashboard already filters for `key = value`. */
  filteredFor: boolean;
  /** Whether it already filters out `key != value`. */
  filteredOut: boolean;
}

/**
 * Whether the popup offers ad hoc filters at all: fields named, a callback from
 * Grafana, and an ad hoc variable for this panel's datasource (`request.filters`
 * is set).
 */
export function offersAdHocFilters({
  fields,
  requestFilters,
  canAdd,
}: {
  fields: readonly string[] | undefined;
  /** `data.request.filters`: set only when the dashboard has an ad hoc variable for the panel's datasource. */
  requestFilters: readonly AdHocVariableFilter[] | undefined;
  /** Whether the panel context has `onAddAdHocFilter`. */
  canAdd: boolean;
}): boolean {
  return canAdd && Array.isArray(requestFilters) && Boolean(fields?.length);
}

/**
 * The value a filter holds, as the table writes it: the raw value as text.
 * A missing value offers no filter: `field = ''` would match nothing the
 * entity is.
 */
export function filterValueOf(value: unknown): string | undefined {
  if (value === null || value === undefined || value === '') {
    return undefined;
  }
  if (value instanceof Date) {
    return String(value.valueOf());
  }
  if (typeof value === 'object') {
    // A geometry, an array: no datasource compares one with `=`.
    return undefined;
  }
  return String(value);
}

/**
 * The filters the popup offers for the clicked entity: one per named field the
 * entity's query has, in the order the panel names them, with its value read
 * from kepler's row (`renames` maps the query's name to kepler's, as for the
 * data links).
 */
export function entityFilters({
  frame,
  values,
  renames,
  fields,
  active,
}: {
  frame: DataFrame;
  values: Record<string, unknown>;
  renames?: Record<string, string>;
  fields: readonly string[];
  /** The filters the dashboard applies now: `request.filters`. */
  active: readonly AdHocVariableFilter[];
}): EntityFilter[] {
  const row = clickedRowFrame(frame, values, renames);
  const filters: EntityFilter[] = [];
  const seen = new Set<string>();
  for (const name of fields) {
    if (seen.has(name)) {
      continue;
    }
    seen.add(name);
    const field = row.fields.find((f) => f.name === name);
    const value = field ? filterValueOf(field.values[0]) : undefined;
    if (value === undefined) {
      continue;
    }
    const has = (operator: AdHocOperator) =>
      active.some((filter) => filter.key === name && filter.operator === operator && filter.value === value);
    filters.push({ key: name, value, filteredFor: has('='), filteredOut: has('!=') });
  }
  return filters;
}

/** The item handed to Grafana's `onAddAdHocFilter`. */
export function adHocFilterItem(filter: Pick<EntityFilter, 'key' | 'value'>, operator: AdHocOperator): AdHocFilterItem {
  return { key: filter.key, value: filter.value, operator };
}
