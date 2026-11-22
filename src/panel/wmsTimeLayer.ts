/**
 * Makes kepler's WMS layer able to ask for a date.
 *
 * kepler 3.3.0-alpha.17 draws a WMS, but always the same picture: the layer
 * hands deck.gl `metadata.tilesetDataUrl` as a plain string, and the request it
 * builds from that carries no `TIME`. A time-aware service — a GeoServer over
 * an ImageMosaic, which is how most environmental data in the region is
 * published — then answers with its default slice for ever, whatever the map's
 * clock says.
 *
 * **The date cannot travel in the url.** `WMSImageSource._getWMSUrl` appends
 * its parameters starting with `?`, without looking whether the url already has
 * one, so a service url carrying `?time=…` produces `…?time=…?SERVICE=WMS&…`
 * and GeoServer reads the second half as part of the date:
 * `ParseException: Invalid date: 2026-08-20T00:00:00.000Z?SERVICE=WMS`.
 *
 * **Nor can a ready-made source be handed over.** deck's layer does accept one
 * — `if (props.data instanceof ImageSource) return props.data` — but that
 * branch is unreachable for WMS: `WMSImageSource` extends `DataSource`, not
 * `ImageSource`, so the check is false even for a genuine source and the layer
 * throws `invalid image source in props.data`.
 *
 * So the date travels as a **fragment** on the data url, and a deck layer of
 * our own splits it back out into a real WMS parameter (`wmsDeckLayer.ts`).
 * Three things fall out of that choice, and all three are the reason for it:
 *
 * - A fragment never reaches a server. Every HTTP client strips it, so the
 *   worst case of the convention leaking is a request that ignores it — never a
 *   corrupted one, which is exactly what the query-string route produced.
 * - Changing the date changes the string, and deck's `dataChanged` already
 *   means *rebuild the image source, refetch the metadata, reload the image*.
 *   The refresh is upstream behaviour, not something this module arranges.
 * - Leaving the date alone leaves the string alone, so a drag of the time
 *   widget that stays between two dates costs nothing at all.
 *
 * Wrapped as a class, in the layer registry, because kepler builds its layers
 * itself: by the time an instance could be reached from the panel, the deck
 * layer has already been handed to the renderer.
 */

import { legendPictureOf } from '../data/serviceLegend';
import { boxOfMetadata, reliefBoundsOfBox } from './wmsExtent';

/** The fragment keys. Short because they are on every tile url in the network tab. */
const TIME_KEY = 't';
const STYLE_KEY = 's';

/**
 * The data url for a service at a given moment, in a given style.
 *
 * Any fragment already there is replaced rather than appended to: `renderLayer`
 * runs on every store change, so its own output comes back as input, and
 * stacking would grow the string without bound and break the split.
 *
 * The style travels the way the date does, and for the same reasons: a new
 * style is a new string, so deck builds a new image source and fetches a new
 * picture by itself, and the same style leaves the string — and the picture —
 * alone. No dataset is touched, so the view does not move and the layer the
 * user styled stays the same layer.
 *
 * The query string, if the service publishes one, is left exactly as it stands.
 * It belongs to the service — MapServer endpoints carry `?map=…` — and only the
 * fragment is ours to write.
 */
export function withTimeFragment(url: string, time: string | null | undefined, style?: string | null): string {
  const base = url.split('#')[0];
  const parts = [
    ...(time ? [`${TIME_KEY}=${encodeURIComponent(time)}`] : []),
    ...(style ? [`${STYLE_KEY}=${encodeURIComponent(style)}`] : []),
  ];
  return parts.length ? `${base}#${parts.join('&')}` : base;
}

/** The service url, and the moment and style a data url carries, as the deck layer reads them. */
export function readTimeFragment(data: string): { url: string; time?: string; style?: string } {
  const [url, fragment] = data.split('#');
  const read: { url: string; time?: string; style?: string } = { url };
  for (const part of fragment?.split('&') ?? []) {
    const at = part.indexOf('=');
    const key = part.slice(0, at);
    const value = at > 0 ? decodeURIComponent(part.slice(at + 1)) : '';
    if (key === TIME_KEY && value) {
      read.time = value;
    } else if (key === STYLE_KEY && value) {
      read.style = value;
    }
  }
  return read;
}

/**
 * A WMS as a MapLibre tile template (`reliefRasters.ts`): GetMap in Web Mercator,
 * one 256 px square per tile, `{bbox-epsg-3857}` filled in by MapLibre. Version
 * 1.3.0 and PNG as loaders.gl asks for the picture deck draws; in 1.3.0 the axis
 * order of EPSG:3857 is x then y, so the box goes as MapLibre writes it. The
 * service's own query (MapServer's `?map=…`) is kept, the moment, if any, goes
 * as `TIME`, and the style, if any, as `STYLES`: the tiles are the picture deck
 * would draw.
 */
export function wmsMapLibreTemplate(args: {
  url: string;
  layers: string[];
  transparent?: boolean;
  time?: string | null;
  style?: string | null;
}): string | null {
  const base = args.url.split('#')[0].trim();
  const layers = args.layers.filter((name) => typeof name === 'string' && name);
  if (!base || layers.length === 0) {
    return null;
  }
  const params = new URLSearchParams({
    SERVICE: 'WMS',
    VERSION: '1.3.0',
    REQUEST: 'GetMap',
    LAYERS: layers.join(','),
    STYLES: args.style ?? '',
    CRS: 'EPSG:3857',
    WIDTH: '256',
    HEIGHT: '256',
    FORMAT: 'image/png',
    TRANSPARENT: args.transparent === false ? 'FALSE' : 'TRUE',
  });
  if (args.time) {
    params.set('TIME', args.time);
  }
  const joiner = !base.includes('?') ? '?' : /[?&]$/.test(base) ? '' : '&';
  return `${base}${joiner}${params}&BBOX={bbox-epsg-3857}`;
}

/** The members of kepler's WMS layer this wrapper touches. */
interface WmsLayerLike {
  config?: {
    visConfig?: { wmsTime?: unknown; wmsStyle?: unknown; wmsLegendUrl?: unknown; wmsLayer?: { name?: unknown } };
  };
  /** What a click reads to ask the service about a pixel. */
  deckLayerRef?: unknown;
  /** kepler's: the service's endpoint and WMS version, once its capabilities answered; whom the layer credits. */
  meta?: { tilesetDataUrl?: unknown; wmsVersion?: unknown; attribution?: unknown };
  renderLayer(opts?: unknown): unknown[];
  /** What kepler's map legend shows of the layer: a picture, or null for none. */
  getLegendImageUrl?(): string | null;
  updateMeta?(meta: Record<string, unknown>): void;
  updateLayerMeta?(dataset: unknown, ...rest: unknown[]): unknown;
}

/** Whether a dataset carries credits its data source named (`metadata.attributions`, `frameLayer.ts`). */
function namesItsCredits(dataset: unknown): boolean {
  const attributions = (dataset as { metadata?: { attributions?: unknown } } | null)?.metadata?.attributions;
  return Array.isArray(attributions) && attributions.length > 0;
}

/** The WMS parameters a GetLegendGraphic replaces on a service url, as kepler's `buildWmsRequestUrl` does. */
const LEGEND_REPLACED_KEYS = new Set([
  'service',
  'request',
  'version',
  'layers',
  'layer',
  'styles',
  'style',
  'format',
  'crs',
  'srs',
  'bbox',
  'width',
  'height',
  'transparent',
  'bgcolor',
  'exceptions',
  'sld',
  'sld_version',
  'legend_options',
]);

/**
 * The GetLegendGraphic of a layer in one style: kepler's own request for a
 * WMS legend (`buildWmsGetLegendGraphicUrl` in `@kepler.gl/table`, the one its
 * WMS layer falls back to), with the `STYLE` kepler leaves out. Kept here,
 * parameter for parameter, so this module stays free of kepler's imports. The
 * service's own query (MapServer's `?map=…`) is kept; null for a url that
 * does not parse.
 */
export function wmsLegendGraphicUrl(
  serviceUrl: string,
  layerName: string,
  style: string,
  version?: string
): string | null {
  if (!serviceUrl || !layerName) {
    return null;
  }
  try {
    const url = new URL(serviceUrl.split('#')[0]);
    for (const key of [...url.searchParams.keys()]) {
      if (LEGEND_REPLACED_KEYS.has(key.toLowerCase())) {
        url.searchParams.delete(key);
      }
    }
    const params: Record<string, string> = {
      SERVICE: 'WMS',
      REQUEST: 'GetLegendGraphic',
      VERSION: version || '1.3.0',
      LAYER: layerName,
      FORMAT: 'image/png',
      STYLE: style,
      TRANSPARENT: 'TRUE',
      SLD_VERSION: '1.1.0',
    };
    for (const [key, value] of Object.entries(params)) {
      if (value) {
        url.searchParams.set(key, value);
      }
    }
    return url.toString();
  } catch {
    return null;
  }
}

/** Builds the deck layer that understands the fragment — see `wmsDeckLayer.ts`. */
export type TimedDeckLayerFactory = (props: Record<string, unknown>) => unknown;

// The usual mixin constructor type. `any[]` rather than `unknown[]` on purpose:
// constructor parameters are checked contravariantly, so `unknown[]` would reject
// every concrete class — including kepler's own, whose constructor takes props.
type Constructor<T> = new (...args: any[]) => T;

/**
 * Wraps a WMS layer class so the date in its `visConfig` reaches the service.
 *
 * The date lives in `visConfig.wmsTime` rather than in the dataset because a
 * `visConfig` change is what makes kepler recompute a layer's data — the same
 * pair `swapRasterScene` relies on — and because the dataset then never has to
 * be touched at all: no rebuild, no refetch of a 900 KB capabilities document,
 * and the layer the user styled survives every step of the timeline. The
 * style the query names (`visConfig.wmsStyle`) takes the same road.
 *
 * The deck layer is rebuilt from the props kepler assembled rather than
 * assembled again here, so the id, the opacity, the click handler and whatever
 * upstream adds later all keep working without this module knowing about them.
 *
 * `deckLayerRef` is re-pointed at what we return: kepler sets it to the layer it
 * built, and a click reads `deckLayerRef.getFeatureInfoText`. Left pointing at a
 * layer deck never rendered, that reads a source that was never created and the
 * click returns null in silence.
 *
 * Every layer goes through the rebuild, date or no date. Standing aside when
 * there is none looked tidier and cost a second capabilities document: kepler's
 * own layer builds its own image source, which does not share the cache, so a
 * service with no timeline — or a layer that has yet to be given a date —
 * fetched the better part of a megabyte twice. Measured, not supposed.
 */
export function withWmsTime<C extends Constructor<object>>(WMSLayer: C, buildTimedLayer: TimedDeckLayerFactory): C {
  class WMSLayerWithTime extends (WMSLayer as Constructor<WmsLayerLike>) {
    /**
     * What kepler's map legend shows of the layer: the legend of the style it
     * draws.
     *
     * kepler's own answers the layer's first `LegendURL` in the capabilities,
     * or a GetLegendGraphic with no `STYLE`: both the default style's, whatever
     * the picture is drawn in. So the query's `legend_url` comes first (a
     * picture: an ArcGIS legend is no WMS's); then, for a style with none, the
     * GetLegendGraphic of that style; and only for the default style without
     * a `legend_url`, kepler's.
     */
    getLegendImageUrl(): string | null {
      const visConfig = this.config?.visConfig;
      const picture = legendPictureOf(typeof visConfig?.wmsLegendUrl === 'string' ? visConfig.wmsLegendUrl : '');
      if (picture) {
        return picture;
      }
      const style = typeof visConfig?.wmsStyle === 'string' ? visConfig.wmsStyle : '';
      const name = visConfig?.wmsLayer?.name;
      const service = this.meta?.tilesetDataUrl;
      if (style && typeof name === 'string' && typeof service === 'string') {
        const version = typeof this.meta?.wmsVersion === 'string' ? this.meta.wmsVersion : undefined;
        return wmsLegendGraphicUrl(service, name, style, version);
      }
      return super.getLegendImageUrl?.() ?? null;
    }

    /**
     * kepler credits a WMS layer with the service's attribution or, lacking one, its dataset's label (a query's
     * frame name, `services`) linked to the service. When the data source named whom to credit, the dataset's
     * attributions say it, and the label would only stand beside them.
     */
    updateLayerMeta(dataset: unknown, ...rest: unknown[]): unknown {
      const result = super.updateLayerMeta?.(dataset, ...rest);
      if (namesItsCredits(dataset) && this.meta?.attribution) {
        this.updateMeta?.({ attribution: null });
      }
      return result;
    }

    renderLayer(opts?: unknown): unknown[] {
      const layers = super.renderLayer(opts) ?? [];
      if (layers.length === 0) {
        return layers;
      }
      const chosen = this.config?.visConfig?.wmsTime;
      const time = typeof chosen === 'string' && chosen ? chosen : null;
      // The style the query asked for (`applyWmsStyle`): empty is the service's default.
      const styled = this.config?.visConfig?.wmsStyle;
      const style = typeof styled === 'string' && styled ? styled : null;
      // The query's box, carried on the dataset (`wmsProtoDataset`): the deck
      // layer draws the picture only inside it (`wmsExtent.ts`).
      const clipBox = boxOfMetadata(
        (opts as { data?: { metadata?: { tilesBbox?: unknown } } } | undefined)?.data?.metadata
      );
      const reliefBounds = reliefBoundsOfBox(clipBox);

      let last: unknown = null;
      const timed = layers.map((layer) => {
        const props = (layer as { props?: Record<string, unknown> } | null)?.props;
        if (!props || typeof props.data !== 'string') {
          return layer;
        }
        // A WMS that answers no click can be drawn by MapLibre on a relief base map
        // (`reliefRasters.ts`); one that does stays with deck, whose picking finds the
        // pixel the click asks the service about.
        const reliefTiles = props.pickable
          ? null
          : wmsMapLibreTemplate({
              url: props.data,
              layers: Array.isArray(props.layers) ? (props.layers as string[]) : [],
              transparent: props.transparent as boolean | undefined,
              time,
              style,
            });
        last = buildTimedLayer({
          ...props,
          data: withTimeFragment(props.data, time, style),
          ...(clipBox ? { clipBox } : {}),
          ...(reliefTiles ? { reliefTiles, ...(reliefBounds ? { reliefBounds } : {}) } : {}),
        });
        return last;
      });

      if (last) {
        this.deckLayerRef = last;
      }
      return timed;
    }
  }

  return WMSLayerWithTime as unknown as C;
}

/** Something that can be asked for its metadata, once. */
interface MetadataSource {
  getMetadata(): Promise<unknown>;
}

/**
 * Makes a source share one metadata request per key, however many ask.
 *
 * A WMS capabilities document is the largest single thing this path fetches —
 * the better part of a megabyte on GeoGLOWS — and it is wanted twice over: the
 * layer needs it to draw, and the panel needs the dates out of it. Worse, every
 * change of date builds a new image source, so unshared it would be re-read on
 * every step of the timeline.
 *
 * **The original method is captured before the replacement is installed.**
 * Reaching for `source.getMetadata()` inside the replacement calls the
 * replacement, which is a stack overflow the first time a key is cold — and it
 * hides, because whichever caller warms the cache first spares everyone else.
 * It surfaced only once a dashboard grew heavy enough for the layer to ask
 * before the panel did.
 *
 * A rejection is not remembered: a service briefly down would otherwise stay
 * broken until the page was reloaded.
 */
export function shareMetadata(source: MetadataSource, key: string, cache: Map<string, Promise<unknown>>): void {
  const load = source.getMetadata.bind(source);
  source.getMetadata = () => {
    const cached = cache.get(key);
    if (cached) {
      return cached;
    }
    const pending = load();
    cache.set(key, pending);
    pending.catch(() => cache.delete(key));
    return pending;
  };
}
