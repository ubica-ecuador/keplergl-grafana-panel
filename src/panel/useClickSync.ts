import { useEffect, useMemo, useRef } from 'react';
import { locationService } from '@grafana/runtime';
import type { Store } from 'redux';

import { readClickedEntity, readClickSlices } from './keplerAdapter';
import { decideClickPublish, decideSelectionClear, isCurrentSelection, type ClickSelection } from './clickSync';
import { isClickMapping, partitionMappings, type VariableMapping } from './variableSync';
import { readVariable } from './useVariableSync';
import { SliceWatcher } from './sliceWatcher';

interface Params {
  store: Store;
  /** kepler only exposes its click state once its instance has registered. */
  isReady: boolean;
  /** All the panel's mappings; only the `click` ones drive this hook. */
  mappings: VariableMapping[];
  /**
   * Whether a click only shows the entity, leaving the writing to the popup.
   *
   * See the note on confirm mode below.
   */
  confirm?: boolean;
}

/** What the popup's button calls, and what it needs to know to label itself. */
export interface ClickSelectActions {
  /** Publishes the entity showing in the pinned popup. */
  select: () => void;
  /** Empties the mapped variables. */
  clear: () => void;
  /** Whether the entity showing in the pinned popup is the published one. */
  isSelected: () => boolean;
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
 * **Confirm mode** unhooks all of that from the gesture. A click still opens
 * kepler's popup, but nothing the user does on the map moves a variable: not
 * the click, and not the empty-map click either. The reason the deselect goes
 * quiet too is that dismissing a popup to look elsewhere would otherwise clear
 * the selection and re-query the dashboard — the very cost the mode exists to
 * avoid, arriving through the other door. What writes instead are `select` and
 * `clear`, which the popup's own button calls.
 *
 * Same structural rules as the sibling hooks: reconcile on a microtask, never
 * inside the store subscription, and react only when the watched slice —
 * `clicked` alone — actually moves.
 */
export function useClickSync({ store, isReady, mappings, confirm = false }: Params): ClickSelectActions {
  const mappingsRef = useRef(mappings);
  const confirmRef = useRef(confirm);
  // Updated in an effect, not during render: reconcile only runs on a microtask.
  useEffect(() => {
    mappingsRef.current = mappings;
    confirmRef.current = confirm;
  });

  /** Whether the mapped variables hold a selection this panel published. */
  const published = useRef(false);

  /** The click mappings, the values their variables hold, and what is clicked. */
  const readState = useRef(() => {
    const { click } = partitionMappings(mappingsRef.current);
    const variableValues: Record<string, unknown> = {};
    for (const { variable } of click) {
      variableValues[variable] = readVariable(variable);
    }
    const selection: ClickSelection = click.length
      ? readClickedEntity(
          store,
          click.map((m) => m.field)
        )
      : undefined;
    return { click, variableValues, selection };
  });

  const write = useRef((writes: Record<string, string>) => {
    const entries = Object.entries(writes);
    if (entries.length) {
      locationService.partial(Object.fromEntries(entries.map(([name, value]) => [`var-${name}`, value])), true);
    }
  });

  const reconcile = useRef(() => {
    // In confirm mode the map is read-only: the actions below are the writers.
    if (confirmRef.current) {
      return;
    }

    const { click, variableValues, selection } = readState.current();
    if (!click.length) {
      return;
    }

    const decision = decideClickPublish({
      selection,
      mappings: click,
      variableValues,
      published: published.current,
    });
    published.current = decision.published;
    write.current(decision.writes);
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

  // One stable object: it is handed to the popup through a context, and a new
  // identity on every render would re-render every popup with it.
  return useMemo<ClickSelectActions>(
    () => ({
      select: () => {
        const { click, variableValues, selection } = readState.current();
        if (!click.length) {
          return;
        }
        const decision = decideClickPublish({
          selection,
          mappings: click,
          variableValues,
          published: published.current,
        });
        published.current = decision.published;
        write.current(decision.writes);
      },
      clear: () => {
        const { click, variableValues } = readState.current();
        if (!click.length) {
          return;
        }
        const decision = decideSelectionClear({ mappings: click, variableValues });
        published.current = decision.published;
        write.current(decision.writes);
      },
      isSelected: () => {
        const { click, variableValues, selection } = readState.current();
        return click.length ? isCurrentSelection({ selection, mappings: click, variableValues }) : false;
      },
    }),
    []
  );
}
