import type { LayerIcon } from './cogPaintedLayer';
import { legendPictureOf } from '../data/serviceLegend';
import { XYZ_TILE_TYPE, type XyzTileMetadata, xyzMapLibreTemplate, xyzTileUrl } from '../data/xyzTiles';
import { shownInPane } from './paneVisibility';
import { boxOfMetadata, reliefBoundsOfBox } from './wmsExtent';

/**
 * The kepler layer that draws `{z}/{x}/{y}` raster tiles.
 *
 * The sibling of `esriImageLayer.ts`, and simpler: the server publishes a tile
 * scheme, so each tile's address comes from its index. Pure on purpose, like
 * its sibling: the base class and the deck layer factory come in as arguments,
 * and `xyzTileDeckLayer.ts` supplies the real ones.
 */

export type XyzTileDeckLayerFactory = (props: Record<string, unknown>) => unknown;

type Constructor<T> = new (...args: any[]) => T;

interface XyzTileLayerLike {
  id: string;
  readonly layerIcon?: unknown;
  config: { isVisible?: boolean; dataId?: string; visConfig?: { opacity?: number } };
}

interface XyzTileLayerData {
  metadata?: XyzTileMetadata;
}

/** The props for deck's `TileLayer`, or null without a template. */
export function xyzDeckProps(args: {
  id: string;
  metadata?: XyzTileMetadata;
  opacity?: number;
}): Record<string, unknown> | null {
  const { id, metadata, opacity } = args;
  const template = metadata?.url?.trim();
  if (!template) {
    return null;
  }
  const zoomIds = metadata?.zoomIds && Object.keys(metadata.zoomIds).length ? metadata.zoomIds : undefined;
  const native = xyzMapLibreTemplate(template);
  // The query's box, as a WMS's (`wmsExtent.ts`): every tile is cut to it
  // (`clipBox`, `xyzTileDeckLayer.ts`), and no tile outside it is asked for —
  // deck's `extent`, MapLibre's `bounds` on a relief. Neither of those two for
  // a box across the antimeridian or round the world, which they cannot say.
  const box = boxOfMetadata(metadata);
  const extent = reliefBoundsOfBox(box);
  const minZoom = typeof metadata?.minZoom === 'number' ? metadata.minZoom : undefined;
  return {
    id: `${id}-xyz-tiles`,
    getTileUrl: (index: { x: number; y: number; z: number }) => xyzTileUrl(template, index, zoomIds),
    // What MapLibre draws instead on a relief base map (`reliefRasters.ts`).
    // Not for a service that names its zoom levels: a MapLibre template puts
    // the level's number in `{z}`, and asks PDOK for a matrix "8" it calls
    // "08". deck draws those tiles there instead, as it does off the relief.
    ...(zoomIds
      ? {}
      : { reliefTiles: native.template, reliefScheme: native.scheme, ...(extent ? { reliefBounds: extent } : {}) }),
    opacity: opacity ?? 1,
    ...(minZoom !== undefined ? { minZoom } : {}),
    ...(box ? { clipBox: box } : {}),
    // With an extent, deck fills it with tiles of the first level when the
    // view is zoomed out past it — a whole country of level-12 tiles — where
    // without one it draws nothing there. Nothing there, as before.
    ...(extent ? { extent, ...(minZoom !== undefined ? { visibleMinZoom: minZoom } : {}) } : {}),
    ...(typeof metadata?.maxZoom === 'number' ? { maxZoom: metadata.maxZoom } : {}),
    // deck caches tiles against its triggers: a new template, or new names
    // for its levels, must refetch.
    updateTriggers: { getTileData: zoomIds ? `${template} ${JSON.stringify(zoomIds)}` : template },
  };
}

export function makeXyzTileLayer<C extends Constructor<object>>(
  BaseLayer: C,
  buildDeckLayer: XyzTileDeckLayerFactory,
  icon?: LayerIcon
): C {
  class XyzTileLayer extends (BaseLayer as Constructor<XyzTileLayerLike>) {
    constructor(...args: any[]) {
      super(...args);
      // A picture can only be faded; without a registered control the layer
      // panel would offer nothing at all.
      (this as unknown as { registerVisConfig(configs: Record<string, string>): void }).registerVisConfig({
        opacity: 'opacity',
      });
    }

    get layerIcon(): unknown {
      return icon ?? super.layerIcon;
    }

    get type(): string {
      return XYZ_TILE_TYPE;
    }

    get name(): string {
      return 'XYZ tiles';
    }

    get requiredLayerColumns(): string[] {
      return [];
    }

    get supportedDatasetTypes(): string[] {
      return [XYZ_TILE_TYPE];
    }

    get requireData(): boolean {
      return false;
    }

    /** Claims the panel's tile datasets and no others, with an id a saved map can name. */
    static findDefaultLayerProps(dataset: { type?: string; id?: string; label?: string }): {
      props: Array<Record<string, unknown>>;
    } {
      if (dataset?.type !== XYZ_TILE_TYPE) {
        return { props: [] };
      }
      return {
        props: [
          { id: `${dataset.id}-layer`, dataId: dataset.id, label: dataset.label ?? 'XYZ tiles', isVisible: true },
        ],
      };
    }

    /** Renderable on visibility alone: tiles have no rows. */
    shouldRenderLayer(): boolean {
      return Boolean(this.type && this.config.isVisible);
    }

    /**
     * The tiles' legend, as kepler's map legend reads it: the picture of the
     * row's `legend_url` (a WMTS style's LegendURL), shown as kepler shows a
     * WMS's. Taken from the dataset whenever kepler formats the layer's data —
     * the one moment the layer sees it — as the ArcGIS layer does
     * (`esriImageLayer.ts`), so the legend of another style comes with the
     * dataset that draws it.
     */
    xyzLegendPicture: string | null = null;

    getLegendImageUrl(): string | null {
      return this.xyzLegendPicture;
    }

    /**
     * Nothing of colour or size: the tiles are the service's pictures. Left to
     * the base class, kepler's legend drew the layer's unused colour as a
     * swatch, as if the tiles were painted in it.
     */
    getLegendVisualChannels(): Record<string, unknown> {
      return {};
    }

    formatLayerData(datasets: Record<string, { metadata?: XyzTileMetadata }>, ...rest: unknown[]): XyzTileLayerData {
      void rest;
      const dataId = this.config.dataId;
      const metadata = dataId ? datasets?.[dataId]?.metadata : undefined;
      this.xyzLegendPicture = legendPictureOf(metadata?.legendUrl);
      return { metadata };
    }

    renderLayer(opts?: { data?: XyzTileLayerData; visible?: boolean }): unknown[] {
      const visible = this.config.isVisible !== false && shownInPane(opts);
      const props = xyzDeckProps({
        id: this.id,
        metadata: opts?.data?.metadata,
        opacity: this.config.visConfig?.opacity,
      });
      return props ? [buildDeckLayer({ ...props, visible })] : [];
    }
  }

  return XyzTileLayer as unknown as C;
}
