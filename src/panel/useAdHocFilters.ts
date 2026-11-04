import { useEffect, useMemo, useRef } from 'react';
import type { AdHocVariableFilter, DataFrame } from '@grafana/data';
import type { Store } from 'redux';

import type { PanelDataset } from '../data/framesToDatasets';
import { closeMapPopover, readClickedRow, readClickSlices } from './keplerAdapter';
import { frameOfDataset } from './dataLinks';
import {
  adHocFilterItem,
  entityFilters,
  offersAdHocFilters,
  type AdHocFilterItem,
  type AdHocOperator,
  type EntityFilter,
} from './adHocFilters';

interface Params {
  store: Store;
  frames: readonly DataFrame[];
  datasets: readonly PanelDataset[];
  /** The query fields the popup offers as filters: the panel's `adHocFilterFields`. */
  fields: readonly string[] | undefined;
  /** `data.request.filters`: set only when the dashboard has an ad hoc variable for the panel's datasource. */
  requestFilters: readonly AdHocVariableFilter[] | undefined;
  /** The panel context's `onAddAdHocFilter`; absent outside a dashboard. */
  onAddAdHocFilter?: (item: AdHocFilterItem) => void;
}

/** What the popup reads: the clicked entity's filters, and the way to add one. */
export interface AdHocApi {
  /** The filters of the entity in the pinned popup; empty when there is none. */
  filters: () => EntityFilter[];
  /** Adds `filter` with `operator` to the dashboard's ad hoc variable, and closes the popup. */
  add: (filter: EntityFilter, operator: AdHocOperator) => void;
}

const NO_FILTERS: EntityFilter[] = [];

/**
 * The clicked entity's ad hoc filters, in its pinned popup (adHocFilters.ts).
 *
 * Resolved when the popup asks and remembered against the click state's
 * identity, as useDataLinks does: kepler re-renders the popup on every pointer
 * move while one is pinned. Null when the panel offers none, so the popup has
 * nothing to ask.
 *
 * Adding closes the popup: the queries the filter changes run again, the map's
 * among them, and the popup would otherwise sit over an entity that may be
 * about to leave the map.
 */
export function useAdHocFilters({
  store,
  frames,
  datasets,
  fields,
  requestFilters,
  onAddAdHocFilter,
}: Params): AdHocApi | null {
  const inputs = useRef({ frames, datasets, fields, requestFilters, onAddAdHocFilter });
  useEffect(() => {
    inputs.current = { frames, datasets, fields, requestFilters, onAddAdHocFilter };
  });

  const cache = useRef<{
    clicked: unknown;
    frames: readonly DataFrame[];
    fields: readonly string[] | undefined;
    active: readonly AdHocVariableFilter[] | undefined;
    filters: EntityFilter[];
  } | null>(null);

  const resolve = useRef((): EntityFilter[] => {
    const { frames, datasets, fields, requestFilters } = inputs.current;
    if (!fields?.length || !requestFilters) {
      return NO_FILTERS;
    }
    const [clicked] = readClickSlices(store);
    const cached = cache.current;
    if (
      cached &&
      cached.clicked === clicked &&
      cached.frames === frames &&
      cached.fields === fields &&
      cached.active === requestFilters
    ) {
      return cached.filters;
    }
    const row = readClickedRow(store);
    const frame = row ? frameOfDataset(frames, row.dataId) : undefined;
    const renames = row ? datasets.find((d) => d.id === row.dataId)?.renames : undefined;
    const filters =
      row && frame ? entityFilters({ frame, values: row.values, renames, fields, active: requestFilters }) : NO_FILTERS;
    cache.current = { clicked, frames, fields, active: requestFilters, filters };
    return filters;
  });

  const offered = offersAdHocFilters({
    fields,
    requestFilters,
    canAdd: typeof onAddAdHocFilter === 'function',
  });

  // One stable object while the offer stands: it travels down a context to a
  // popup kepler re-renders on every pointer move.
  return useMemo<AdHocApi | null>(
    () =>
      offered
        ? {
            filters: () => resolve.current(),
            add: (filter, operator) => {
              const add = inputs.current.onAddAdHocFilter;
              closeMapPopover(store.dispatch);
              add?.(adHocFilterItem(filter, operator));
            },
          }
        : null,
    [offered, store]
  );
}
