import { WebMercatorViewport } from '@deck.gl/core';
import { TripsLayer } from '@deck.gl/geo-layers';

import type { CameraState } from './flowFieldLayer';
import type { ScreenCamera } from '../data/traceStreamlines';

/**
 * The deck.gl layer that draws the traced streamlines.
 *
 * Thin by design: the paths already carry their own timestamps, so all that is
 * left is a trail running along them. Kept apart from `flowFieldLayer.ts` so
 * that module stays free of deck imports and can be tested without loading the
 * whole graph, the way `zarrDeckLayer.ts` is kept apart from `zarrTileLayer.ts`.
 */

/**
 * The camera, as something the tracer can seed through.
 *
 * deck's own viewport is the right tool and the only honest one: working out
 * which ground a screen pixel shows means the same projection matrix deck draws
 * with, pitch and bearing and all, and a hand-rolled version of it would be a
 * second answer to a question that must have exactly one.
 *
 * One thing deck will not tell you: whether the pixel showed any ground at all.
 * `unproject` intersects the ray through a pixel with the ground plane, and a
 * ray pointing above the horizon never meets it — so deck solves for the
 * intersection *behind* the camera and returns that, at a plausible-looking
 * latitude. Projecting it back does not catch this: measured at pitch 85, deck
 * returns the original pixel for points it placed four degrees the wrong way.
 *
 * It does not arise today, and that is the reason there is no guard: kepler
 * clamps the pitch at 60, and at 60 the horizon is still above the top of the
 * screen — measured, the topmost row of pixels lands four degrees up-range, on
 * the ground. Should that clamp ever be lifted, the symptom to look for is lines
 * seeded behind the viewer, which is to say a field that thickens where the
 * camera is not looking.
 */
export function makeScreenCamera(camera: CameraState): ScreenCamera | null {
  if (!camera.width || !camera.height) {
    return null;
  }

  const viewport = new WebMercatorViewport({
    latitude: camera.latitude,
    longitude: camera.longitude,
    zoom: camera.zoom,
    pitch: camera.pitch,
    bearing: camera.bearing,
    width: camera.width,
    height: camera.height,
  });

  const groundAt = (x: number, y: number): [number, number] | null => {
    const [lng, lat] = viewport.unproject([x, y]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lat) > 85) {
      return null;
    }
    return [lng, lat];
  };

  // Sampled over the screen rather than taken from `viewport.getBounds()`, which
  // reads the four corners only. That is the same answer for a flat map and a
  // poorer one for a tilted map, where the widest ground is along the far edge
  // rather than at a corner.
  const bounds = sampledBounds(groundAt, camera.width, camera.height);
  if (!bounds) {
    return null;
  }

  return {
    widthPx: camera.width,
    heightPx: camera.height,
    bounds,
    metresPerPixel: viewport.metersPerPixel,
    unproject: groundAt,
  };
}

/** The ground a screen shows, from the pixels of it that show any. */
function sampledBounds(
  groundAt: (x: number, y: number) => [number, number] | null,
  width: number,
  height: number
): { west: number; south: number; east: number; north: number } | null {
  const steps = 8;
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  let found = 0;

  for (let row = 0; row <= steps; row++) {
    for (let column = 0; column <= steps; column++) {
      const at = groundAt((column / steps) * width, (row / steps) * height);
      if (!at) {
        continue;
      }
      found++;
      west = Math.min(west, at[0]);
      east = Math.max(east, at[0]);
      south = Math.min(south, at[1]);
      north = Math.max(north, at[1]);
    }
  }

  return found > 1 ? { west, south, east, north } : null;
}

/** Builds the trips layer, in the shape `makeFlowFieldLayer` asks for. */
export const buildFlowFieldDeckLayer = (props: Record<string, unknown>): unknown =>
  new TripsLayer({
    getPath: (line: { path: number[][] }) => line.path,
    // The fourth value of each vertex. deck reads a position as its first three
    // components and ignores the rest, so the timestamps ride along inside the
    // path rather than in a second array.
    getTimestamps: (line: { path: number[][] }) => line.path.map((vertex) => vertex[3]),
    // Pixels rather than metres: the whole visualisation is sized to the screen
    // — a fixed number of lines per screen, each a fixed number of pixels long —
    // and a width in metres would thicken as the user zooms in until the field
    // read as a solid sheet.
    widthUnits: 'pixels',
    capRounded: true,
    jointRounded: true,
    fadeTrail: true,
    ...props,
  } as never);
