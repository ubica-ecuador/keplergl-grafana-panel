/**
 * Pure helpers for syncing the dashboard time range with a kepler time filter.
 *
 * Everything here is free of kepler and React so it can be unit-tested with
 * plain objects. The adapter (`keplerAdapter.ts`) reads real kepler state
 * through these, and the hook (`useTimeRangeSync.ts`) drives the effects.
 */

/** A time window in epoch milliseconds — the unit both Grafana and kepler use. */
export interface TimeRangeMs {
  from: number;
  to: number;
}

/**
 * How the dashboard time range and the map's time filter relate.
 *
 * Declared here, in the kepler-free module, so the panel options type can name
 * it without pulling kepler into the eager bundle.
 */
export type TimeSyncMode = 'off' | 'toMap' | 'bidirectional';

/** kepler's filter type for a time window, and the field type it binds to. */
export const TIME_FILTER_TYPE = 'timeRange';
export const TIME_FIELD_TYPE = 'timestamp';

/** The little kepler shapes these helpers read, kept minimal on purpose. */
interface FilterLike {
  type?: string;
  value?: unknown;
}
interface FieldLike {
  name: string;
  type?: string;
}

/** The window of the first time-range filter, or null when there is none. */
export function readTimeFilterValue(filters: FilterLike[]): TimeRangeMs | null {
  const value = filters.find((f) => f.type === TIME_FILTER_TYPE)?.value;
  if (Array.isArray(value) && value.length === 2 && typeof value[0] === 'number' && typeof value[1] === 'number') {
    return { from: value[0], to: value[1] };
  }
  return null;
}

/** Name of the first timestamp field — what a new time filter binds to. */
export function findTimeFieldName(fields: FieldLike[]): string | null {
  return fields.find((f) => f.type === TIME_FIELD_TYPE)?.name ?? null;
}

export function rangesEqual(a: TimeRangeMs | null, b: TimeRangeMs | null): boolean {
  if (a === null || b === null) {
    return a === b;
  }
  return a.from === b.from && a.to === b.to;
}

/**
 * A one-value memory that cuts the sync echo loop.
 *
 * Both sync directions share a single guard. Whichever side moves the window
 * records it via `accept()`; when that same value comes back from the other side
 * — kepler echoing a push, or Grafana echoing an emit — `accept()` returns false
 * and the value is not propagated onward. Without this the two directions would
 * feed each other endlessly.
 */
export class TimeSyncGuard {
  private last: TimeRangeMs | null = null;

  /** True when `range` differs from the last committed value. Records nothing. */
  isNew(range: TimeRangeMs | null): boolean {
    return !rangesEqual(range, this.last);
  }

  /** Records `range` as the last synced value, so its echo is ignored. */
  commit(range: TimeRangeMs | null): void {
    this.last = range;
  }

  /**
   * `isNew` plus `commit` — for the direction where propagation cannot fail (the
   * store subscription always emits). The push direction splits the two so a
   * push that could not run yet (no dataset) does not record and can retry.
   */
  accept(range: TimeRangeMs | null): boolean {
    if (!this.isNew(range)) {
      return false;
    }
    this.commit(range);
    return true;
  }
}
