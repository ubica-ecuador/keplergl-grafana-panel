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
export type TimeSyncMode = 'off' | 'toMap' | 'bidirectional' | 'variables';

/**
 * Whether the mode ties the map's time filter to the dashboard time range.
 *
 * False for `variables`, and that is the whole point of it: the dashboard range
 * stays what gets queried, while the filter is seeded with the data's own domain
 * so the time widget opens showing everything. Pushing the dashboard range onto
 * the filter would leave the brush already covering the full histogram, with no
 * context left to reveal.
 */
export function couplesDashboardRange(mode: TimeSyncMode): boolean {
  return mode === 'toMap' || mode === 'bidirectional';
}

/** kepler's filter type for a time window, and the field type it binds to. */
export const TIME_FILTER_TYPE = 'timeRange';
export const TIME_FIELD_TYPE = 'timestamp';

/** The little kepler shapes these helpers read, kept minimal on purpose. */
interface FilterLike {
  type?: string;
  value?: unknown;
  domain?: unknown;
}
interface FieldLike {
  name: string;
  type?: string;
}

/** The window of the first time-range filter, or null when there is none. */
export function readTimeFilterValue(filters: FilterLike[]): TimeRangeMs | null {
  return toRange(filters.find((f) => f.type === TIME_FILTER_TYPE)?.value);
}

/**
 * The full time extent of the data behind the first time-range filter.
 *
 * kepler keeps this separate from the filter's value and — because time filters
 * carry `fixedDomain` — does not shrink it as the window narrows. That is what
 * makes it usable as the "unfiltered" pair to publish, and as the yardstick for
 * whether a brush actually restricts anything. Null until kepler has computed
 * it, which is a moment later than the filter appearing.
 */
export function readTimeFilterDomain(filters: FilterLike[]): TimeRangeMs | null {
  return toRange(filters.find((f) => f.type === TIME_FILTER_TYPE)?.domain);
}

/** A `[from, to]` numeric pair as a range, or null for anything else. */
function toRange(value: unknown): TimeRangeMs | null {
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
 * The memory that cuts the echo between the dashboard range and the map filter.
 *
 * The two directions need separate memories because the value does not survive
 * the trip: kepler clamps a pushed window to the data's own domain, so what it
 * settles on is rarely what was asked for. A single slot holding the requested
 * range therefore sees the clamped one come back as a change and reports it to
 * Grafana — which, with a dashboard window wider than the data, silently drags
 * the time picker down to the data's extent on load and costs a second round of
 * queries. So one slot records what was pushed, another what kepler kept.
 *
 * The domain is watched for the same reason one step further out. Once the
 * dashboard range follows the map, the narrower range re-runs the query, the
 * data shrinks, and kepler re-clamps the window to what is left — a window
 * change that no user made. Comparing the domain tells the two apart: a drag
 * moves the window within a steady domain, a re-clamp moves both.
 */
export class TimeSyncGuard {
  /** The dashboard range last handed to the map. */
  private pushed: TimeRangeMs | null = null;
  /** The window kepler actually settled on — the baseline a drag departs from. */
  private mapRange: TimeRangeMs | null = null;
  /** The data extent last seen, to tell a drag from a re-clamp. */
  private domain: TimeRangeMs | null = null;
  private seenDomain = false;
  /** The dashboard range a reported window has not reached yet. */
  private stale: TimeRangeMs | null = null;

  /**
   * True when `range` is not the one already pushed, so it is worth pushing.
   *
   * Reporting a drag to Grafana does not update the dashboard range in the same
   * turn, so for a moment the range still reads what it did before — and that
   * value, pushed back, would snap the brush out from under the user mid-drag.
   * It is ignored until it moves, which is either the report landing or the user
   * reaching for the time picker; both are real and neither is swallowed.
   */
  shouldPush(range: TimeRangeMs): boolean {
    if (this.stale) {
      if (rangesEqual(range, this.stale)) {
        return false;
      }
      this.stale = null;
    }
    return !rangesEqual(range, this.pushed);
  }

  /**
   * Records a push that landed.
   *
   * `settled` is what the map holds afterwards, read back after the dispatch —
   * not `requested`. A push that could not run records nothing, so it stays
   * pending and retries once a dataset with a time column arrives.
   */
  recordPush(requested: TimeRangeMs, settled: TimeRangeMs | null): void {
    this.pushed = requested;
    this.mapRange = settled;
  }

  /**
   * The window to hand Grafana, or null when there is nothing to report.
   *
   * Always adopts `mapRange` as the new baseline, so a window that moved for a
   * reason other than a drag — the first sight of the data, or a re-clamp after
   * the query re-ran — is absorbed silently instead of being pushed back out.
   *
   * `dashboardRange` is what the dashboard reads right now, remembered so the
   * value it is about to stop reading cannot be pushed back at the map while the
   * report is in flight.
   */
  takeEmit(mapRange: TimeRangeMs | null, domain: TimeRangeMs | null, dashboardRange: TimeRangeMs): TimeRangeMs | null {
    const domainMoved = !this.seenDomain || !rangesEqual(domain, this.domain);
    this.domain = domain;
    this.seenDomain = true;

    const moved = !rangesEqual(mapRange, this.mapRange);
    this.mapRange = mapRange;

    if (domainMoved || !moved || !mapRange) {
      return null;
    }
    // Grafana is about to hold this window, so it must not be pushed back —
    // neither once it arrives, nor in the gap before it does.
    this.pushed = mapRange;
    this.stale = dashboardRange;
    return mapRange;
  }
}
