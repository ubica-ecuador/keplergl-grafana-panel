import type { LayerIcon } from './cogPaintedLayer';
import { esriImageUrl, type TileBounds } from '../data/esriImageUrl';

/**
 * The kepler layer that draws an ArcGIS Image Service.
 *
 * The sibling of `cogPaintedLayer.ts`, and it exists because a service is not a
 * file. A COG is one raster with one footprint: a collection cut into 200 of
 * them needs 200 queries to cover the world, which is why the land-cover
 * dashboard draws a 2×2 block of UTM zones. An Image Service is a **mosaic
 * dataset** — the catalogue, the rule for choosing between its rasters, and a
 * pyramid over the whole thing — so it answers for any extent at any zoom from
 * a single endpoint. Measured on the land-cover service: 0,8-1,4 s a tile from
 * zoom 1 to zoom 8, the whole world included.
 *
 * The adaptation is small but it is real: the service publishes no tile scheme,
 * so there is no `{z}/{x}/{y}` template to hand deck. Each tile's url is built
 * from its bounds instead, which is what `getTileUrl` below is for.
 *
 * Pure on purpose — no kepler, no deck, no network. It receives the base class
 * and the deck layer factory as arguments so it can be exercised with stubs;
 * `esriImageDeckLayer.ts` supplies the real ones.
 */

/** Which service to draw, and how it should choose among its rasters. */
export interface EsriImageMetadata {
  /** The service endpoint, ending in `/ImageServer`. */
  serviceUrl: string;
  /** The service's own JSON for picking rasters — how a year is chosen. */
  mosaicRule?: string;
  /** The service's own JSON for drawing them. */
  renderingRule?: string;
}

/** Builds the deck layer — see `esriImageDeckLayer.ts`. */
export type EsriImageDeckLayerFactory = (props: Record<string, unknown>) => unknown;

// Contravariant constructor parameters, so `any[]` rather than `unknown[]`; the
// same reason `cogPaintedLayer.ts` gives.
type Constructor<T> = new (...args: any[]) => T;

/** The members of kepler's base layer this subclass touches. */
interface EsriImageLayerLike {
  id: string;
  /** kepler's placeholder, when the factory was handed no icon of its own. */
  readonly layerIcon?: unknown;
  config: { visConfig?: { opacity?: number; esriMosaicRule?: unknown } };
}

/** What kepler's `formatLayerData` hands back to `renderLayer`. */
interface EsriImageLayerData {
  metadata?: EsriImageMetadata;
}

/** The dataset type the panel mints for an Image Service. */
export const ESRI_IMAGE_TYPE = 'esriImage';

/**
 * The props for deck's `TileLayer`, or null when there is nothing to ask for.
 *
 * `getTileUrl` rather than a `data` template, because the service has no tile
 * scheme to fill in: the caller hands over one tile's bounds and gets back the
 * request that renders it.
 *
 * The rule is repeated in `updateTriggers.getTileData` deliberately, and that
 * repetition is the point. deck caches tiles against the triggers it was told
 * to watch, so a layer whose rule changed but whose triggers did not keeps
 * painting the first year for ever — the failure this repo already met with
 * PMTiles, where the tell was requests that were headers and directory reads
 * but never tiles.
 */
export function esriDeckProps(args: {
  id: string;
  metadata?: EsriImageMetadata;
  /** The rule a timeline chose, when it has chosen one. */
  mosaicRule?: string | null;
  opacity?: number;
}): Record<string, unknown> | null {
  const { id, metadata, mosaicRule, opacity } = args;
  if (!metadata || !metadata.serviceUrl.trim()) {
    return null;
  }

  const spec = {
    serviceUrl: metadata.serviceUrl,
    mosaicRule: mosaicRule || metadata.mosaicRule,
    renderingRule: metadata.renderingRule,
  };

  return {
    id: `${id}-esri-tiles`,
    getTileUrl: (bounds: TileBounds) => esriImageUrl(spec, bounds),
    opacity: opacity ?? 1,
    updateTriggers: {
      getTileData: `${spec.serviceUrl}|${spec.mosaicRule ?? ''}|${spec.renderingRule ?? ''}`,
    },
  };
}

/**
 * Wraps kepler's base layer class into one that draws an Image Service.
 *
 * Extends the base layer rather than `AbstractTileLayer` because deck's own
 * `TileLayer` does the tiling here: what kepler's tile base adds is a
 * `TileDataset` of rows to hover and click, and a rendered picture has none.
 */
export function makeEsriImageLayer<C extends Constructor<object>>(
  BaseLayer: C,
  buildDeckLayer: EsriImageDeckLayerFactory,
  icon?: LayerIcon
): C {
  class EsriImageLayer extends (BaseLayer as Constructor<EsriImageLayerLike>) {
    constructor(...args: any[]) {
      super(...args);
      // Without this the layer panel shows nothing at all: kepler's base class
      // starts with an empty `visConfigSettings`, and a layer that registers no
      // control gets none. Opacity is the one that matters here — what arrives
      // is a finished picture, so there is no ramp or band to offer, but a
      // thematic raster you cannot fade is one you can only switch off.
      (this as unknown as { registerVisConfig(configs: Record<string, string>): void }).registerVisConfig({
        opacity: 'opacity',
      });
    }


    get layerIcon(): unknown {
      // Left to the base class when none was handed in, rather than reported as
      // undefined: kepler draws a placeholder for a layer with no icon, and an
      // undefined one would leave a blank where that should be.
      return icon ?? super.layerIcon;
    }

    get type(): string {
      return ESRI_IMAGE_TYPE;
    }

    get name(): string {
      return 'ArcGIS Image Service';
    }

    get requiredLayerColumns(): string[] {
      return [];
    }

    get supportedDatasetTypes(): string[] {
      return [ESRI_IMAGE_TYPE];
    }

    /** A service has no rows, and asking for them would hide the layer. */
    get requireData(): boolean {
      return false;
    }

    /**
     * Claims the datasets the panel minted for a service, and no others.
     *
     * kepler walks every registered class asking this question when a dataset
     * arrives, so answering for someone else's would draw a second, broken
     * layer over a perfectly good one.
     */
    static findDefaultLayerProps(dataset: { type?: string; id?: string; label?: string }): {
      props: Array<Record<string, unknown>>;
    } {
      if (dataset?.type !== ESRI_IMAGE_TYPE) {
        return { props: [] };
      }
      // A deterministic id, derived from the dataset. kepler mints a random
      // hash when none is given, and a random id cannot be written down —
      // which is what kept a saved configuration from naming this layer at
      // all, `splitMaps` included, so a dashboard could not open already
      // split.
      return {
        props: [
          { id: `${dataset.id}-layer`, dataId: dataset.id, label: dataset.label ?? 'Image Service', isVisible: true },
        ],
      };
    }

    /**
     * Renderable on visibility alone, not on having rows.
     *
     * The base class decides with `hasLayerData`, which asks for `data.length`.
     * A tileset has none, so kepler would never call `renderLayer` — the map
     * stays empty and nothing is logged. `RasterTileLayer` overrides this for
     * exactly the same reason.
     */
    shouldRenderLayer(): boolean {
      return Boolean(this.type && (this.config as { isVisible?: boolean }).isVisible);
    }

    /** The metadata travels whole; there is no row to reshape. */
    formatLayerData(
      datasets: Record<string, { metadata?: EsriImageMetadata }>,
      ...rest: unknown[]
    ): EsriImageLayerData {
      void rest;
      const dataId = (this.config as { dataId?: string }).dataId;
      const dataset = dataId ? datasets?.[dataId] : undefined;
      return { metadata: dataset?.metadata };
    }

    renderLayer(opts?: { data?: EsriImageLayerData }): unknown[] {
      const visConfig = this.config?.visConfig;
      const chosen = visConfig?.esriMosaicRule;
      const props = esriDeckProps({
        id: this.id,
        metadata: opts?.data?.metadata,
        mosaicRule: typeof chosen === 'string' && chosen ? chosen : null,
        opacity: visConfig?.opacity,
      });

      return props ? [buildDeckLayer(props)] : [];
    }
  }

  return EsriImageLayer as unknown as C;
}
