import { Viewport } from '../data/traceStreamlines';
import type { CameraState } from './flowFieldLayer';

/** The slice of kepler's map state the viewport is derived from. */
export interface MapStateLike {
  latitude?: number;
  longitude?: number;
  zoom?: number;
  width?: number;
  height?: number;
  pitch?: number;
  bearing?: number;
}

/**
 * Web Mercator's world is a single tile at zoom 0, and deck.gl — and therefore
 * kepler — sizes that tile at 512 pixels. Using 256, the other common
 * convention, puts every extent out by a factor of two.
 */
const TILE_SIZE = 512;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

/** Latitude to Mercator y, in the same units as the x axis (i.e. radians of longitude). */
const mercatorY = (latitude: number) => Math.log(Math.tan(Math.PI / 4 + toRadians(latitude) / 2));

const inverseMercatorY = (y: number) => ((2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180) / Math.PI;

/**
 * Whether two map states describe the same view.
 *
 * Compared on the raw state rather than on the derived extent because this is
 * also what stops a feedback loop: pushing new rows changes the store, which
 * wakes the subscription again, which must then see an unchanged view and do
 * nothing.
 */
export function sameMapState(a: MapStateLike | null, b: MapStateLike | null): boolean {
  if (!a || !b) {
    return a === b;
  }
  return (
    a.latitude === b.latitude &&
    a.longitude === b.longitude &&
    a.zoom === b.zoom &&
    a.width === b.width &&
    a.height === b.height
  );
}

/**
 * Whether two map states describe the same *camera*, tilt and rotation included.
 *
 * Separate from `sameMapState` because the two have different jobs. What is
 * published to the dashboard variables is a bounding box, and a box does not
 * change when the camera merely tilts; what the flow field draws does, because
 * tilting turns a rectangle of ground into a trapezoid reaching for the horizon.
 * Comparing on the box is why tilting the map used to leave the field alone.
 */
export function sameCamera(a: MapStateLike | null, b: MapStateLike | null): boolean {
  if (!a || !b) {
    return a === b;
  }
  return sameMapState(a, b) && a.pitch === b.pitch && a.bearing === b.bearing;
}

/**
 * kepler's map state as a camera, or null before the map has a size.
 *
 * Barely a conversion — the numbers are kepler's own — but the validation is
 * the point: kepler reports a zero-sized map until its layout settles, and a
 * camera built from that projects every pixel to nowhere.
 */
export function cameraFromMapState(mapState: MapStateLike | null | undefined): CameraState | null {
  if (!mapState) {
    return null;
  }
  const { latitude, longitude, zoom, width, height, pitch, bearing } = mapState;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !Number.isFinite(zoom) || !width || !height) {
    return null;
  }
  return {
    latitude: latitude!,
    longitude: longitude!,
    zoom: zoom!,
    pitch: Number.isFinite(pitch) ? pitch! : 0,
    bearing: Number.isFinite(bearing) ? bearing! : 0,
    width,
    height,
  };
}

/**
 * Turns kepler's map state into the extent the streamlines should cover.
 *
 * Both halves of the result matter. The extent says where to seed, and the pixel
 * size sets how long a step is on screen — which together are what keeps the
 * line density and length steady as the user zooms, instead of thinning out
 * when they zoom in and matting together when they zoom out.
 */
export function viewportFromMapState(mapState: MapStateLike | null | undefined): Viewport | null {
  if (!mapState) {
    return null;
  }

  const { latitude, longitude, zoom, width, height } = mapState;

  // kepler reports a zero-sized map before the layout settles; dividing by that
  // yields an infinite extent, and every seed would land at NaN.
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !Number.isFinite(zoom) || !width || !height) {
    return null;
  }

  const worldPx = TILE_SIZE * Math.pow(2, zoom!);
  const halfLonSpan = ((width / worldPx) * 360) / 2;

  // The vertical span is uniform in Mercator y, not in latitude, so it has to be
  // measured there and converted back at the edges.
  const halfYSpan = ((height / worldPx) * 2 * Math.PI) / 2;
  const centreY = mercatorY(latitude!);

  return {
    west: longitude! - halfLonSpan,
    east: longitude! + halfLonSpan,
    south: inverseMercatorY(centreY - halfYSpan),
    north: inverseMercatorY(centreY + halfYSpan),
    widthPx: width,
    heightPx: height,
  };
}
