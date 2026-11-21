import type { WmsBox } from '../data/wmsDataset';
import type { MapBounds } from './keplerAdapter';
import { isKeplerDefaultViewport, type SavedViewport } from './viewportGuard';
import { type MapStateLike, viewportFromMapState } from './windViewport';

/**
 * What the panel does with a WMS layer's box (`tiles_bbox`, `parseWmsBox`):
 * frame the view on it when the layer arrives out of sight, and draw the
 * service's picture only inside it. A query's `{z}/{x}/{y}` tiles carry the
 * same box and get the same two (`xyzTileDeckLayer.ts`): a tile service paints
 * no data white as readily, and its tiles say no more about where it is.
 *
 * Both exist because of how a WMS answers. It is asked for a picture of the
 * view, whatever the view is, and it answers one: a dashboard saved over
 * Cuenca that gains a layer of France shows Cuenca with nothing on it, and a
 * service that paints no alpha — IGN's Cassini map is an RGB PNG, whatever
 * `TRANSPARENT` says, with no other format on offer — paints the rest of the
 * world white. Many services do. The box is the one thing that says where the
 * layer really is.
 *
 * Pure arithmetic, free of kepler, deck and the store, so the rules can be
 * tested with literal numbers; `useBoxFraming`, `wmsDeckLayer` and
 * `xyzTileDeckLayer` apply them.
 */

/** The latitude Web Mercator stops at; beyond it a position projects to infinity. */
export const MERCATOR_LIMIT = 85.051129;

/** A view's extent in degrees; `west` and `east` unwrapped, so they may pass ±180. */
export interface ViewExtent {
  west: number;
  south: number;
  east: number;
  north: number;
}

/**
 * The box with its east made greater than its west: a box across the
 * antimeridian (`170 … -170`) becomes `170 … 190`, one interval to compare
 * and draw rather than two.
 */
export function unwrapBox(box: WmsBox): WmsBox {
  const [west, south, east, north] = box;
  return [west, south, east < west ? east + 360 : east, north];
}

/** Whether a box spans every longitude: nothing to the side of it to frame away from or clip. */
export function spansAllLongitudes(box: WmsBox): boolean {
  const [west, , east] = unwrapBox(box);
  return east - west >= 360 - 1e-9;
}

/**
 * Whether any of the box is in the view.
 *
 * Longitudes are compared on every copy of the world the view could be
 * showing — a map panned east of 180 shows Fiji at 182 — so the box is tried
 * shifted by whole turns until one copy lands under the view or none can.
 */
export function boxOverlapsView(box: WmsBox, view: ViewExtent): boolean {
  const [west, south, east, north] = unwrapBox(box);
  if (south >= view.north || north <= view.south) {
    return false;
  }
  if (spansAllLongitudes(box) || view.east - view.west >= 360) {
    return true;
  }
  // The easternmost copy that starts west of the view's east edge: if that one
  // ends before the view begins, every copy further west does too.
  const turns = Math.ceil((view.east - west) / 360) - 1;
  const shiftedWest = west + turns * 360;
  const shiftedEast = east + turns * 360;
  return shiftedEast > view.west && shiftedWest < view.east;
}

/** The bounds kepler's `fitBounds` frames for a box: unwrapped, and inside Web Mercator. */
export function fitBoundsOfBox(box: WmsBox): MapBounds {
  const [west, south, east, north] = unwrapBox(box);
  return [west, Math.max(south, -MERCATOR_LIMIT), east, Math.min(north, MERCATOR_LIMIT)];
}

/**
 * What the map frames a layer's box on: its bounds (`fitBoundsOfBox`), and the
 * first zoom level the layer has tiles at, when its query gave one
 * (`tiles_min_zoom`).
 */
export interface BoxFrame {
  bounds: MapBounds;
  minZoom?: number;
}

/**
 * The view to put the map at when the zoom kepler fitted the box at is below
 * the layer's first level, or null when it is not.
 *
 * A layer has no tile to ask for below its first level — a WMTS whose matrices
 * start at 6, framed on France at 5.35, asks for nothing and shows an empty
 * map. So the frame is the box's centre at that first level: the box no longer
 * fits the map, but what is shown of it is drawn. The centre is the box's
 * middle, as kepler's own fit takes it, its longitude brought back into ±180.
 */
export function raisedToMinZoom(
  bounds: MapBounds,
  minZoom: number | undefined,
  zoom: number | undefined
): { latitude: number; longitude: number; zoom: number } | null {
  if (minZoom === undefined || typeof zoom !== 'number' || !Number.isFinite(zoom) || zoom >= minZoom) {
    return null;
  }
  const [west, south, east, north] = bounds;
  const middle = (west + east) / 2;
  return { latitude: (south + north) / 2, longitude: ((((middle + 180) % 360) + 360) % 360) - 180, zoom: minZoom };
}

/** The smallest bounds holding all of them, or null for none. */
export function unionOfBounds(bounds: MapBounds[]): MapBounds | null {
  return bounds.reduce<MapBounds | null>(
    (union, b) =>
      union
        ? [Math.min(union[0], b[0]), Math.min(union[1], b[1]), Math.max(union[2], b[2]), Math.max(union[3], b[3])]
        : b,
    null
  );
}

export type WmsFramingDecision = 'fit' | 'keep' | 'wait';

/**
 * Whether a WMS layer that has just appeared — or that the query has just
 * pointed at another service or layer — should move the view onto its box.
 *
 * - **No box**: keep. Nothing says where the layer is, and a WMS covers a
 *   country or a continent: framing on a guess would throw away the view.
 * - **No saved view**: fit. A map with no view of its own is meant to be
 *   framed on what it shows, and a WMS has no rows for kepler to frame on.
 * - **A saved view that shows some of the box**: keep. The author chose that
 *   view over that layer; part of France is still France.
 * - **A saved view that shows none of it**: fit. The view was saved for
 *   something else — the dashboard's other data, or kepler's default — and
 *   keeping it shows a layer nobody can see.
 * - **The view cannot be measured yet** (the map has no size): wait, and ask
 *   again on the next change of the store.
 *
 * Asked once per service and layer, never on a refresh that brings the same
 * pair back: that is the caller's to remember (`useBoxFraming`).
 */
export function decideWmsFraming({
  box,
  hasSavedView,
  view,
}: {
  box: WmsBox | null;
  hasSavedView: boolean;
  /** What the map is showing, or is about to show; null while it has no size. */
  view: ViewExtent | null;
}): WmsFramingDecision {
  if (!box) {
    return 'keep';
  }
  if (!hasSavedView) {
    return 'fit';
  }
  if (!view) {
    return 'wait';
  }
  return boxOverlapsView(box, view) ? 'keep' : 'fit';
}

/**
 * The view to judge a new layer against: the map's own, unless the map is
 * still on kepler's default because the saved view has yet to land.
 *
 * kepler's internal view state echoes its default back over a saved viewport
 * during the load window (`viewportGuard.ts`), and the guard puts the saved one
 * back. Judging that passing default would compare the layer with San
 * Francisco; the saved view is what the map is about to show.
 */
export function judgedView(mapState: MapStateLike | null, saved: SavedViewport | null): ViewExtent | null {
  if (!mapState) {
    return null;
  }
  const { latitude, longitude, zoom } = mapState;
  const onDefault =
    typeof latitude === 'number' &&
    typeof longitude === 'number' &&
    typeof zoom === 'number' &&
    isKeplerDefaultViewport({ latitude, longitude, zoom });
  const viewport = viewportFromMapState(
    saved && onDefault
      ? { ...mapState, latitude: saved.latitude, longitude: saved.longitude, zoom: saved.zoom }
      : mapState
  );
  return viewport ? { west: viewport.west, south: viewport.south, east: viewport.east, north: viewport.north } : null;
}

/**
 * Where deck's `ClipExtension` cuts the WMS picture, in degrees, or null for
 * no cut at all.
 *
 * The picture is fetched for the view and laid over it (`bounds`, in degrees,
 * unwrapped like the view), and the cut is a rectangle in the same space: the
 * box, on the copy of the world nearest the picture's centre, so a view panned
 * past the antimeridian cuts around the copy it is looking at. One rectangle,
 * so a view zoomed out far enough to show the world twice keeps only the copy
 * nearest its centre.
 *
 * Latitudes stop at Web Mercator's edge: a cut at 90° would project to
 * infinity and the shader would compare against NaN. A box that spans every
 * longitude and reaches both edges cuts nothing, and is not cut: there is
 * nothing outside it on the map. One that spans every longitude but not every
 * latitude (a polar product) is cut north and south only.
 *
 * No cut on a globe. The extension compares positions in deck's common space,
 * which on a globe is three-dimensional, so a rectangle there is no rectangle
 * on the sphere; a globe shows the service's picture as the service paints it.
 */
export function wmsClipBounds(
  box: WmsBox | null,
  imageBounds: readonly number[] | null | undefined,
  globe: boolean
): MapBounds | null {
  if (!box || globe) {
    return null;
  }
  const [west, south, east, north] = unwrapBox(box);
  const clippedSouth = Math.max(south, -MERCATOR_LIMIT);
  const clippedNorth = Math.min(north, MERCATOR_LIMIT);
  const image = imageBounds && imageBounds.length === 4 && imageBounds.every(Number.isFinite) ? imageBounds : null;

  if (spansAllLongitudes(box)) {
    if (clippedSouth <= -MERCATOR_LIMIT && clippedNorth >= MERCATOR_LIMIT) {
      return null;
    }
    // Every longitude: as wide as the picture, with a degree to spare so the cut never shows at its edge.
    return [image ? image[0] - 1 : -540, clippedSouth, image ? image[2] + 1 : 540, clippedNorth];
  }

  const turns = image ? Math.round(((image[0] + image[2]) / 2 - (west + east) / 2) / 360) : 0;
  return [west + turns * 360, clippedSouth, east + turns * 360, clippedNorth];
}

/**
 * The `bounds` of the MapLibre raster source a WMS becomes on a relief base map
 * (`reliefRasters.ts`), or null for none.
 *
 * MapLibre asks for no tile outside a source's bounds, but draws whole the
 * tiles it does ask for, so on the relief the cut falls on tile edges, not on
 * the box: a band of the service's white can show along the box's sides,
 * narrower the closer the camera. Its bounds cannot cross the antimeridian, so
 * a box that does gets none, and nor does one that spans every longitude.
 */
export function reliefBoundsOfBox(box: WmsBox | null): MapBounds | null {
  if (!box || box[0] > box[2] || spansAllLongitudes(box)) {
    return null;
  }
  return [box[0], Math.max(box[1], -MERCATOR_LIMIT), box[2], Math.min(box[3], MERCATOR_LIMIT)];
}

/**
 * The box a WMS or tile dataset's metadata carries (`tilesBbox`), if it carries
 * a well-formed one: what the deck layers cut their pictures to.
 */
export function boxOfMetadata(metadata: { tilesBbox?: unknown } | undefined): WmsBox | null {
  const box = metadata?.tilesBbox;
  return Array.isArray(box) && box.length === 4 && box.every((n) => typeof n === 'number' && Number.isFinite(n))
    ? (box as WmsBox)
    : null;
}
