import type { Layer } from '@deck.gl/core';
import { WMSLayer as DeckWMSLayer } from '@kepler.gl/deckgl-layers';
import { WMSImageSource } from '@loaders.gl/wms';

import type { WmsBox } from '../data/wmsDataset';
import { BOX_CLIP } from './boxClip';
import { wmsClipBounds } from './wmsExtent';
import { readTimeFragment, shareMetadata } from './wmsTimeLayer';

/**
 * The deck.gl layer that turns the date in a data url into a WMS `TIME`, and
 * the style in it into `STYLES`.
 *
 * Everything about drawing a WMS is upstream's; the one thing changed here is
 * how the image source gets built. `_createImageSource` is called by deck
 * whenever `data` changes, and `data` is where `wmsTimeLayer.ts` parks the
 * chosen moment as a fragment — so a new date arrives here as a new source, and
 * deck's own `updateState` refetches the image without being asked.
 *
 * Kept apart from `wmsTimeLayer.ts` so that module stays free of kepler and
 * loaders.gl imports and can be tested without loading the whole graph.
 */

/**
 * The date is passed **twice**, and that is not belt and braces.
 *
 * `wmsParameters.time` is the documented route, and it reaches GetMap. It does
 * *not* reach GetFeatureInfo: `getFeatureInfoURL` builds its options from a
 * fixed list — version, info_format, layers, query_layers, styles, crs — and
 * `time` is not on it. A click would then be answered for the layer's default
 * date while the map showed another, and the failure is invisible, because the
 * number that comes back is perfectly plausible.
 *
 * A vendor parameter is merged into *every* request, so it covers the click.
 * It also lands on GetCapabilities, where it is inert.
 */
function wmsOptions(time: string | undefined, loadOptions: Record<string, unknown> | undefined, style?: string) {
  const parameters = time ? { time } : {};
  return {
    loadOptions,
    wms: {
      wmsParameters: {
        ...parameters,
        // The style, unlike the date, needs no vendor copy: `styles` is on the
        // fixed list GetFeatureInfo is built from, so a click is answered for
        // the style on screen. Left out for the service's default, which
        // loaders.gl then sends as an empty `STYLES=`, as WMS 1.3.0 asks.
        ...(style ? { styles: style } : {}),
        // kepler parses a feature-info reply as GML — it walks
        // `gml:featureMember` — while loaders.gl asks for `text/plain` unless
        // told otherwise. Left alone the two never meet: the service answers in
        // prose, the parser finds no elements, and a click on a queryable layer
        // returns an empty list with nothing logged.
        info_format: 'application/vnd.ogc.gml' as const,
      },
      vendorParameters: parameters,
    },
  };
}

/**
 * The capabilities document of each service, fetched once per page.
 *
 * Every change of date builds a new image source, and deck follows each one
 * with `_loadMetadata()`. Unshared, that is a GetCapabilities per step of the
 * timeline — 906 KB and ~0.9 s apiece on the GeoGLOWS service, whose hourly
 * layers publish 14 389 dates. The document does not depend on the date, so it
 * is fetched for the service and handed to every source built for it.
 *
 * Not invalidated within the life of the page: a dashboard left open all day
 * will not notice dates added meanwhile, which is the right trade against
 * re-reading a megabyte of XML on every drag of the slider. A reload picks them
 * up, and so does a panel that is rebuilt.
 */
const metadataByService = new Map<string, Promise<unknown>>();

/**
 * A service's capabilities document, fetched at most once per page.
 *
 * Exported because the panel wants the same document for a different reason:
 * the layer needs the picture, and `useWmsCalendar` needs the dates. Sharing
 * the cache rather than each fetching its own is worth the coupling — this is
 * the largest single request the WMS path makes.
 *
 * Whoever asks first pays for it, layer or panel; a source is built here only
 * when the panel asks before any layer has rendered.
 */
export function serviceCapabilities(serviceUrl: string): Promise<unknown> {
  const source = new WMSImageSource(serviceUrl, wmsOptions(undefined, undefined));
  shareMetadata(source, serviceUrl, metadataByService);
  return source.getMetadata();
}

export class TimedWMSLayer extends DeckWMSLayer {
  static layerName = 'TimedWMSLayer';

  /**
   * The picture, drawn only inside the layer's box when its query gave one.
   *
   * A WMS paints the whole view it is asked for, and a service with no alpha
   * paints white wherever it has no data: IGN's Cassini map is an RGB PNG
   * whatever `TRANSPARENT` says, so a map of France covered the world in white.
   * The picture is cut to the box in the bitmap's fragment shader — deck's
   * `ClipExtension`, which discards every pixel outside a rectangle — so what
   * the server painted elsewhere is never drawn, and never picked: a click
   * there asks the service nothing.
   *
   * Cut rather than asked for less. Requesting only the part of the view inside
   * the box would save the server some pixels, but every request of upstream's
   * layer is built from the viewport in one method, together with the size and
   * the cache of the last picture, and reshaping it from outside means
   * reimplementing it. The cut touches nothing of how the picture is fetched.
   *
   * Where it is cut, and when it is not (a globe, a box that covers the world):
   * `wmsClipBounds`.
   */
  renderLayers(): Layer | null {
    const picture = super.renderLayers();
    const box = (this.props as { clipBox?: WmsBox | null }).clipBox ?? null;
    if (!picture || !box) {
      return picture;
    }
    // kepler's own test for a globe: only the globe viewport has a resolution.
    const globe = Boolean((this.context.viewport as { resolution?: number }).resolution);
    const clipBounds = wmsClipBounds(box, this.state.bounds, globe);
    if (!clipBounds) {
      return picture;
    }
    const extensions = picture.props.extensions ?? [];
    return picture.clone({ extensions: [...extensions, BOX_CLIP], clipBounds } as Record<string, unknown>);
  }

  _createImageSource(props: ConstructorParameters<typeof DeckWMSLayer>[0]): ReturnType<
    DeckWMSLayer['_createImageSource']
  > {
    const { url, time, style } = readTimeFragment(String(props.data));
    const source = new WMSImageSource(url, wmsOptions(time, props.loadOptions, style));

    // Bound to the service rather than to this source, so the date and the
    // style can change without re-reading the catalogue.
    shareMetadata(source, url, metadataByService);

    return source as unknown as ReturnType<DeckWMSLayer['_createImageSource']>;
  }
}

/** Builds one, in the shape `withWmsTime` asks for. */
export const buildTimedWmsLayer = (props: Record<string, unknown>): unknown =>
  new TimedWMSLayer(props as ConstructorParameters<typeof DeckWMSLayer>[0]);
