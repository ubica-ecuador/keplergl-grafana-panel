/**
 * Everything TiTiler needs to draw a STAC item as tiles it composites itself.
 *
 * The third sibling of `cogTileUrl.ts` and `zarrTileUrl.ts`, for the `/stac`
 * router of the same server, and it exists because a false-colour scene is not
 * a file: it is a choice of bands across the several COGs one item points at.
 * Asking the server to composite them costs one request per tile instead of the
 * three kepler's own layer makes — measured here at 116 KB against 768 KB — and
 * the cost is that the colours are decided before they arrive.
 */
export interface StacTileSpec {
  /** Base url of a TiTiler that mounts the `/stac` router. */
  serverUrl: string;
  /** The STAC item, as TiTiler will open it — including any signature it carries. */
  itemUrl: string;
  /** Assets to composite, in RGB order. */
  assets: string[];
  /** One `min,max` per asset, in the same order. Omitted, the server decides. */
  rescale?: string[];
}

/** The tiling scheme. Web Mercator, because that is what the map is in. */
const TILE_MATRIX_SET = 'WebMercatorQuad';

/**
 * The url template deck.gl fills in per tile, or null when there is nothing to ask.
 *
 * `assets` is appended once per band rather than joined with commas, and that is
 * not a style choice: a comma-separated list answers 404 on this server, naming
 * the whole string as an unknown asset. Only the query is encoded — the
 * `{z}/{x}/{y}` placeholders sit in the path and are left verbatim, and the item
 * url arrives as one opaque value even when it carries a query of its own.
 */
export function stacTileTemplate(spec: StacTileSpec): string | null {
  const serverUrl = spec.serverUrl.trim().replace(/\/+$/, '');
  const itemUrl = spec.itemUrl.trim();
  const assets = spec.assets.map((asset) => asset.trim()).filter(Boolean);
  if (!serverUrl || !itemUrl || assets.length === 0) {
    return null;
  }

  const params = new URLSearchParams({ url: itemUrl });
  assets.forEach((asset) => params.append('assets', asset));
  (spec.rescale ?? []).forEach((range) => params.append('rescale', range));

  return `${serverUrl}/stac/tiles/${TILE_MATRIX_SET}/{z}/{x}/{y}.png?${params}`;
}
