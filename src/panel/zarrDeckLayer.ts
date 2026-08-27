import { TileLayer } from '@deck.gl/geo-layers';
import { BitmapLayer } from '@deck.gl/layers';

/**
 * The deck.gl layers that draw TiTiler's Zarr tiles.
 *
 * Thin by design, and thinner than the raster path: `/zarr` answers with an
 * ordinary PNG, already reprojected to Web Mercator and already coloured, so
 * there is no decoding, no colormap texture and no band arithmetic here — a
 * `TileLayer` to decide which tiles the viewport needs, and a `BitmapLayer` to
 * put each one on the map.
 *
 * Kept apart from `zarrTileLayer.ts` so that module stays free of deck imports
 * and can be tested without loading the whole graph, the way `wmsDeckLayer.ts`
 * is kept apart from `wmsTimeLayer.ts`.
 */

/**
 * How many tiles to have in flight at once.
 *
 * Matched to the tile server rather than to the browser. TiTiler runs with
 * `WEB_CONCURRENCY: '4'` in the bench compose, and a Zarr tile is not cheap to
 * make: it may have to fetch and decompress a chunk spanning far more of the
 * store than the tile shows. Asking for more than the server can work on at
 * once only lengthens the queue every request waits in.
 */
const MAX_REQUESTS = 4;

/** Puts one already-rendered tile on the map. */
function renderSubLayers(
  props: Record<string, unknown> & {
    data?: unknown;
    tile: { bbox: { west: number; south: number; east: number; north: number } };
  }
): unknown {
  // A tile that failed — a 500 from an index label the store does not have —
  // arrives as null. Drawing nothing is right; throwing would take the map down.
  if (!props.data) {
    return null;
  }

  const { west, south, east, north } = props.tile.bbox;
  return new BitmapLayer(props as never, {
    data: undefined,
    image: props.data,
    bounds: [west, south, east, north],
  } as never);
}

/** Builds the tile layer, in the shape `makeZarrLayer` asks for. */
export const buildZarrDeckLayer = (props: Record<string, unknown>): unknown =>
  new TileLayer({
    tileSize: 256,
    maxRequests: MAX_REQUESTS,
    renderSubLayers,
    ...props,
  } as never);
