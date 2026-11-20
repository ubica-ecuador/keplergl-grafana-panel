import type { LayerIcon } from './cogPaintedLayer';
import { XYZ_TILE_TYPE, type XyzTileMetadata, xyzMapLibreTemplate, xyzTileUrl } from '../data/xyzTiles';
import { shownInPane } from './paneVisibility';

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
  return {
    id: `${id}-xyz-tiles`,
    getTileUrl: (index: { x: number; y: number; z: number }) => xyzTileUrl(template, index, zoomIds),
    // What MapLibre draws instead on a relief base map (`reliefRasters.ts`).
    // Not for a service that names its zoom levels: a MapLibre template puts
    // the level's number in `{z}`, and asks PDOK for a matrix "8" it calls
    // "08". deck draws those tiles there instead, as it does off the relief.
    ...(zoomIds ? {} : { reliefTiles: native.template, reliefScheme: native.scheme }),
    opacity: opacity ?? 1,
    ...(typeof metadata?.minZoom === 'number' ? { minZoom: metadata.minZoom } : {}),
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

    formatLayerData(datasets: Record<string, { metadata?: XyzTileMetadata }>, ...rest: unknown[]): XyzTileLayerData {
      void rest;
      const dataId = this.config.dataId;
      return { metadata: dataId ? datasets?.[dataId]?.metadata : undefined };
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
