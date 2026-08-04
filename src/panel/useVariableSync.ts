import { useEffect, useRef } from 'react';
import { locationService } from '@grafana/runtime';
import type { Store } from 'redux';

import { applyFieldFilter, readFilters, readSyncSlices, removeFieldFilter } from './keplerAdapter';
import { SliceWatcher } from './sliceWatcher';
import { normalizeFilterKey, variableFilterValues, type VariableMapping } from './variableSync';

interface Params {
  store: Store;
  /** kepler only exposes filters once its instance has registered. */
  isReady: boolean;
  mappings: VariableMapping[];
}

const ALL_KEY = normalizeFilterKey(null);

/**
 * Two-way cross-filtering between kepler filters and dashboard variables.
 *
 * - Map → dashboard: a select/multi-select/text filter on the map writes its
 *   value to the mapped variable, re-querying the rest of the dashboard.
 * - Dashboard → map: changing that variable applies the matching filter on the
 *   map, so the category picker filters the map directly.
 *
 * Two things make the dashboard → map direction work. First, the panel does not
 * re-render when a variable it does not query on changes, so this listens to
 * location changes (Grafana keeps variables in the URL) rather than to props.
 * Second, applying a filter dispatches into kepler, so — like the time sync —
 * the reconcile runs on a microtask to avoid re-entering kepler's reducer from
 * inside its own store subscription.
 *
 * A per-field `lastSynced` key is shared by both directions to cut the echo; on
 * the first pass a variable that already has a value drives the map, so a
 * dashboard opened with a preset variable filters the map immediately.
 */
export function useVariableSync({ store, isReady, mappings }: Params): void {
  const lastSynced = useRef<Record<string, string>>({});
  const mappingsRef = useRef(mappings);
  // Updated in an effect, not during render: reconcile only runs on a microtask.
  useEffect(() => {
    mappingsRef.current = mappings;
  });

  const reconcile = useRef(() => {
    const maps = mappingsRef.current;
    if (!maps.length) {
      return;
    }

    const variableValues: Record<string, unknown> = {};
    for (const { variable } of maps) {
      variableValues[variable] = readVariable(variable);
    }
    const desiredByField = variableFilterValues(variableValues, maps);

    const filterValueByField: Record<string, unknown> = {};
    for (const filter of readFilters(store)) {
      const field = Array.isArray(filter.name) ? filter.name[0] : filter.name;
      if (field) {
        filterValueByField[field] = filter.value;
      }
    }

    const variableWrites: Record<string, unknown> = {};
    for (const { field, variable } of maps) {
      const filterValue = filterValueByField[field];
      const desired = desiredByField[field]; // string[] | null (from the variable)
      const mapKey = normalizeFilterKey(filterValue);
      const varKey = normalizeFilterKey(desired);
      const last = lastSynced.current[field];

      if (mapKey === varKey) {
        lastSynced.current[field] = mapKey;
        continue;
      }

      // Decide which side changed. On the first pass (no `last`) a variable with
      // a real selection wins, so a preset variable filters the map on load.
      const variableDrives = last === undefined ? varKey !== ALL_KEY : mapKey === last;

      if (variableDrives) {
        if (desired) {
          applyFieldFilter(store, store.dispatch, field, desired);
        } else {
          removeFieldFilter(store, store.dispatch, field);
        }
        lastSynced.current[field] = varKey;
      } else {
        variableWrites[`var-${variable}`] = Array.isArray(filterValue) && filterValue.length ? filterValue : '$__all';
        lastSynced.current[field] = mapKey;
      }
    }

    if (Object.keys(variableWrites).length > 0) {
      locationService.partial(variableWrites, true);
    }
  });

  const pending = useRef(false);
  const schedule = useRef(() => {
    if (pending.current) {
      return;
    }
    pending.current = true;
    void Promise.resolve().then(() => {
      pending.current = false;
      reconcile.current();
    });
  });

  // kepler dispatches on every pointer move over the map; only changes to the
  // slices this reads are worth a reconcile, which here also saves building a
  // fresh URLSearchParams per event. See `readSyncSlices`.
  const watcher = useRef(new SliceWatcher());
  const onStoreChange = useRef(() => {
    if (watcher.current.changed(readSyncSlices(store))) {
      schedule.current();
    }
  });

  useEffect(() => {
    if (!isReady || mappings.length === 0) {
      return;
    }
    schedule.current();
    // Map → dashboard: react to kepler filter changes.
    const unsubscribeStore = store.subscribe(onStoreChange.current);
    // Dashboard → map: react to variable changes, which land in the URL.
    const unlisten = locationService.getHistory().listen(schedule.current);
    return () => {
      unsubscribeStore();
      unlisten();
    };
  }, [isReady, mappings, store]);
}

/**
 * The current value of a dashboard variable, read from the URL.
 *
 * Deliberately from the URL rather than `getTemplateSrv()`: Grafana updates a
 * variable's resolved value asynchronously after the URL changes, so reading the
 * template service right after writing a variable returns the stale value and
 * the map bounces back to it. The URL is consistent with both our own writes and
 * the variable picker, so it is the race-free source of truth.
 */
function readVariable(name: string): unknown {
  const values = locationService.getSearch().getAll(`var-${name}`);
  if (values.length === 0) {
    return undefined;
  }
  return values.length === 1 ? values[0] : values;
}
