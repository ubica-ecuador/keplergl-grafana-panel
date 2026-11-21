import type { MapBounds } from './keplerAdapter';

/**
 * kepler's GeoJSON and Trip layers, taught that a layer with nothing to show
 * has no bounds.
 *
 * Both measure their features with turf's `bbox`, which answers
 * `[Infinity, Infinity, -Infinity, -Infinity]` for no features at all: a
 * query that returned no rows (a GeoParquet read by an area holding nothing),
 * or rows whose geometry is empty or missing. kepler keeps that as the layer's
 * bounds, and its centring on the data merges every layer's bounds starting
 * from the world's edges, so a map whose only layer has those infinite bounds
 * is framed on an inverted world, `[180, 90, -180, -90]`, whose middle is
 * latitude 0, longitude 0. The panel's own fits on the data (the viewport
 * guard, the fit on variables) read the same bounds and gave kepler the
 * infinite box, which it refuses with "invalid map bounds provided".
 *
 * With null bounds the layer is left out of every fit, as kepler's point layers
 * already leave themselves out when they have no coordinates, and a map with
 * nothing to fit stays where it is.
 *
 * Wrapped at the class, in the layer registry (`keplerStore.ts`), as the WMS
 * and tile layers are.
 */

type Constructor<T> = new (...args: any[]) => T;

interface MetaLayer {
  updateMeta(meta: Record<string, unknown>): void;
}

/** Whether bounds frame something: four finite numbers, west to east and south to north. */
export function isFiniteBounds(bounds: unknown): bounds is MapBounds {
  return (
    Array.isArray(bounds) &&
    bounds.length === 4 &&
    bounds.every((n) => typeof n === 'number' && Number.isFinite(n)) &&
    bounds[0] <= bounds[2] &&
    bounds[1] <= bounds[3]
  );
}

export function withFiniteBounds<C extends Constructor<object>>(LayerClass: C): C {
  class FiniteBoundsLayer extends (LayerClass as Constructor<MetaLayer>) {
    updateMeta(meta: Record<string, unknown>): void {
      super.updateMeta(
        meta && 'bounds' in meta && meta.bounds != null && !isFiniteBounds(meta.bounds)
          ? { ...meta, bounds: null }
          : meta
      );
    }
  }
  return FiniteBoundsLayer as unknown as C;
}
