/**
 * kepler's GeoJSON layer, taught to draw a dataset's polygons as outlines when
 * its data source says they are where things lie rather than things
 * (`meta.custom.layer.outline`, `frameLayer.ts`): a catalog's coverage boxes.
 *
 * kepler fills every polygon layer it makes. Boxes from a catalog are large and
 * stacked — a dozen services over a country, each a box of it — and filled
 * they hide the base map and the layers under them in one tinted slab. As
 * outlines they say where each entry reaches and leave the map readable.
 *
 * Only the layer kepler makes for such a dataset changes, as it makes it
 * (`setInitialLayerConfig`, which kepler calls for a new layer and never for a
 * saved one): a saved map keeps what it saved, and the Fill switch turns the
 * fill back on. Points and lines are left as kepler draws them.
 *
 * Wrapped at the class, in the layer registry (`keplerStore.ts`), as the
 * finite-bounds repair is.
 */

type Constructor<T> = new (...args: any[]) => T;

interface InitialLayer {
  meta?: { featureTypes?: { polygon?: boolean } };
  setInitialLayerConfig(dataset: unknown): InitialLayer;
  updateLayerVisConfig(visConfig: Record<string, unknown>): InitialLayer;
}

/** Whether a kepler dataset's source asked for outlines (`metadata.outline`, set by `toKeplerDatasets`). */
export function wantsOutline(dataset: unknown): boolean {
  return (dataset as { metadata?: { outline?: unknown } } | null)?.metadata?.outline === true;
}

export function withOutline<C extends Constructor<object>>(LayerClass: C): C {
  class OutlineLayer extends (LayerClass as Constructor<InitialLayer>) {
    setInitialLayerConfig(dataset: unknown): InitialLayer {
      const layer = super.setInitialLayerConfig(dataset);
      return wantsOutline(dataset) && layer.meta?.featureTypes?.polygon
        ? layer.updateLayerVisConfig({ filled: false, stroked: true })
        : layer;
    }
  }
  return OutlineLayer as unknown as C;
}
