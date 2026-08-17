import type { VariableMapping } from './variableSync';

/**
 * Decides when the map coordinate clicked reaches the dashboard variables.
 *
 * One direction only, like the click sync, but the payload is the *place*
 * rather than any entity: a coordinate mapping's `variable` receives the
 * latitude and its `variableTo` the longitude, so a consuming panel writes
 * `ST_DWithin(geom, ST_MakePoint($lng, $lat)::geography, $radius)` — the
 * radius, and every spatial computation, belongs to the datasource. Free of
 * kepler, React and @grafana/runtime so the rules can be tested with literal
 * values.
 *
 * The tri-state `coordinate` mirrors kepler's `visState.mousePos.pinned`,
 * whose semantics the map-click spike established:
 *
 * - a `[lng, lat]` pair — the user pinned a spot (kepler's coordinate
 *   interaction stores the click there).
 * - `null` — the pin *toggles*: a second click unpins. That is not "the user
 *   wants no coordinate" in this channel's terms — the variables keep the
 *   last pinned spot, and the coverage query its centre, until the user pins
 *   somewhere else.
 * - `undefined` — no pin state at all: initial, or an entry reset. Never a
 *   gesture, never written.
 */

/** kepler's pinned coordinate, `[lng, lat]`; null an unpin; undefined no state. */
export type PinnedCoordinate = [number, number] | null | undefined;

/**
 * What this pass should write: variable name → value, empty to touch nothing.
 *
 * Values are rounded to six decimals (~0.1 m) so a pin does not smear picking
 * noise into the URL, and the comparison against what a variable already
 * holds is numeric — a re-pin on the same spot stays quiet whatever format
 * the URL carries.
 */
export function coordinateWrites({
  coordinate,
  mappings,
  variableValues,
}: {
  coordinate: PinnedCoordinate;
  /** The coordinate mappings only — see `partitionMappings`. */
  mappings: VariableMapping[];
  /** variable name → the value it currently holds (from the URL). */
  variableValues: Record<string, unknown>;
}): Record<string, string> {
  if (!coordinate) {
    return {};
  }
  const [lng, lat] = coordinate;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
    return {};
  }

  const writes: Record<string, string> = {};
  for (const mapping of mappings) {
    addWrite(writes, mapping.variable, lat, variableValues);
    addWrite(writes, mapping.variableTo, lng, variableValues);
  }
  return writes;
}

function addWrite(
  writes: Record<string, string>,
  variable: string | undefined,
  value: number,
  variableValues: Record<string, unknown>
): void {
  if (!variable) {
    return;
  }
  const next = round6(value);
  if (round6(currentNumber(variableValues[variable])) !== next) {
    writes[variable] = String(next);
  }
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/** The number a variable currently holds, or NaN for every "no value" form. */
function currentNumber(raw: unknown): number {
  // Grafana repeats a variable in the URL when it is multi-value; a coordinate
  // is single-valued, so the first entry is the one that means anything.
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value !== 'string' || value.trim() === '') {
    return Number.NaN;
  }
  return Number(value);
}
