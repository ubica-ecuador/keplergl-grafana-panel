import { useEffect, useRef } from 'react';
import { locationService } from '@grafana/runtime';
import type { Store } from 'redux';

import { applyFieldFilter, readFilters, readSyncSlices, removeFieldFilter } from './keplerAdapter';
import { SliceWatcher } from './sliceWatcher';
import {
  decideFieldSync,
  isVariableFilter,
  normalizeFilterKey,
  variableFilterValues,
  type VariableMapping,
} from './variableSync';

interface Params {
  store: Store;
  /** kepler only exposes filters once its instance has registered. */
  isReady: boolean;
  mappings: VariableMapping[];
}

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
      // A polygon filter's name is its layer labels, not a column — letting it
      // through would hand a GeoJSON Feature to a field mapping. See
      // `isVariableFilter`.
      if (!isVariableFilter(filter)) {
        continue;
      }
      const field = Array.isArray(filter.name) ? filter.name[0] : filter.name;
      if (field) {
        filterValueByField[field] = filter.value;
      }
    }

    const variableWrites: Record<string, unknown> = {};
    for (const { field, variable } of maps) {
      const filterValue = filterValueByField[field];
      const desired = desiredByField[field]; // string[] | null (from the variable)
      const action = decideFieldSync({ filterValue, desired, lastSynced: lastSynced.current[field] });

      if (action.kind === 'agreed') {
        lastSynced.current[field] = normalizeFilterKey(filterValue);
        continue;
      }

      if (action.kind === 'toVariable') {
        variableWrites[`var-${variable}`] =
          Array.isArray(action.value) && action.value.length ? action.value : '$__all';
        lastSynced.current[field] = normalizeFilterKey(action.value);
        continue;
      }

      // The map is only recorded as synced once it has actually taken the
      // filter. Until its datasets have loaded there is no column to filter on,
      // and recording the attempt would make the next pass read the map's
      // missing filter as a clearing and publish it over the variable.
      const applied = action.values
        ? applyFieldFilter(store, store.dispatch, field, action.values)
        : (removeFieldFilter(store, store.dispatch, field), true);

      if (applied) {
        lastSynced.current[field] = normalizeFilterKey(action.values);
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
