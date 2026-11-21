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
  /**
   * How the server paints it, as its query parameters (`bidx=1&colormap_name=viridis`,
   * `rescale=0,3000&colormap=…`): what a catalog says of the file, a query's
   * `raster_paint`. Absent, the server reads the palette the file carries.
   */
  paint?: string;
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

  const params = withPaint(new URLSearchParams({ url: sourceUrl }), spec.paint);

  return `${serverUrl}/cog/tiles/${TILE_MATRIX_SET}/{z}/{x}/{y}.png?${params}`;
}

/**
 * A tile request's parameters with a query's paint over them: each key the
 * paint names replaces the panel's own for that key (a `rescale` of its own
 * over a recipe's, every value of a repeated one), the others are added. Never
 * its `url`: the image is the query's `raster_url`, and a second one would
 * make the server read another file.
 */
export function withPaint(params: URLSearchParams, paint: string | undefined): URLSearchParams {
  const text = paint?.trim().replace(/^\?/, '');
  if (!text) {
    return params;
  }
  const own = new URLSearchParams(text);
  const keys = new Set([...own.keys()].filter((key) => key && key !== 'url'));
  for (const key of keys) {
    params.delete(key);
    for (const value of own.getAll(key)) {
      params.append(key, value);
    }
  }
  return params;
}
