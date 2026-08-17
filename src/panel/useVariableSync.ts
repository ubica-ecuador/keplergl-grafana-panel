import { useEffect, useRef } from 'react';
import { locationService } from '@grafana/runtime';
import type { Store } from 'redux';

import { applyFieldFilter, applyRangeFilter, readFilters, readSyncSlices, removeFieldFilter } from './keplerAdapter';
import { SliceWatcher } from './sliceWatcher';
import {
  decideFieldSync,
  isVariableFilter,
  normalizeFilterKey,
  partitionMappings,
  rangeFilterPair,
  rangeVariableWrites,
  readRangeFromVariables,
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
 * How long a range brush must rest before its pair reaches the dashboard.
 *
 * kepler updates a range filter on every pointer move of a histogram drag, and
 * each variable write re-runs every panel that references the pair — the exact
 * shape of the 92-queries-in-10-s incident the time sync already survived. The
 * scalar filters commit discretely, so only the range writes are debounced.
 * Same figure as `PUBLISH_DELAY_MS` in `useTimeVariableSync.ts`.
 */
const RANGE_PUBLISH_DELAY_MS = 300;

/**
 * Two-way cross-filtering between kepler filters and dashboard variables.
 *
 * - Map → dashboard: a select/multi-select/text filter on the map writes its
 *   value to the mapped variable, re-querying the rest of the dashboard. A
 *   numeric range filter writes a min/max variable pair instead, debounced —
 *   its brush drags where the scalar filters click.
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

  /**
   * The range writes waiting out the brush, and what to record once they land.
   *
   * `lastSynced` is only updated at the flush: recording at decision time would
   * make the next mid-drag pass read "agreed" and drop the newer window.
   */
  const pendingRange = useRef<{ writes: Record<string, unknown>; keys: Record<string, string> } | null>(null);
  const rangeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushRange = useRef(() => {
    rangeTimer.current = null;
    const pending = pendingRange.current;
    pendingRange.current = null;
    if (!pending) {
      return;
    }
    locationService.partial(pending.writes, true);
    Object.assign(lastSynced.current, pending.keys);
  });

  const cancelRange = useRef(() => {
    if (rangeTimer.current !== null) {
      clearTimeout(rangeTimer.current);
      rangeTimer.current = null;
    }
    pendingRange.current = null;
  });

  const reconcile = useRef(() => {
    const maps = mappingsRef.current;
    if (!maps.length) {
      return;
    }

    // Click mappings belong to `useClickSync` — one-way, publish-on-click.
    // Reconciling them here would have the variable write a filter back onto
    // the map, a direction no click mapping asked for.
    const { scalar: scalarMaps, range: rangeMaps } = partitionMappings(maps);

    const variableValues: Record<string, unknown> = {};
    for (const { variable, variableTo } of maps) {
      variableValues[variable] = readVariable(variable);
      if (variableTo) {
        variableValues[variableTo] = readVariable(variableTo);
      }
    }
    const desiredByField = variableFilterValues(variableValues, scalarMaps);

    const filterValueByField: Record<string, unknown> = {};
    const rangeValueByField: Record<string, unknown> = {};
    for (const filter of readFilters(store)) {
      const field = Array.isArray(filter.name) ? filter.name[0] : filter.name;
      if (!field) {
        continue;
      }
      if (filter.type === 'range') {
        rangeValueByField[field] = filter.value;
      } else if (isVariableFilter(filter)) {
        // A polygon filter's name is its layer labels, not a column — letting
        // it through would hand a GeoJSON Feature to a field mapping. See
        // `isVariableFilter`.
        filterValueByField[field] = filter.value;
      }
    }

    const variableWrites: Record<string, unknown> = {};
    for (const { field, variable } of scalarMaps) {
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

    // Ranges ride the same arbitration as the scalars — a numeric pair and its
    // two-variable string form share a canonical key — but publish through the
    // debounce, and canonicalize the variables through Number so `80.0` in the
    // URL and kepler's `80` read as agreement rather than a bounce.
    const rangeWrites: Record<string, unknown> = {};
    const rangeKeys: Record<string, string> = {};
    for (const mapping of rangeMaps) {
      const { field } = mapping;
      const pair = rangeFilterPair(rangeValueByField[field]);
      const desiredPair = readRangeFromVariables(variableValues, mapping);
      const desired = desiredPair ? desiredPair.map(String) : null;
      const action = decideFieldSync({
        filterValue: pair ?? undefined,
        desired,
        lastSynced: lastSynced.current[field],
      });

      if (action.kind === 'agreed') {
        lastSynced.current[field] = normalizeFilterKey(pair ?? undefined);
        continue;
      }

      if (action.kind === 'toVariable') {
        const writes = rangeVariableWrites(rangeFilterPair(action.value), mapping);
        for (const [name, value] of Object.entries(writes)) {
          rangeWrites[`var-${name}`] = value;
        }
        rangeKeys[field] = normalizeFilterKey(action.value);
        continue;
      }

      const applied = action.values
        ? applyRangeFilter(store, store.dispatch, field, [Number(action.values[0]), Number(action.values[1])])
        : (removeFieldFilter(store, store.dispatch, field), true);

      if (applied) {
        lastSynced.current[field] = normalizeFilterKey(action.values);
      }
    }

    if (Object.keys(variableWrites).length > 0) {
      locationService.partial(variableWrites, true);
    }

    if (Object.keys(rangeWrites).length > 0) {
      pendingRange.current = { writes: rangeWrites, keys: rangeKeys };
      if (rangeTimer.current !== null) {
        clearTimeout(rangeTimer.current);
      }
      rangeTimer.current = setTimeout(() => flushRange.current(), RANGE_PUBLISH_DELAY_MS);
    } else if (pendingRange.current) {
      // The disagreement resolved itself before the brush rested — the
      // variables took over, or the filter went away. Publishing the stale
      // pair now would overwrite whoever won.
      cancelRange.current();
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

    // Captured rather than read in the cleanup: the ref is assigned once, but
    // reading it on teardown is what the exhaustive-deps rule warns about.
    const cancel = cancelRange.current;

    schedule.current();
    // Map → dashboard: react to kepler filter changes.
    const unsubscribeStore = store.subscribe(onStoreChange.current);
    // Dashboard → map: react to variable changes, which land in the URL.
    const unlisten = locationService.getHistory().listen(schedule.current);
    return () => {
      unsubscribeStore();
      unlisten();
      cancel();
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
 *
 * Exported for the sibling sync hooks (`useClickSync`) that need the same
 * race-free read.
 */
export function readVariable(name: string): unknown {
  const values = locationService.getSearch().getAll(`var-${name}`);
  if (values.length === 0) {
    return undefined;
  }
  return values.length === 1 ? values[0] : values;
}
