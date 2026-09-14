import { sampleWindField, WindField } from './buildWindField';
import type { ScreenCamera } from './traceStreamlines';

/**
 * Where the symbols of a vector field go.
 *
 * Two answers, and the layer lets the user choose. On a grid of the screen, like
 * Esri's `symbolTileSize`: the same density at every zoom, with values
 * interpolated between the samples. Or on the data's own nodes: exactly the
 * samples the query returned, crowding as the map zooms out.
 */

/** One symbol's place and the velocity there. */
export interface PlacedVector {
  lng: number;
  lat: number;
  u: number;
  v: number;
  speed: number;
}

/**
 * A symbol in the middle of every `spacingPx` cell of the screen.
 *
 * Asked of the camera pixel by pixel, the way the flow field seeds, so a tilted
 * map spaces its symbols evenly on screen rather than on the ground. Pixels that
 * show sky, and ground outside the field or over a hole, get none.
 */
export function onScreenGrid(field: WindField, camera: ScreenCamera, spacingPx: number): PlacedVector[] {
  const spacing = Math.max(1, spacingPx);
  const placed: PlacedVector[] = [];
  for (let y = spacing / 2; y < camera.heightPx; y += spacing) {
    for (let x = spacing / 2; x < camera.widthPx; x += spacing) {
      const ground = camera.unproject(x, y);
      if (!ground) {
        continue;
      }
      const velocity = sampleWindField(field, ground[0], ground[1]);
      if (!velocity) {
        continue;
      }
      const [u, v] = velocity;
      placed.push({ lng: ground[0], lat: ground[1], u, v, speed: Math.hypot(u, v) });
    }
  }
  return placed;
}

/** A symbol on every node of the lattice that carries a velocity; holes get none. */
export function onDataCells(field: WindField): PlacedVector[] {
  const placed: PlacedVector[] = [];
  for (let row = 0; row < field.rows; row++) {
    for (let column = 0; column < field.columns; column++) {
      const k = 2 * (row * field.columns + column);
      const u = field.data[k];
      const v = field.data[k + 1];
      if (!Number.isFinite(u) || !Number.isFinite(v)) {
        continue;
      }
      placed.push({
        lng: field.west + column * field.stepLon,
        lat: field.south + row * field.stepLat,
        u,
        v,
        speed: Math.hypot(u, v),
      });
    }
  }
  return placed;
}

/** The compass bearing a velocity points to: degrees clockwise from north, in [0, 360). */
export function bearingOf(u: number, v: number): number {
  return ((Math.atan2(u, v) * 180) / Math.PI + 360) % 360;
}
