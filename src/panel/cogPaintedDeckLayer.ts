import { TileLayer } from '@deck.gl/geo-layers';
import { BitmapLayer } from '@deck.gl/layers';

/**
 * The deck.gl layers that draw TiTiler's painted COG tiles.
 *
 * The twin of `zarrDeckLayer.ts`, and thin for the same reason: `/cog/…​.png`
 * answers with an ordinary image, already reprojected to Web Mercator and
 * already coloured, so there is no decoding, no colormap texture and no band
 * arithmetic here — a `TileLayer` to decide which tiles the viewport needs, and
 * a `BitmapLayer` to put each one on the map.
 *
 * Kept apart from `cogPaintedLayer.ts` so that module stays free of deck imports
 * and can be tested without loading the whole graph.
 */

/**
 * How many tiles to have in flight at once.
 *
 * Matched to the tile server rather than to the browser: TiTiler runs with
 * `WEB_CONCURRENCY: '4'` in the bench compose, and reading a COG is CPU-bound
 * work that blocks a worker. Asking for more than the server can work on at
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
  // A tile outside the image arrives as null, and on this path that is the
  // ordinary case rather than a fault: a COG covers one UTM zone, so a map
  // showing more than one asks each layer for tiles it does not have and is
  // answered 404. Drawing nothing is right; throwing would take the map down.
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

/** Builds the tile layer, in the shape `makeCogPaintedLayer` asks for. */
export const buildCogPaintedDeckLayer = (props: Record<string, unknown>): unknown =>
  new TileLayer({
    tileSize: 256,
    maxRequests: MAX_REQUESTS,
    renderSubLayers,
    ...props,
  } as never);
