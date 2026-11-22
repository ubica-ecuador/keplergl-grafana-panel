import { createOrUpdateFilter, setFilter, wrapTo } from '@kepler.gl/actions';
import type { Store } from 'redux';

import { keplerIntervalPairOf } from '../data/intervalRows';
import { KEPLER_INSTANCE_ID } from './constants';

/**
 * The rows alive at a moment, for a dataset whose rows live from `valid_from` to `valid_to` (`intervalRows.ts`): an
 * Iceberg table's history played on the map.
 *
 * kepler's time filter takes an end field (its "end time field"): with `valid_to` there, it keeps the rows whose
 * life overlaps the filter's window, an empty end being a row still alive. So a dataset's new time filter gets
 * `valid_to` as its end and a window of one moment, the last: the table as it is now, and as it was at any moment
 * the window is moved or played to. A wider window keeps every row alive at some moment of it.
 *
 * Done once for a dataset, on the filter the panel makes for it: one the user changes or removes stays as they left
 * it, and a saved map brings its own back.
 */

const TIME_FILTER = 'timeRange';

interface FilterLike {
  id: string;
  type?: string | null;
  name?: string[] | string;
  endName?: Array<string | null> | string | null;
  dataId?: string[] | string;
  domain?: unknown;
}

export interface IntervalVisState {
  datasets?: Record<string, { fields: Array<{ name: string }> }>;
  filters?: FilterLike[];
}

const listOf = <T>(v: T[] | T | undefined | null): T[] => (Array.isArray(v) ? v : v ? [v] : []);

/** The time filter of a dataset on a column, by its index among the map's filters; -1 when there is none. */
function timeFilterOn(filters: readonly FilterLike[], dataId: string, column: string): number {
  return filters.findIndex(
    (f) => f.type === TIME_FILTER && listOf(f.dataId).includes(dataId) && listOf(f.name).includes(column)
  );
}

/** Whether a time filter keeps rows by their life: it has an end field for some dataset. */
export function isIntervalTimeFilter(filter: FilterLike | undefined): boolean {
  return filter?.type === TIME_FILTER && listOf(filter.endName).some(Boolean);
}

export type IntervalStep =
  | { kind: 'create'; dataId: string; column: string }
  | { kind: 'end'; idx: number; column: string; valueIndex: number }
  | { kind: 'moment'; idx: number; value: [number, number] };

/** What one map remembers: the datasets it made a filter for, and where that filter is in its setting up. */
export interface IntervalMemory {
  made: Set<string>;
  /** Filters made and not yet set up: their end field (`end`), then their window (`moment`). */
  pending: Map<string, 'end' | 'moment'>;
}

export function intervalMemory(): IntervalMemory {
  return { made: new Set(), pending: new Map() };
}

const pairOf = (v: unknown): [number, number] | null =>
  Array.isArray(v) && typeof v[0] === 'number' && typeof v[1] === 'number' ? [v[0], v[1]] : null;

/** The next thing to do for the map's interval datasets, or nothing: one at a time, each changes the state read next. */
export function intervalStep(visState: IntervalVisState, memory: IntervalMemory): IntervalStep | null {
  const filters = visState.filters ?? [];
  for (const [dataId, dataset] of Object.entries(visState.datasets ?? {})) {
    const pair = keplerIntervalPairOf(dataset.fields.map((f) => f.name));
    if (!pair) {
      continue;
    }
    const key = `${dataId}|${pair.start}`;
    const idx = timeFilterOn(filters, dataId, pair.start);
    if (idx < 0) {
      // None yet and none saved: made once. One the user removed stays removed.
      if (!memory.made.has(key)) {
        memory.made.add(key);
        memory.pending.set(key, 'end');
        return { kind: 'create', dataId, column: pair.start };
      }
      continue;
    }
    // A filter there at first sight is a saved one: left as it is.
    memory.made.add(key);
    const stage = memory.pending.get(key);
    if (stage === 'end') {
      memory.pending.set(key, 'moment');
      const valueIndex = listOf(filters[idx].dataId).indexOf(dataId);
      if (listOf(filters[idx].endName)[valueIndex] !== pair.end) {
        return { kind: 'end', idx, column: pair.end, valueIndex };
      }
    }
    if (memory.pending.get(key) === 'moment') {
      const domain = pairOf(filters[idx].domain);
      if (!domain) {
        continue;
      }
      memory.pending.delete(key);
      return { kind: 'moment', idx, value: [domain[1], domain[1]] };
    }
  }
  return null;
}

/** Sets up the time filter of a map's interval datasets as they arrive. Returns the unsubscribe. */
export function linkIntervalFilters(store: Store): () => void {
  const memory = intervalMemory();
  let busy = false;
  const visStateOf = () =>
    (store.getState() as { keplerGl?: Record<string, { visState?: IntervalVisState }> }).keplerGl?.[KEPLER_INSTANCE_ID]
      ?.visState;
  const run = () => {
    if (busy) {
      return;
    }
    busy = true;
    try {
      // A handful of steps at most per change: make, end field, window.
      for (let round = 0; round < 8; round++) {
        const visState = visStateOf();
        const step = visState ? intervalStep(visState, memory) : null;
        if (!step) {
          break;
        }
        store.dispatch(
          wrapTo(
            KEPLER_INSTANCE_ID,
            step.kind === 'create'
              ? createOrUpdateFilter(undefined, step.dataId, step.column)
              : step.kind === 'end'
                ? setFilter(step.idx, 'endName', step.column, step.valueIndex)
                : setFilter(step.idx, 'value', step.value)
          ) as never
        );
      }
    } finally {
      busy = false;
    }
  };
  return store.subscribe(run);
}
