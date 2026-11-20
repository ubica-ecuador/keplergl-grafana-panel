/**
 * Tile rasters handed to MapLibre on a relief base map.
 *
 * MapLibre lays its own raster layers on its terrain: it paints them, with the
 * other flat layers, into a texture per terrain tile and draws the terrain mesh
 * with it (`render_to_texture.ts`, `LAYERS_TO_TEXTURES`). A tile template the
 * panel would draw with deck — XYZ tiles, TiTiler's Zarr tiles, both finished
 * pictures — can be one of those layers instead: on the relief it lies on the
 * very mesh the base map lies on, MapLibre asks for coarser tiles far off under
 * a pitched camera, and deck draws nothing for it. That is how GeoLibre draws
 * its rasters over MapLibre's terrain.
 *
 * What it costs: the layer is drawn in MapLibre's canvas, so it lies under every
 * deck layer, whatever kepler's order says (above the base map, as before).
 *
 * A deck layer offers itself with `reliefTiles`, a MapLibre tile template
 * (`{z}/{x}/{y}`, `{y}` counted from the south with `reliefScheme: 'tms'`); its
 * `opacity`, `visible`, `minZoom`, `maxZoom` and `tileSize` say the rest, and
 * `reliefBounds` where it has data (a WMS's box, `wmsExtent.ts`).
 */

/** One raster as MapLibre draws it. */
export interface NativeRaster {
  /** The deck layer's id, which names the MapLibre source and layer. */
  id: string;
  tiles: string[];
  scheme: 'xyz' | 'tms';
  tileSize: number;
  minzoom?: number;
  maxzoom?: number;
  /** Where the source has tiles, `[west, south, east, north]`: MapLibre asks for none outside. */
  bounds?: [number, number, number, number];
  opacity: number;
  visible: boolean;
}

/** The MapLibre map, as far as adding raster layers to it goes. */
export interface RasterMap {
  getSource(id: string): unknown;
  addSource(id: string, source: Record<string, unknown>): unknown;
  removeSource(id: string): unknown;
  getLayer(id: string): unknown;
  addLayer(layer: Record<string, unknown>): unknown;
  removeLayer(id: string): unknown;
  moveLayer(id: string, beforeId?: string): unknown;
  getLayersOrder?(): string[];
  getPaintProperty(layer: string, name: string): unknown;
  setPaintProperty(layer: string, name: string, value: unknown): unknown;
  getLayoutProperty(layer: string, name: string): unknown;
  setLayoutProperty(layer: string, name: string, value: unknown): unknown;
}

/** The prefix of the sources and layers the panel adds, so they are never confused with the base map's. */
export const NATIVE_PREFIX = 'kepler-relief-raster-';

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * A template on the page's own origin (`/titiler/...`) made whole, as deck's loader
 * would read it. Not through `URL`, which would write `{z}` as `%7Bz%7D`.
 */
export function absoluteTemplate(template: string, location?: { protocol: string; origin: string }): string {
  const page = location ?? (typeof window === 'undefined' ? undefined : window.location);
  if (!page || /^[a-z][a-z0-9+.-]*:/i.test(template)) {
    return template;
  }
  if (template.startsWith('//')) {
    return `${page.protocol}${template}`;
  }
  return template.startsWith('/') ? `${page.origin}${template}` : template;
}

/** The raster a deck layer offers to MapLibre, or null when it offers none. */
export function nativeRasterOf(layer: unknown): NativeRaster | null {
  const props = (layer as { props?: Record<string, unknown> } | null)?.props;
  const template = props?.reliefTiles;
  if (!props || typeof template !== 'string' || !template.trim() || typeof props.id !== 'string') {
    return null;
  }
  const minzoom = finite(props.minZoom);
  const maxzoom = finite(props.maxZoom);
  const bounds = Array.isArray(props.reliefBounds) && props.reliefBounds.length === 4 ? props.reliefBounds : null;
  return {
    id: props.id,
    tiles: [absoluteTemplate(template)],
    scheme: props.reliefScheme === 'tms' ? 'tms' : 'xyz',
    tileSize: finite(props.tileSize) ?? 256,
    ...(minzoom !== undefined ? { minzoom } : {}),
    ...(maxzoom !== undefined ? { maxzoom } : {}),
    ...(bounds && bounds.every((n) => finite(n) !== undefined)
      ? { bounds: bounds as [number, number, number, number] }
      : {}),
    opacity: finite(props.opacity) ?? 1,
    visible: props.visible !== false,
  };
}

/**
 * Splits deck's layers into those deck still draws and the rasters MapLibre
 * takes, in deck's order, the bottom one first.
 */
export function splitNativeRasters(layers: unknown[]): { kept: unknown[]; native: NativeRaster[] } {
  const native: NativeRaster[] = [];
  const kept = layers.filter((layer) => {
    const raster = nativeRasterOf(layer);
    if (raster) {
      native.push(raster);
    }
    return !raster;
  });
  return native.length ? { kept, native } : { kept: layers, native };
}

/** A key that changes when anything MapLibre would draw differently does. */
export function nativeKey(rasters: NativeRaster[]): string {
  return JSON.stringify(rasters);
}

interface SourceLike {
  serialize?(): {
    tiles?: string[];
    scheme?: string;
    tileSize?: number;
    minzoom?: number;
    maxzoom?: number;
    bounds?: number[];
  };
  setTiles?(tiles: string[]): unknown;
}

/** The ids the panel added to each map, to take away what is no longer wanted. */
const added = new WeakMap<object, Set<string>>();

/** Whether a source's bounds are the ones wanted; MapLibre's default world box counts as none. */
function sameBounds(held: number[] | undefined, wanted: number[] | undefined): boolean {
  const isWorld = (b: number[] | undefined) =>
    !b || (b.length === 4 && b[0] <= -180 && b[1] <= -85.051129 && b[2] >= 180 && b[3] >= 85.051129);
  if (!wanted) {
    return isWorld(held);
  }
  return Array.isArray(held) && held.length === 4 && held.every((n, i) => Math.abs(n - wanted[i]) < 1e-9);
}

function sameList(a: string[] | undefined, b: string[]): boolean {
  return Array.isArray(a) && a.length === b.length && a.every((value, i) => value === b[i]);
}

/**
 * Makes MapLibre draw `rasters`, and only them, among what the panel added: a
 * source and a raster layer each, on top of the base map, in the given order.
 * A new template on the same source swaps the tiles in place (`setTiles`),
 * keeping the old ones on screen until the new arrive, so a timeline walks
 * without a blank frame.
 *
 * Idempotent, so it can run on every change of the style. False when the style
 * is not ready to take a source yet; the caller tries again on its next change.
 */
export function syncNativeRasters(map: RasterMap, rasters: NativeRaster[]): boolean {
  const mine = added.get(map) ?? new Set<string>();
  added.set(map, mine);
  const wanted = new Set(rasters.map((raster) => NATIVE_PREFIX + raster.id));
  try {
    for (const id of [...mine]) {
      if (!wanted.has(id)) {
        if (map.getLayer(id)) {
          map.removeLayer(id);
        }
        if (map.getSource(id)) {
          map.removeSource(id);
        }
        mine.delete(id);
      }
    }

    for (const raster of rasters) {
      const id = NATIVE_PREFIX + raster.id;
      let source = map.getSource(id) as SourceLike | undefined;
      const spec = source?.serialize?.();
      if (
        source &&
        (!spec ||
          spec.scheme !== raster.scheme ||
          spec.tileSize !== raster.tileSize ||
          spec.minzoom !== raster.minzoom ||
          spec.maxzoom !== raster.maxzoom ||
          // Bounds are fixed when a source is made: a new box is a new source.
          !sameBounds(spec.bounds, raster.bounds))
      ) {
        if (map.getLayer(id)) {
          map.removeLayer(id);
        }
        map.removeSource(id);
        source = undefined;
      }
      if (!source) {
        map.addSource(id, {
          type: 'raster',
          tiles: raster.tiles,
          scheme: raster.scheme,
          tileSize: raster.tileSize,
          ...(raster.minzoom !== undefined ? { minzoom: raster.minzoom } : {}),
          ...(raster.maxzoom !== undefined ? { maxzoom: raster.maxzoom } : {}),
          ...(raster.bounds ? { bounds: raster.bounds } : {}),
        });
      } else if (!sameList(spec?.tiles, raster.tiles)) {
        source.setTiles?.(raster.tiles);
      }
      mine.add(id);

      const visibility = raster.visible ? 'visible' : 'none';
      if (!map.getLayer(id)) {
        map.addLayer({
          id,
          type: 'raster',
          source: id,
          layout: { visibility },
          paint: { 'raster-opacity': raster.opacity },
        });
      } else {
        if (map.getPaintProperty(id, 'raster-opacity') !== raster.opacity) {
          map.setPaintProperty(id, 'raster-opacity', raster.opacity);
        }
        if ((map.getLayoutProperty(id, 'visibility') ?? 'visible') !== visibility) {
          map.setLayoutProperty(id, 'visibility', visibility);
        }
      }
    }

    // On top of the base map, in deck's order: moved only when they are not already.
    const ids = rasters.map((raster) => NATIVE_PREFIX + raster.id);
    const order = map.getLayersOrder?.();
    if (ids.length && (!order || !sameList(order.slice(-ids.length), ids))) {
      for (const id of ids) {
        map.moveLayer(id);
      }
    }
    return true;
  } catch {
    // "Style is not done loading", or a map already gone.
    return false;
  }
}
