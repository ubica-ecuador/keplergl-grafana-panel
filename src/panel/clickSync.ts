import { normalizeFilterKey, type VariableMapping } from './variableSync';

/**
 * Decides when the entity clicked on the map reaches the dashboard variables.
 *
 * One direction only — map to variable, like the area sync. The variables are
 * for the *other* panels: `WHERE vehicle_id = '$vehicle'` in a table next to
 * the map. Free of kepler, React and @grafana/runtime so the publish rules can
 * be tested with literal values.
 *
 * The tri-state `selection` mirrors what kepler's `visState.clicked` can hold,
 * and the distinction it preserves is the whole point:
 *
 * - an object — the user clicked an entity; its mapped column values.
 * - `null` — the user clicked empty map or closed the popover: kepler's
 *   deliberate deselect gesture.
 * - `undefined` — no click state at all. That is the initial state, but also
 *   what a data refresh leaves behind: `replaceDataInMap` removes and
 *   re-merges the dataset's layers, and `removeLayerUpdater` resets a clicked
 *   object that lived on one of them. A refresh must never read as the user
 *   deselecting, so `undefined` never publishes anything.
 */

/** field → value for a clicked entity; null a deselect; undefined no state. */
export type ClickSelection = Record<string, unknown> | null | undefined;

export interface ClickDecision {
  /** variable name → value to write; empty means touch nothing. */
  writes: Record<string, string>;
  /** Whether the variables now hold a selection this panel published. */
  published: boolean;
}

/**
 * What this pass should write, and what to remember about it.
 *
 * A click publishes every mapping whose column resolved on the clicked entity,
 * skipping variables that already hold the value — re-clicking the selected
 * vehicle must not push a redundant URL change through the dashboard. A click
 * that resolves no mapped column at all is not a selection event for these
 * mappings: clicking a POI on some other layer neither publishes nor clears.
 *
 * A deselect clears the mapped variables, but only when `published` says the
 * running selection is this panel's own — a dashboard opened from a shared
 * link keeps its variable until the user actually selects something here.
 */
export function decideClickPublish({
  selection,
  mappings,
  variableValues,
  published,
}: {
  selection: ClickSelection;
  /** The click mappings only — see `partitionMappings`. */
  mappings: VariableMapping[];
  /** variable name → the value it currently holds (from the URL). */
  variableValues: Record<string, unknown>;
  /** Whether the variables hold a selection this panel published earlier. */
  published: boolean;
}): ClickDecision {
  if (selection === undefined) {
    return { writes: {}, published };
  }

  const noValue = normalizeFilterKey(null);

  if (selection === null) {
    const writes: Record<string, string> = {};
    if (published) {
      for (const { variable } of mappings) {
        if (normalizeFilterKey(variableValues[variable]) !== noValue) {
          // Empty keeps the SQL guard (`$vehicle != ''`) literal on the
          // consumer side, same convention as the area sync.
          writes[variable] = '';
        }
      }
    }
    return { writes, published: false };
  }

  const writes: Record<string, string> = {};
  let resolved = false;
  for (const { field, variable } of mappings) {
    const value = selection[field];
    if (value === undefined || value === null) {
      continue;
    }
    resolved = true;
    const next = String(value);
    if (normalizeFilterKey(next) !== normalizeFilterKey(variableValues[variable])) {
      writes[variable] = next;
    }
  }
  return resolved ? { writes, published: true } : { writes: {}, published };
}

/**
 * The value at `fieldIdx` of whatever row shape a kepler layer's
 * `getHoverData` returned: a `DataRow` (point, geojson and trip-geojson
 * layers) read through `valueAt`, or the plain value array a trip layer in
 * table mode hands back as the vertex under the playhead. Anything else —
 * including an aggregation layer's summary object — is no value.
 */
export function rowFieldValue(row: unknown, fieldIdx: number): unknown {
  if (row === null || row === undefined) {
    return undefined;
  }
  const dataRow = row as { valueAt?: (idx: number) => unknown };
  if (typeof dataRow.valueAt === 'function') {
    return dataRow.valueAt(fieldIdx);
  }
  if (Array.isArray(row)) {
    return row[fieldIdx];
  }
  return undefined;
}

/**
 * The synthetic column carrying the first value a WMS answered with.
 *
 * A raster WMS answers with exactly one band, and its name is the server's
 * business — GeoServer calls it `GRAY_INDEX`, which kepler then shows as
 * `GRAY INDEX`. Making someone find that out before they can wire a click to a
 * variable is a poor trade, so the first value is also published under a name
 * that is the same everywhere.
 */
export const WMS_VALUE_FIELD = 'wms_value';

/**
 * The values a WMS answered for the clicked pixel, or null if this was not one.
 *
 * kepler asks the service on the user's behalf — `GetFeatureInfo`, on the date
 * being shown — parses the reply and leaves it in `visState.clicked` under
 * `wmsFeatureInfo`, as the `{name, value}` pairs its tooltip renders. This
 * flattens those into the shape the publish rules already work in.
 *
 * Both names are offered for each attribute: the one kepler displays, and the
 * same with spaces turned back into underscores — which is what the server
 * actually calls the column, and what someone reading the service's
 * documentation will type. They point at one value; nothing is duplicated but
 * a key.
 */
export function wmsFeatureValues(object: unknown): Record<string, unknown> | null {
  const info = (object as { wmsFeatureInfo?: unknown } | null | undefined)?.wmsFeatureInfo;
  if (!Array.isArray(info)) {
    return null;
  }

  const values: Record<string, unknown> = {};
  for (const attribute of info) {
    const { name, value } = (attribute ?? {}) as { name?: unknown; value?: unknown };
    if (typeof name !== 'string' || !name.trim() || value === undefined || value === null) {
      continue;
    }
    values[name] = value;
    values[name.replace(/ /g, '_')] = value;
    if (!(WMS_VALUE_FIELD in values)) {
      values[WMS_VALUE_FIELD] = value;
    }
  }

  return values;
}
