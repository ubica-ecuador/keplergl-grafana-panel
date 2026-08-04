/**
 * Pure helpers for publishing the map's time filter as dashboard variables.
 *
 * This is the alternative to moving the dashboard time range from the map. A
 * range change re-runs every query, and — the part that actually hurts — the
 * rows outside the new window leave the browser, so the time widget's histogram
 * rescales under the cursor and the window can never be widened again from the
 * map. Variables cost only the panels that reference them, and the map's own
 * query keeps using `$__timeFilter`, so its dataset is never invalidated by its
 * own brush: the histogram stays whole and the brush is a pure mask.
 *
 * Free of kepler, React and @grafana/runtime so it can be unit-tested with plain
 * objects, the same as `variableSync.ts`. The hook (`useTimeVariableSync`) reads
 * real filter state through this and writes the variables.
 */

import type { TimeRangeMs } from './timeSync';

/** The two dashboard variables that carry the map's time window. */
export interface TimeVariableMapping {
  /** Variable holding the start of the window. Empty means "not configured". */
  from: string;
  /** Variable holding the end of the window. */
  to: string;
}

/**
 * Epoch milliseconds as a UTC ISO 8601 string.
 *
 * ISO rather than epoch because the target is a SQL `timestamptz`: the value
 * drops straight into `WHERE t >= '$mapFrom'::timestamptz` with no arithmetic,
 * and it is legible in the URL and in a shared dashboard link.
 */
export function formatTimeValue(ms: number): string {
  return new Date(Math.round(ms)).toISOString();
}

/**
 * Epoch milliseconds from whatever a variable happens to hold.
 *
 * Accepts what this module writes (ISO), what a user might type by hand (any
 * `Date`-parseable string, epoch ms as a number or a numeric string), and
 * returns null for every "no value" form so the caller can treat an unset or
 * `All` variable as "no window".
 */
export function parseTimeValue(raw: unknown): number | null {
  // Grafana repeats a variable in the URL when it is multi-value; a time bound
  // is single-valued, so the first entry is the one that means anything.
  const value = Array.isArray(raw) ? raw[0] : raw;

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed === '' || trimmed === ALL_VALUE) {
    return null;
  }
  // `Date.parse` rejects a bare epoch, so digits are read as milliseconds.
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed);
  }

  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? null : parsed;
}

/** Grafana's sentinel for a variable's "All" selection. */
const ALL_VALUE = '$__all';

/**
 * The window the variables currently describe, or null when they describe none.
 *
 * Both ends must be present and ordered: a half-set or inverted pair is treated
 * as no window rather than as a filter that hides everything.
 */
export function readWindowFromVariables(
  values: Record<string, unknown>,
  mapping: TimeVariableMapping
): TimeRangeMs | null {
  if (!mapping.from || !mapping.to) {
    return null;
  }

  const from = parseTimeValue(values[mapping.from]);
  const to = parseTimeValue(values[mapping.to]);
  if (from === null || to === null || from > to) {
    return null;
  }
  return { from, to };
}

/**
 * The value each mapped variable should hold, keyed by variable name.
 *
 * `window` is the time filter's current value and `domain` the data's full time
 * extent. The domain is the fallback so a map with no time filter yet — or one
 * whose brush covers everything, where kepler reports the two as equal anyway —
 * still publishes a usable pair: a consumer's `BETWEEN '$mapFrom' AND '$mapTo'`
 * never has to cope with a blank variable.
 */
export function timeVariableWrites(
  window: TimeRangeMs | null,
  domain: TimeRangeMs | null,
  mapping: TimeVariableMapping
): Record<string, string> {
  const range = window ?? domain;
  if (!range) {
    return {};
  }

  const writes: Record<string, string> = {};
  if (mapping.from) {
    writes[mapping.from] = formatTimeValue(range.from);
  }
  if (mapping.to) {
    writes[mapping.to] = formatTimeValue(range.to);
  }
  return writes;
}

/** The key standing for "no window at all". */
const NO_WINDOW = 'NONE';

/** Which side, if either, should be moved to match the other. */
export type TimeSyncDirection = 'none' | 'toMap' | 'toVariables';

/**
 * Which way a difference between the map and the variables should travel.
 *
 * `lastKey` is the window both sides last agreed on. Whichever side no longer
 * matches it is the one the user moved, and it drives the other — the same
 * one-slot memory `useVariableSync` uses to cut the echo, minus the guesswork:
 * the side that still equals the last agreement cannot be the side that changed.
 *
 * On the very first pass there is no agreement to compare against, so variables
 * that already carry a window win. That is what makes a shared dashboard link
 * or a preset restore the brush instead of immediately overwriting it.
 */
export function decideTimeSync(mapKey: string, varKey: string, lastKey: string | undefined): TimeSyncDirection {
  if (mapKey === varKey) {
    return 'none';
  }
  if (lastKey === undefined) {
    return varKey === NO_WINDOW ? 'toVariables' : 'toMap';
  }
  // The map still sits where we left it, so the variables are what moved.
  // Anything else — including both sides moving — is the map's to publish.
  return mapKey === lastKey ? 'toMap' : 'toVariables';
}

/**
 * A canonical key for a window, shared by both sync directions so neither
 * echoes the other.
 *
 * Rounded to the millisecond the variables are written at: kepler clamps a
 * window to the data's own domain and can hand back a fractional bound, which
 * would otherwise read as a fresh local change every pass and bounce forever.
 */
export function windowKey(range: TimeRangeMs | null): string {
  return range ? `${Math.round(range.from)}-${Math.round(range.to)}` : NO_WINDOW;
}
