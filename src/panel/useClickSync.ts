import { useEffect, useRef } from 'react';
import { locationService } from '@grafana/runtime';
import type { Store } from 'redux';

import { readClickedEntity, readClickSlices } from './keplerAdapter';
import { decideClickPublish } from './clickSync';
import { isClickMapping, partitionMappings, type VariableMapping } from './variableSync';
import { readVariable } from './useVariableSync';
import { SliceWatcher } from './sliceWatcher';

interface Params {
  store: Store;
  /** kepler only exposes its click state once its instance has registered. */
  isReady: boolean;
  /** All the panel's mappings; only the `click` ones drive this hook. */
  mappings: VariableMapping[];
}

/**
 * Publishes the entity clicked on the map to dashboard variables.
 *
 * One direction only: a mapping with `source: 'click'` writes the clicked
 * entity's value of `field` to its variable, and the rest of the dashboard —
 * the table beside the map, the time series below it — re-queries to that
 * entity. The variable never drives the map back; a user who wants that too
 * can add an ordinary filter mapping on the same column.
 *
 * No debounce, unlike the range and area syncs: a click is already a discrete
 * gesture, and the decision skips variables that already hold the value, so
 * nothing here can write per pointer move.
 *
 * The publish rules live in `clickSync.ts` and encode the spike's finding
 * about kepler's `visState.clicked`: it survives re-renders but not a data
 * refresh, which resets it to `undefined` — distinct from the `null` of a
 * deliberate empty-map click. Only the latter clears, and only when the
 * running selection was published by this panel, so a dashboard opened from a
 * shared link keeps its variable until the user actually clicks.
 *
 * Same structural rules as the sibling hooks: reconcile on a microtask, never
 * inside the store subscription, and react only when the watched slice —
 * `clicked` alone — actually moves.
 */
export function useClickSync({ store, isReady, mappings }: Params): void {
  const mappingsRef = useRef(mappings);
  // Updated in an effect, not during render: reconcile only runs on a microtask.
  useEffect(() => {
    mappingsRef.current = mappings;
  });

  /** Whether the mapped variables hold a selection this panel published. */
  const published = useRef(false);

  const reconcile = useRef(() => {
    const { click } = partitionMappings(mappingsRef.current);
    if (!click.length) {
      return;
    }

    const variableValues: Record<string, unknown> = {};
    for (const { variable } of click) {
      variableValues[variable] = readVariable(variable);
    }

    const decision = decideClickPublish({
      selection: readClickedEntity(
        store,
        click.map((m) => m.field)
      ),
      mappings: click,
      variableValues,
      published: published.current,
    });
    published.current = decision.published;

    const writes = Object.entries(decision.writes);
    if (writes.length) {
      locationService.partial(
        Object.fromEntries(writes.map(([name, value]) => [`var-${name}`, value])),
        true
      );
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

  const watcher = useRef(new SliceWatcher());
  const onStoreChange = useRef(() => {
    if (watcher.current.changed(readClickSlices(store))) {
      schedule.current();
    }
  });

  useEffect(() => {
    if (!isReady || !mappings.some(isClickMapping)) {
      return;
    }

    schedule.current();
    return store.subscribe(onStoreChange.current);
  }, [isReady, mappings, store]);
}
