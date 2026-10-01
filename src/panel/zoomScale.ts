/**
 * Optional shrinking of a pixel-sized layer as the map zooms out. Off, the
 * layer keeps its pixel size at every zoom, as it always has. On, its pixel
 * sizes are multiplied by `2^((zoom − refZoom) · scale)`: at `scale` 1 they
 * halve per zoom level like a thing on the ground, at 0 they never change. They
 * never grow past the set size when zooming in, and never shrink below
 * `MIN_ZOOM_FACTOR`, so a symbol stays findable on a country-wide view.
 *
 * The same rule Plus's gauge follows, so the two read alike on one map.
 */
export interface ZoomScale {
  /** The zoom from which the layer shows its set size. */
  refZoom: number;
  /** 0 (no shrinking) to 1 (halves per zoom level). */
  scale: number;
}

export const MIN_ZOOM_FACTOR = 0.2;
export const DEFAULT_REF_ZOOM = 10;
export const DEFAULT_ZOOM_SCALE = 0.5;

export function zoomFactor(zoom: number | undefined, zoomScale: ZoomScale | null | undefined): number {
  if (!zoomScale || typeof zoom !== 'number' || !Number.isFinite(zoom)) {
    return 1;
  }
  const f = Math.pow(2, (zoom - zoomScale.refZoom) * zoomScale.scale);
  return Math.min(1, Math.max(MIN_ZOOM_FACTOR, f));
}

/**
 * The zoom each layer was last drawn at, for the settings' "use current zoom"
 * button: kepler hands the layer configurator no map state, but the layer sees
 * it on every render.
 */
const lastZoom = new Map<string, number>();

export function noteZoom(layerId: string, zoom: number | undefined): void {
  if (typeof zoom === 'number' && Number.isFinite(zoom)) {
    lastZoom.set(layerId, zoom);
  }
}

export function currentZoomOf(layerId: string): number | null {
  const zoom = lastZoom.get(layerId);
  return zoom === undefined ? null : Math.round(zoom * 10) / 10;
}
