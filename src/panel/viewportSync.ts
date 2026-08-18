/**
 * Pure helpers for publishing the map's viewport as dashboard variables.
 *
 * The bbox of what the map is showing, as four numbers, so another panel can
 * answer "filter to what I am looking at":
 * `WHERE lng BETWEEN $west AND $east AND lat BETWEEN $south AND $north`.
 * Numbers rather than WKT on purpose — they carry no injection risk into a
 * consumer's SQL, unlike a free-text geometry.
 *
 * One way only, map to variables, and only for *other* panels. Filtering the
 * map's own query by its own viewport is a ratchet: zooming out cannot bring
 * the rows back, because the dataset no longer holds them. The option name
 * says so, and so does the README.
 *
 * Free of kepler, React and @grafana/runtime so the rules can be tested with
 * literal values.
 */

/** The dashboard variables the viewport's four edges are published to. */
export interface ViewportVariables {
  west?: string;
  south?: string;
  east?: string;
  north?: string;
}

/** The bbox of the current view, in EPSG:4326 degrees. */
export interface ViewportBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

/** Whether the panel names any variable for the viewport to drive. */
export function hasViewportVariables(variables: ViewportVariables | undefined): boolean {
  return Boolean(variables && (variables.west || variables.south || variables.east || variables.north));
}

/**
 * What this pass should write: variable name → value, empty to touch nothing.
 *
 * Every edge is rounded to six decimals (~0.1 m) and compared numerically
 * against what its variable already holds, so a view that has not really
 * moved writes nothing — the store wakes on every pointer move over the map,
 * and each write re-queries every panel that reads the pair.
 *
 * Coordinates are clamped to the ones that exist: zoomed far enough out the
 * computed span runs past the antimeridian and the poles, and no consumer
 * should be handed a longitude of -250.
 */
export function viewportVariableWrites({
  bounds,
  variables,
  variableValues,
}: {
  bounds: ViewportBounds | null;
  variables: ViewportVariables;
  /** variable name → the value it currently holds (from the URL). */
  variableValues: Record<string, unknown>;
}): Record<string, string> {
  if (!bounds) {
    return {};
  }
  const { west, south, east, north } = bounds;
  if (![west, south, east, north].every((v) => Number.isFinite(v))) {
    return {};
  }

  const writes: Record<string, string> = {};
  addWrite(writes, variables.west, clampLongitude(west), variableValues);
  addWrite(writes, variables.south, clampLatitude(south), variableValues);
  addWrite(writes, variables.east, clampLongitude(east), variableValues);
  addWrite(writes, variables.north, clampLatitude(north), variableValues);
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

const clampLongitude = (value: number) => Math.min(180, Math.max(-180, value));
const clampLatitude = (value: number) => Math.min(90, Math.max(-90, value));

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/** The number a variable currently holds, or NaN for every "no value" form. */
function currentNumber(raw: unknown): number {
  // Grafana repeats a variable in the URL when it is multi-value; an edge is
  // single-valued, so the first entry is the one that means anything.
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value !== 'string' || value.trim() === '') {
    return Number.NaN;
  }
  return Number(value);
}
