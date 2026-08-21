import type { VariableMapping } from './variableSync';

/**
 * Decides when the map centres itself on its lat/lng variable pair.
 *
 * The read-back direction of the coordinate channel: a table row's data link,
 * a textbox, a shared URL — anything that writes the pair from outside the
 * map — moves the viewport there. Free of kepler, React and @grafana/runtime
 * so the rules can be tested with literal values.
 *
 * Two silences carry the design:
 *
 * - **The echo.** The coordinate channel writes the map's own clicks into the
 *   same pair, and centring on those would make the map jump under the
 *   pointer. A pair that matches the map's pinned coordinate — at the six
 *   decimals that channel writes — is the map talking to itself.
 * - **The stale pair.** Any variable change re-runs the reconcile; jumping
 *   back to a pair the hook already centred on would fight the user's own
 *   panning. `lastCentered` is the key of the last pair *seen* (acted on or
 *   suppressed), recorded by the caller from `key`.
 * - **The restore.** A saved viewport lands moments after mount, and centring
 *   into that race leaves the map somewhere neither the config nor the link
 *   asked for. So a first pass with a viewport to restore only adopts.
 *   Without one there is nothing to race and the pair is the map's only
 *   instruction — which is the case that matters when a drill-down opens a
 *   panel that mounts with the pair already in the URL, so that first pass
 *   centres like any other.
 */

export interface CenterDecision {
  /** `[lat, lng]` to centre on, or null to stay put. */
  target: [number, number] | null;
  /** The pair's identity to record as `lastCentered`; undefined if no pair. */
  key: string | undefined;
}

export function decideCenter({
  variableValues,
  mapping,
  pinned,
  lastCentered,
  adoptOnly,
}: {
  /** variable name → the value it currently holds (from the URL). */
  variableValues: Record<string, unknown>;
  /** The center mapping: `variable` is the latitude, `variableTo` the longitude. */
  mapping: VariableMapping;
  /** The map's own pinned coordinate, kepler's `[lng, lat]`; null/undefined if none. */
  pinned: [number, number] | null | undefined;
  /** The key of the last pair this decision saw, or undefined on the first pass. */
  lastCentered: string | undefined;
  /**
   * The map is mounting *and* has a saved viewport waiting to be restored, so
   * this pass only records the pair. See the note on the third silence below.
   */
  adoptOnly?: boolean;
}): CenterDecision {
  if (!mapping.variable || !mapping.variableTo) {
    return { target: null, key: undefined };
  }
  const lat = parseCoord(variableValues[mapping.variable]);
  const lng = parseCoord(variableValues[mapping.variableTo]);
  if (lat === null || lng === null) {
    return { target: null, key: undefined };
  }

  const key = `${round6(lat)},${round6(lng)}`;
  if (adoptOnly) {
    return { target: null, key };
  }
  if (key === lastCentered) {
    return { target: null, key };
  }
  if (pinned && round6(pinned[1]) === round6(lat) && round6(pinned[0]) === round6(lng)) {
    return { target: null, key };
  }
  return { target: [lat, lng], key };
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/** A coordinate from whatever the variable holds; null for every "no value" form. */
function parseCoord(raw: unknown): number | null {
  // Grafana repeats a variable in the URL when it is multi-value; a coordinate
  // is single-valued, so the first entry is the one that means anything.
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
