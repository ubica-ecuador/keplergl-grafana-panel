/**
 * The rules of the markers layer: reference points on the map that the user
 * drags, each bound to a pair of dashboard variables.
 *
 * The variables are the source of truth. Dragging a marker writes its pair once,
 * on release — one write per gesture, so a query hanging off the pair (an
 * isochrone service, say) runs once rather than on every pointer move. A pair
 * changed from outside — a textbox, a shared link — moves the marker. The
 * position the layer carries in `visConfig` is only the last one seen, which is
 * what a marker falls back to when its variables hold nothing.
 *
 * Free of kepler, deck, React and @grafana/runtime, so every rule is tested
 * with literal values.
 */

/** `[lng, lat]`, as deck and kepler spell a position. */
export type LngLat = [number, number];

export interface MarkerSpec {
  /** Stable within the layer; what a drop names. */
  id: string;
  /** Drawn beside the marker. */
  label: string;
  color: [number, number, number];
  /** The variable that receives the latitude. Empty publishes nothing. */
  latVariable: string;
  /** The variable that receives the longitude. Empty publishes nothing. */
  lngVariable: string;
  /** Last known position; null until the marker has been placed. */
  position: LngLat | null;
}

/** Colours handed to new markers in turn: distinct on light and dark basemaps. */
export const MARKER_COLORS: Array<[number, number, number]> = [
  [230, 57, 70],
  [29, 110, 204],
  [42, 157, 74],
  [240, 150, 0],
  [130, 70, 180],
];

/** Six decimals: ~0.1 m, the same rounding the coordinate channel uses. */
export function roundCoordinate(value: number): string {
  return String(Math.round(value * 1e6) / 1e6);
}

function isLngLat(value: unknown): value is LngLat {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1]) &&
    Math.abs(value[1] as number) <= 90
  );
}

function isColor(value: unknown): value is [number, number, number] {
  return Array.isArray(value) && value.length >= 3 && value.slice(0, 3).every((c) => Number.isFinite(c));
}

/**
 * The markers a layer's `visConfig` holds, cleaned up.
 *
 * A saved dashboard is hand-editable JSON, so nothing here trusts its shape:
 * an entry without an id is dropped, and every other field falls back to
 * something drawable.
 */
export function readMarkers(visConfig: Record<string, unknown> | undefined): MarkerSpec[] {
  const raw = visConfig?.markers;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
    .filter((entry) => typeof entry.id === 'string' && entry.id !== '')
    .map((entry, index) => ({
      id: entry.id as string,
      label: typeof entry.label === 'string' ? entry.label : '',
      color: isColor(entry.color)
        ? ([entry.color[0], entry.color[1], entry.color[2]] as [number, number, number])
        : MARKER_COLORS[index % MARKER_COLORS.length],
      latVariable: typeof entry.latVariable === 'string' ? entry.latVariable.trim() : '',
      lngVariable: typeof entry.lngVariable === 'string' ? entry.lngVariable.trim() : '',
      position: isLngLat(entry.position) ? [entry.position[0], entry.position[1]] : null,
    }));
}

/** A new marker for the layer panel: the next free id, letter and colour. */
export function newMarker(existing: MarkerSpec[]): MarkerSpec {
  const ids = new Set(existing.map((marker) => marker.id));
  let n = existing.length + 1;
  while (ids.has(`m${n}`)) {
    n++;
  }
  const index = existing.length;
  return {
    id: `m${n}`,
    label: String.fromCharCode(65 + (index % 26)),
    color: MARKER_COLORS[index % MARKER_COLORS.length],
    latVariable: '',
    lngVariable: '',
    position: null,
  };
}

/** The list with one marker moved; the same list when there is no such marker. */
export function moveMarker(markers: MarkerSpec[], id: string, position: LngLat): MarkerSpec[] {
  return markers.map((marker) => (marker.id === id ? { ...marker, position } : marker));
}

function numberOf(value: unknown): number {
  const single = Array.isArray(value) ? value[0] : value;
  if (single === undefined || single === null || single === '') {
    return NaN;
  }
  return Number(single);
}

/**
 * What a drop writes: variable name → value, empty to touch nothing.
 *
 * A variable already holding the value (numerically) is left alone, so a
 * marker dropped where it was picked up triggers no query.
 */
export function dropWrites(
  marker: Pick<MarkerSpec, 'latVariable' | 'lngVariable'>,
  position: LngLat,
  readVariable: (name: string) => unknown
): Record<string, string> {
  const writes: Record<string, string> = {};
  const add = (name: string, value: number) => {
    if (!name || !Number.isFinite(value)) {
      return;
    }
    const rounded = roundCoordinate(value);
    if (numberOf(readVariable(name)) !== Number(rounded)) {
      writes[`var-${name}`] = rounded;
    }
  };
  add(marker.latVariable, position[1]);
  add(marker.lngVariable, position[0]);
  return writes;
}

/** Close enough to be the same place: below the six decimals written. */
function samePosition(a: LngLat | null, b: LngLat | null): boolean {
  if (!a || !b) {
    return a === b;
  }
  return Math.abs(a[0] - b[0]) < 5e-7 && Math.abs(a[1] - b[1]) < 5e-7;
}

/**
 * The markers after reading their variables, or null when nothing moves.
 *
 * A marker whose pair holds a valid coordinate goes there. One whose pair is
 * empty or unset keeps its last position; one that has never had a position
 * is placed at `fallback` (the map's centre), so a marker just added in the
 * layer panel appears where the user is looking instead of nowhere.
 *
 * Null rather than an equal copy is what lets the caller subscribe to the store
 * without looping: it dispatches only when something actually changed.
 */
export function reconcileMarkers(
  markers: MarkerSpec[],
  readVariable: (name: string) => unknown,
  fallback: LngLat | null
): MarkerSpec[] | null {
  let changed = false;
  const next = markers.map((marker) => {
    const lat = marker.latVariable ? numberOf(readVariable(marker.latVariable)) : NaN;
    const lng = marker.lngVariable ? numberOf(readVariable(marker.lngVariable)) : NaN;
    const fromVariables: LngLat | null = isLngLat([lng, lat]) ? [lng, lat] : null;
    const target = fromVariables ?? marker.position ?? fallback;
    if (!target || samePosition(target, marker.position)) {
      return marker;
    }
    changed = true;
    return { ...marker, position: target };
  });
  return changed ? next : null;
}

/** `[west, south, east, north]` around the placed markers, or null with none. */
export function markerBounds(markers: MarkerSpec[]): [number, number, number, number] | null {
  const placed = markers.map((marker) => marker.position).filter((p): p is LngLat => p !== null);
  if (placed.length === 0) {
    return null;
  }
  const lngs = placed.map((p) => p[0]);
  const lats = placed.map((p) => p[1]);
  return [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)];
}
