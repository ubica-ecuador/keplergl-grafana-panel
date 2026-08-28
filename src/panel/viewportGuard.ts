import type { SavedMapConfig } from '../data/mapConfig';
import type { MapBounds } from './keplerAdapter';

/**
 * Decides when the load-window guard restores the map's intended viewport.
 *
 * kepler 3.x localises the view state in a React context
 * (`MapViewStateContext`), seeded with the mapState at mount time — the
 * default, since the map mounts before any data or config. A debounced
 * propagate (`_onViewportChangePropagateDebounced`) writes that internal
 * state back into Redux whenever deck emits a view-state change, and on load
 * that echo lands *after* `addDataToMap` merged the saved viewport —
 * overwriting it with kepler's default. Upstream knows the class of bug (the
 * globe code comments on deck "re-seeding from the stale value"); from the
 * outside the deterministic cure is to watch the load window and put the
 * intended viewport back whenever the map lands exactly on the default
 * triple. Free of kepler, React and the store so the rules can be tested
 * with literal values.
 */

/** What the saved config wants the map to show. */
export interface SavedViewport {
  latitude: number;
  longitude: number;
  zoom: number;
  bearing?: number;
  pitch?: number;
}

/** kepler's `INITIAL_MAP_STATE` triple — the fingerprint of the clobber. */
const KEPLER_DEFAULT = { latitude: 37.75043, longitude: -122.34679, zoom: 9 };

/**
 * How long after a rebuild the guard keeps watching.
 *
 * Bounded by how late kepler's echo can be, which is not a constant: the write
 * back is debounced off deck's view-state changes, and deck emits one when the
 * map finishes its first real render. On a machine rendering WebGL in software
 * — CI, and the e2e suite — that has been measured at seven seconds after the
 * data landed, which a six-second window missed by a second: the map framed
 * itself on the data, then silently returned to San Francisco.
 *
 * The window is not what makes the guard safe. It only ever acts on a viewport
 * that is *exactly* kepler's default triple, to a millionth of a degree, and
 * never more than `GUARD_MAX_ATTEMPTS` times — a map a user has framed
 * themselves does not match, and one they left on the default is put back where
 * the data is, which is what they asked for by having no saved viewport.
 */
export const GUARD_WINDOW_MS = 15_000;

/** How many restores the guard will attempt before standing down. */
export const GUARD_MAX_ATTEMPTS = 3;

const EPSILON = 1e-6;

/** Whether a viewport is exactly kepler's initial default (within float noise). */
export function isKeplerDefaultViewport(viewport: { latitude: number; longitude: number; zoom: number }): boolean {
  return (
    Math.abs(viewport.latitude - KEPLER_DEFAULT.latitude) < EPSILON &&
    Math.abs(viewport.longitude - KEPLER_DEFAULT.longitude) < EPSILON &&
    Math.abs(viewport.zoom - KEPLER_DEFAULT.zoom) < EPSILON
  );
}

/** The viewport a saved config carries, or null when it has none to defend. */
export function savedViewportOf(config: SavedMapConfig | null | undefined): SavedViewport | null {
  const mapState = (config as { config?: { mapState?: Record<string, unknown> } } | null | undefined)?.config
    ?.mapState;
  if (!mapState) {
    return null;
  }
  const { latitude, longitude, zoom, bearing, pitch } = mapState;
  if (typeof latitude !== 'number' || typeof longitude !== 'number' || typeof zoom !== 'number') {
    return null;
  }
  return {
    latitude,
    longitude,
    zoom,
    ...(typeof bearing === 'number' ? { bearing } : {}),
    ...(typeof pitch === 'number' ? { pitch } : {}),
  };
}

export type GuardAction =
  | { kind: 'restore'; viewport: SavedViewport }
  | { kind: 'fit'; bounds: MapBounds }
  | { kind: 'disarm' }
  | { kind: 'none' };

/**
 * What the guard should do about the mapState it just observed.
 *
 * Restores the saved viewport — or, on a config-less map that was meant to
 * centre on its data, re-fits the data bounds — but only while the window is
 * open and the attempts last: a map legitimately showing something else, or
 * one whose *saved* viewport is the default, is left alone. The bounded
 * window and attempts are what keep the guard from ever fighting the user.
 */
export function decideViewportGuard({
  elapsedMs,
  attempts,
  mapState,
  saved,
  bounds,
}: {
  /** Milliseconds since the rebuild armed the guard. */
  elapsedMs: number;
  /** Restores already performed under this arming. */
  attempts: number;
  /** The map's current viewport. */
  mapState: { latitude: number; longitude: number; zoom: number };
  /** The saved config's viewport, if any. */
  saved: SavedViewport | null;
  /** The data bounds to fit when there is no saved viewport. */
  bounds: MapBounds | null;
}): GuardAction {
  if (elapsedMs > GUARD_WINDOW_MS || attempts >= GUARD_MAX_ATTEMPTS) {
    return { kind: 'disarm' };
  }
  if (!isKeplerDefaultViewport(mapState)) {
    return { kind: 'none' };
  }
  if (saved) {
    return isKeplerDefaultViewport(saved) ? { kind: 'none' } : { kind: 'restore', viewport: saved };
  }
  return bounds ? { kind: 'fit', bounds } : { kind: 'none' };
}
