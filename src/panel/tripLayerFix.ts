/**
 * A repair for kepler.gl's Trip layer, which cannot be filtered.
 *
 * kepler's GPU filter reads a layer's values through an accessor it calls as
 * `getData(dataContainer, feature, fieldIndex)` (`gpu-filter-utils.ts`). Every
 * layer supplies one with that shape — except the Trip layer in its `table`
 * column mode, whose `_getColumnModeValueAccessor` is a class field taking the
 * feature *alone*:
 *
 * ```js
 * _getColumnModeValueAccessor = feature => field => { … feature.properties.index … }
 * ```
 *
 * Called with three arguments, the data container lands in `feature`, and a
 * DataContainer has no `properties` — so deck.gl throws
 * `TripsLayer … Cannot read properties of undefined (reading 'index')`, disables
 * the layer and the trail vanishes.
 *
 * The trigger is any GPU-filterable filter on the dataset, which in this plugin
 * means the time filter: `timeSync` defaults to driving the map from the
 * dashboard range, so the plugin's headline feature — a trajectory query
 * becoming an animated Trip layer — broke the moment it was used as documented.
 * Categorical filters are unaffected because kepler filters those on the CPU and
 * never reaches this accessor.
 *
 * This is upstream, in kepler.gl 3.3.0-alpha.7, not in the panel. Rather than
 * give up the time filter — CPU filtering would cost a re-scan of every row on
 * each frame of a playing time slider — the layer class is wrapped so the
 * accessor takes the argument kepler actually passes it. Delete this module when
 * the pin moves to a kepler.gl that has fixed it; the provisioned `dashboard`
 * and `layers` dashboards show the error again the moment it stops working.
 */

/** The one member of kepler's Trip layer this touches. */
interface TripLayerLike {
  _getColumnModeValueAccessor?: unknown;
}

/**
 * The shape kepler's GPU filter calls a layer's value accessor with —
 * `getData(dataContainer, feature, fieldIndex)` in `gpu-filter-utils.ts`.
 *
 * Exported for the test: the whole defect is an arity mismatch, so the contract
 * being repaired against is worth naming rather than repeating as a cast.
 */
export type GpuFilterValueAccessor = (dataContainer: unknown, feature: unknown, fieldIndex: number) => unknown;

// The usual mixin constructor type. `any[]` rather than `unknown[]` on purpose:
// constructor parameters are checked contravariantly, so `unknown[]` would reject
// every concrete class — including kepler's own, whose constructor takes props.
type Constructor<T> = new (...args: any[]) => T;

/**
 * Wraps a Trip layer class so its table-mode value accessor accepts the
 * `(dataContainer, feature, fieldIndex)` call kepler's GPU filter makes.
 *
 * A class rather than a mutated instance because kepler builds its layers itself
 * and formats their data in the same reducer pass: by the time the panel could
 * reach an instance, the broken accessor has already been handed to deck.gl.
 *
 * Deliberately a no-op when the field is absent, so an upstream rename cannot
 * take the map down — it resurfaces as the original deck.gl error instead, which
 * the provisioned dashboards make visible.
 */
export function withTripGpuFilterFix<C extends Constructor<object>>(TripLayer: C): C {
  class TripLayerWithFilterFix extends (TripLayer as Constructor<TripLayerLike>) {
    constructor(...args: unknown[]) {
      super(...args);

      const accessor = this._getColumnModeValueAccessor;
      if (typeof accessor !== 'function') {
        return;
      }

      // kepler passes (dataContainer, feature, fieldIndex); the accessor wants
      // the feature. The data container is genuinely unused — the feature
      // carries its own materialised `values`.
      this._getColumnModeValueAccessor = (_dataContainer: unknown, feature: unknown) => accessor(feature);
    }
  }

  return TripLayerWithFilterFix as unknown as C;
}
