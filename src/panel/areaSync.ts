import { geoJsonToWkt } from '../data/geoJsonToWkt';
import { wktToGeoJson, type ArealGeometry } from '../data/wktToGeoJson';
import type { DrawnArea } from './keplerAdapter';

/**
 * Decides when the figure drawn on the map reaches the dashboard variable.
 *
 * Map to variable here; `decideAreaInbound` below is the way back. The
 * variable is for the *other* panels: a `WHERE` that references it must never
 * appear in this panel's own
 * query, or drawing a shape would shrink the map's own dataset and the shape
 * could never be widened again (the ratchet the cross-filtering design doc
 * warns about).
 *
 * Free of kepler, React and @grafana/runtime so the publish rules can be
 * tested with literal features. The WKT doubles as the change fingerprint and
 * the publish payload: comparing serialized output is what makes a figure's
 * silent migration from `editor.features` into a polygon filter — same id,
 * same geometry, different home — read as "nothing happened".
 */

/** id → WKT for every figure that serializes; the rest do not count. */
export function areaFingerprints(candidates: DrawnArea[]): Record<string, string> {
  const fingerprints: Record<string, string> = {};
  for (const { id, geometry } of candidates) {
    const wkt = geoJsonToWkt(geometry);
    if (wkt !== null) {
      fingerprints[id] = wkt;
    }
  }
  return fingerprints;
}

export type AreaDecision = { action: 'publish'; id: string; wkt: string } | { action: 'clear' } | { action: 'none' };

interface AreaState {
  candidates: DrawnArea[];
  /**
   * id → fingerprint last observed, or null on the very first pass — which is
   * dashboard load, where a saved config may restore figures. Publishing then
   * would overwrite the value a shared link arrived with, so the first pass
   * only ever adopts.
   */
  lastSeen: Record<string, string> | null;
  /** The figure currently in the variable, or null. */
  publishedId: string | null;
}

/**
 * What this pass should do to the variable.
 *
 * kepler keeps no timestamps on features, so "most recent" is positional: the
 * candidates arrive in a deterministic order (filters first, editor features
 * last — see `readDrawnAreas`) and the last new-or-changed one wins.
 */
export function decideAreaPublish({ candidates, lastSeen, publishedId }: AreaState): AreaDecision {
  const fingerprints = areaFingerprints(candidates);

  if (lastSeen === null) {
    return { action: 'none' };
  }

  // Newest change wins: walk backwards and take the first figure that is new
  // or whose geometry moved.
  for (const { id } of [...candidates].reverse()) {
    const wkt = fingerprints[id];
    if (wkt !== undefined && lastSeen[id] !== wkt) {
      return { action: 'publish', id, wkt };
    }
  }

  // The published figure is gone: hand the variable to the latest remaining
  // figure, or clear it when none is left.
  if (publishedId !== null && fingerprints[publishedId] === undefined) {
    for (const { id } of [...candidates].reverse()) {
      const wkt = fingerprints[id];
      if (wkt !== undefined) {
        return { action: 'publish', id, wkt };
      }
    }
    return { action: 'clear' };
  }

  return { action: 'none' };
}

export type AreaInbound =
  { action: 'none' } | { action: 'clear' } | { action: 'draw'; geometry: ArealGeometry; wkt: string };

interface InboundState {
  /** The variable's value in the URL now; undefined when the URL does not carry it. */
  value: string | undefined;
  /** Its value on the previous look, or null on the first one (dashboard load). */
  previous: string | undefined | null;
  /** id → WKT of the figures on the map now. */
  fingerprints: Record<string, string>;
}

/**
 * What the map should do about a value that reached the variable from
 * elsewhere: a filters panel clearing it, a shared link, the back button.
 *
 * Only the variable's own changes count: other variables move the URL too (a
 * timeline playing writes its window at every step), and reading the area on
 * each of those would put back a figure the user is still drawing. A value
 * some figure on the map already carries is this panel's own write coming
 * back, or nothing new. An empty value removes the figures, except on load,
 * where a saved config's figures stay as they always did; a value that does
 * not parse leaves the map alone.
 *
 * Drawing it on the map does not feed it into this panel's query: it becomes
 * a kepler polygon filter, the same as a figure the user draws and applies.
 */
export function decideAreaInbound({ value, previous, fingerprints }: InboundState): AreaInbound {
  if (value === previous || value === undefined) {
    return { action: 'none' };
  }
  const drawn = Object.values(fingerprints);
  if (value.trim() === '') {
    return previous !== null && drawn.length > 0 ? { action: 'clear' } : { action: 'none' };
  }
  const geometry = wktToGeoJson(value);
  const wkt = geometry && geoJsonToWkt(geometry);
  if (!geometry || !wkt || drawn.includes(wkt)) {
    return { action: 'none' };
  }
  return { action: 'draw', geometry, wkt };
}
