/**
 * Makes kepler's WMS layer able to ask for a date.
 *
 * kepler 3.3.0-alpha.7 draws a WMS, but always the same picture: the layer
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
 * Wrapped as a class, in the registry, for the same reason as `tripLayerFix`:
 * kepler builds its layers itself, and by the time an instance could be reached
 * the deck layer has already been handed to the renderer.
 */

/** The fragment key. Short because it is on every tile url in the network tab. */
const TIME_KEY = 't';

/**
 * The data url for a service at a given moment.
 *
 * Any fragment already there is replaced rather than appended to: `renderLayer`
 * runs on every store change, so its own output comes back as input, and
 * stacking would grow the string without bound and break the split.
 *
 * The query string, if the service publishes one, is left exactly as it stands.
 * It belongs to the service — MapServer endpoints carry `?map=…` — and only the
 * fragment is ours to write.
 */
export function withTimeFragment(url: string, time: string | null | undefined): string {
  const base = url.split('#')[0];
  return time ? `${base}#${TIME_KEY}=${encodeURIComponent(time)}` : base;
}

/** The service url and the moment a data url carries, as the deck layer reads it. */
export function readTimeFragment(data: string): { url: string; time?: string } {
  const [url, fragment] = data.split('#');
  if (!fragment?.startsWith(`${TIME_KEY}=`)) {
    return { url };
  }
  return { url, time: decodeURIComponent(fragment.slice(TIME_KEY.length + 1)) };
}

/** The members of kepler's WMS layer this wrapper touches. */
interface WmsLayerLike {
  config?: { visConfig?: { wmsTime?: unknown } };
  /** What a click reads to ask the service about a pixel. */
  deckLayerRef?: unknown;
  renderLayer(opts?: unknown): unknown[];
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
 * and the layer the user styled survives every step of the timeline.
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
export function withWmsTime<C extends Constructor<object>>(
  WMSLayer: C,
  buildTimedLayer: TimedDeckLayerFactory
): C {
  class WMSLayerWithTime extends (WMSLayer as Constructor<WmsLayerLike>) {
    renderLayer(opts?: unknown): unknown[] {
      const layers = super.renderLayer(opts) ?? [];
      if (layers.length === 0) {
        return layers;
      }
      const chosen = this.config?.visConfig?.wmsTime;
      const time = typeof chosen === 'string' && chosen ? chosen : null;

      let last: unknown = null;
      const timed = layers.map((layer) => {
        const props = (layer as { props?: Record<string, unknown> } | null)?.props;
        if (!props || typeof props.data !== 'string') {
          return layer;
        }
        last = buildTimedLayer({ ...props, data: withTimeFragment(props.data, time) });
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
