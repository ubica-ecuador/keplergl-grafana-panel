import { TileLayer } from '@deck.gl/geo-layers';
import { BitmapLayer } from '@deck.gl/layers';

import type { TileBounds } from '../data/esriImageUrl';

/**
 * The deck.gl layers that draw an ArcGIS Image Service.
 *
 * The twin of `cogPaintedDeckLayer.ts` with one difference, and it is the whole
 * reason this file exists: the service publishes no tile scheme, so there is no
 * url template for deck to fill in. `getTileData` builds each request from the
 * tile's own bounds instead.
 *
 * What comes back is a finished picture — the service applies the renderer its
 * author published — so there is no decoding, no colormap and no band
 * arithmetic here either.
 *
 * Kept apart from `esriImageLayer.ts` so that module stays free of deck imports
 * and can be tested without loading the whole graph.
 */

/**
 * How many tiles to have in flight at once.
 *
 * Lower than the COG path's, and matched to someone else's server rather than
 * to ours: this is a public service shared by everyone, and a map that opens
 * with twenty simultaneous renders is the kind of client that gets throttled.
 * Measured latency is 0,8-1,4 s a tile, so six in flight already keeps the map
 * filling steadily.
 */
const MAX_REQUESTS = 6;

/** Puts one already-rendered tile on the map. */
function renderSubLayers(
  props: Record<string, unknown> & {
    data?: unknown;
    tile: { bbox: TileBounds };
  }
): unknown {
  // A tile the service could not draw arrives as null. Drawing nothing is
  // right; throwing would take the map down.
  if (!props.data) {
    return null;
  }

  const { west, south, east, north } = props.tile.bbox;
  return new BitmapLayer(props as never, {
    data: undefined,
    // `image` takes a url, so the request the layer built is handed straight to
    // deck's image loader — no fetch of our own, and the browser's cache still
    // applies.
    image: props.data,
    bounds: [west, south, east, north],
  } as never);
}

/** Builds the tile layer, in the shape `makeEsriImageLayer` asks for. */
export const buildEsriImageDeckLayer = (props: Record<string, unknown>): unknown => {
  const { getTileUrl, ...rest } = props as { getTileUrl: (bounds: TileBounds) => string | null };

  return new TileLayer({
    tileSize: 256,
    maxRequests: MAX_REQUESTS,
    // The service renders per extent, so the "data" of a tile is the url that
    // draws it. `renderSubLayers` hands that to `BitmapLayer.image`.
    getTileData: (tile: { bbox: TileBounds }) => getTileUrl(tile.bbox),
    renderSubLayers,
    ...rest,
  } as never);
};
