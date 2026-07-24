import { useEffect, useRef } from 'react';
import { locationService } from '@grafana/runtime';
import type { Store } from 'redux';

import { readFilters } from './keplerAdapter';
import { filterVariableValues, type VariableMapping } from './variableSync';

interface Params {
  store: Store;
  /** kepler only exposes filters once its instance has registered. */
  isReady: boolean;
  mappings: VariableMapping[];
}

/**
 * Drives dashboard variables from kepler's filters.
 *
 * Each mapping ties a filtered column to a template variable: when the user sets
 * a select, multi-select or text filter on the map, its value is written to the
 * variable with `locationService.partial`, and the rest of the dashboard
 * re-queries. That data refresh keeps the map's filters (the panel refreshes
 * with `keepExistingConfig`), so the value does not bounce back — and a
 * `lastWritten` guard means a variable is only written when it actually changed,
 * which also stops the refresh from re-triggering a write.
 *
 * Unlike the time sync, this writes to Grafana, not kepler, so it never
 * re-enters kepler's reducer; the microtask debounce is only to coalesce a burst
 * of filter edits into one navigation.
 */
export function useVariableSync({ store, isReady, mappings }: Params): void {
  const lastWritten = useRef<Record<string, unknown>>({});
  const mappingsRef = useRef(mappings);
  mappingsRef.current = mappings;

  const reconcile = useRef(() => {
    const maps = mappingsRef.current;
    if (!maps.length) {
      return;
    }
    const desired = filterVariableValues(readFilters(store), maps);

    const partial: Record<string, unknown> = {};
    for (const [variable, value] of Object.entries(desired)) {
      if (!sameValue(value, lastWritten.current[variable])) {
        partial[`var-${variable}`] = value;
        lastWritten.current[variable] = value;
      }
    }
    if (Object.keys(partial).length > 0) {
      locationService.partial(partial, true);
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

  useEffect(() => {
    if (!isReady || mappings.length === 0) {
      return;
    }
    schedule.current();
    return store.subscribe(schedule.current);
  }, [isReady, mappings, store]);
}

/** Shallow value equality that also handles the array a multiSelect produces. */
function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }
  return a === b;
}
