/**
 * Everything an ArcGIS Image Service needs to render one tile.
 *
 * The third sibling of `cogTileUrl.ts` and `zarrTileUrl.ts`, and the one that
 * asks a different kind of question. Those two address a *file* through a tile
 * server we run. An Image Service is neither: it is a **mosaic dataset** — a
 * catalogue of source rasters, a rule for choosing between them, and a pyramid
 * built over the whole mosaic — behind an endpoint that renders any extent on
 * demand.
 *
 * That is why it can draw the world in one request when a COG cannot. The
 * imagery this repo already measures with `computeHistograms` is 200-odd files
 * per year, one per UTM zone; the service composites them itself, so the map
 * asks for a picture of what it is showing and is handed one.
 *
 * There is no `{z}/{x}/{y}` scheme to fill in — the service is not tiled and
 * publishes no cache — so the url is built per tile from its bounds. deck's
 * `TileLayer` hands those over, which is the whole of the adaptation.
 */

/** Which service to ask, and how it should choose and draw. */
export interface EsriImageSpec {
  /** The service endpoint, ending in `/ImageServer`. */
  serviceUrl: string;
  /**
   * Which rasters of the mosaic to draw, as the service's own JSON.
   *
   * This is how a year is chosen on a multi-temporal service, and it is the
   * same rule the figures on this repo's land-cover dashboard already send:
   * `{"mosaicMethod":"esriMosaicAttribute","where":"Year=2023"}`. Absent, the
   * service applies its default — usually "most recent".
   */
  mosaicRule?: string;
  /**
   * How to colour it, as the service's own JSON.
   *
   * Absent, the service draws with the renderer it publishes, which for a
   * thematic service is the palette its author chose — the reason this path
   * needs no colour handling of its own.
   */
  renderingRule?: string;
  /** Tile edge in pixels. deck asks for 256 unless told otherwise. */
  size?: number;
}

/** The bounds of one tile, in degrees, as deck.gl reports them. */
export interface TileBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

/** Half the circumference of the Web Mercator world, in metres. */
const MERCATOR_HALF_WORLD = 20037508.342789244;

/** The latitude Web Mercator stops at; beyond it the projection runs to infinity. */
const MERCATOR_MAX_LATITUDE = 85.051129;

/**
 * A degree pair as Web Mercator metres.
 *
 * The bbox is sent in metres rather than in the degrees deck reports, and that
 * is not a detail. A tile is a square of Web Mercator, and its extent in
 * degrees is not: handing the service degrees and asking for a Mercator image
 * makes it reproject a box whose edges do not line up with the tile, and the
 * picture arrives shifted north-south by more the further from the equator.
 * Converting here keeps the request in the tile's own coordinate system.
 */
export function lngLatToMercator(lng: number, lat: number): [number, number] {
  const clamped = Math.max(-MERCATOR_MAX_LATITUDE, Math.min(MERCATOR_MAX_LATITUDE, lat));
  const x = (lng * MERCATOR_HALF_WORLD) / 180;
  const y = (Math.log(Math.tan(((90 + clamped) * Math.PI) / 360)) / (Math.PI / 180)) * (MERCATOR_HALF_WORLD / 180);
  return [x, y];
}

/**
 * The url that renders one tile, or null when there is nothing to ask.
 *
 * `format=png32` is the setting that decides whether this is usable at all, and
 * `transparent=true` on its own does not do it. Measured on the land-cover
 * service: with `format=png` the nodata comes back **opaque black** over half
 * an ocean-side tile whether the flag is set or not, and the layer would
 * blanket the base map with black sea. Only `png32` carries a real alpha
 * channel. Both are sent, because the flag is what asks and the format is what
 * makes the answer possible.
 */
export function esriImageUrl(spec: EsriImageSpec, bounds: TileBounds): string | null {
  const serviceUrl = spec.serviceUrl.trim().replace(/\/+$/, '');
  if (!serviceUrl) {
    return null;
  }

  const [xmin, ymin] = lngLatToMercator(bounds.west, bounds.south);
  const [xmax, ymax] = lngLatToMercator(bounds.east, bounds.north);
  const size = spec.size && spec.size > 0 ? spec.size : 256;

  const params = new URLSearchParams({
    bbox: [xmin, ymin, xmax, ymax].map((value) => value.toFixed(4)).join(','),
    bboxSR: '3857',
    imageSR: '3857',
    size: `${size},${size}`,
    format: 'png32',
    transparent: 'true',
    f: 'image',
  });
  if (spec.mosaicRule) {
    params.set('mosaicRule', spec.mosaicRule);
  }
  if (spec.renderingRule) {
    params.set('renderingRule', spec.renderingRule);
  }

  return `${serviceUrl}/exportImage?${params}`;
}
