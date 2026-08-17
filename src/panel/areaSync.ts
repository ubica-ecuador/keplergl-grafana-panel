import { geoJsonToWkt } from '../data/geoJsonToWkt';
import type { DrawnArea } from './keplerAdapter';

/**
 * Decides when the figure drawn on the map reaches the dashboard variable.
 *
 * One direction only — map to variable. The variable is for the *other*
 * panels: a `WHERE` that references it must never appear in this panel's own
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
