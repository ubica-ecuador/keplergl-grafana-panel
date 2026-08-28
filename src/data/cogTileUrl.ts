/**
 * Everything TiTiler needs to draw one COG as tiles it has already coloured.
 *
 * The sibling of `zarrTileUrl.ts`, for the other router of the same server, and
 * it exists for a reason worth stating: kepler's own raster layer asks for
 * `.npy` and colours the pixels in a shader, which is right for imagery — a
 * three-band scene wants its stretch decided in the browser — and wrong for a
 * classified raster, whose colours are a fact of the data rather than a choice
 * about it. A land-cover map has nine classes and one correct palette, usually
 * carried inside the file; asking for `.png` hands the drawing back to the
 * server, which reads that palette and honours it.
 */
export interface CogTileSpec {
  /** Base url of a TiTiler that mounts the `/cog` router. */
  serverUrl: string;
  /** The COG, as TiTiler will open it — including any signature it carries. */
  sourceUrl: string;
}

/** The tiling scheme. Web Mercator, because that is what the map is in. */
const TILE_MATRIX_SET = 'WebMercatorQuad';

/**
 * The url template deck.gl fills in per tile, or null when there is nothing to ask.
 *
 * Only the query is encoded; the `{z}/{x}/{y}` placeholders sit in the path and
 * are left verbatim. That matters more here than it looks: a signed COG url is
 * itself a query string, and it has to arrive at the server as one opaque value
 * rather than as parameters of the tile request.
 */
export function cogTileTemplate(spec: CogTileSpec): string | null {
  const serverUrl = spec.serverUrl.trim().replace(/\/+$/, '');
  const sourceUrl = spec.sourceUrl.trim();
  // Returning null rather than a half-built url is the same choice
  // `framesToRasters` makes when a COG has no tile server: drawing nothing beats
  // asking a question that answers 404 on every tile of every zoom.
  if (!serverUrl || !sourceUrl) {
    return null;
  }

  const params = new URLSearchParams({ url: sourceUrl });

  return `${serverUrl}/cog/tiles/${TILE_MATRIX_SET}/{z}/{x}/{y}.png?${params}`;
}
