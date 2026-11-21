import type { LayerExtension } from '@deck.gl/core';

import { isPanelXyzId } from '../data/xyzDataset';
import type { WmsBox } from '../data/wmsDataset';
import { BOX_CLIP } from './boxClip';
import { boxOfMetadata, reliefBoundsOfBox, wmsClipBounds } from './wmsExtent';

/**
 * kepler's Vector Tile and Raster Tile layers, taught what a query's tiles
 * carry beside kepler's own metadata (`queryTilesetProtoDataset` in
 * `keplerAdapter.ts`): the box they are framed on and cut to (`tilesBbox`),
 * and the zoom levels the query gave (`tilesMinZoom`, `tilesMaxZoom`).
 *
 * The same two things the panel's own XYZ layer does for pictures
 * (`xyzTileLayer.ts`): no tile outside the box is asked for (deck's
 * `extent`), and every tile is cut to it (deck's `ClipExtension`, per tile,
 * as `xyzTileDeckLayer.ts` does), so a tileset that covers more than the
 * catalog says, or paints its sea, shows only what the query meant.
 *
 * And vector tiles a look of their own: kepler's starts with no outline and
 * one-pixel points, which reads on neither a dark nor a light base map — a
 * building is a faint tint, a point is gone. Only for the tiles a query
 * names: a tileset added by hand keeps kepler's defaults.
 *
 * Wrapped at the class, in the layer registry (`keplerStore.ts`), as the WMS
 * layer is: kepler builds the deck layers itself, and nothing outside the
 * class sees them.
 */

type Constructor<T> = new (...args: any[]) => T;

/** The look of a query's vector tiles: a filled tint under a solid outline, points that show. */
export const QUERY_VECTOR_STYLE = {
  opacity: 0.6,
  stroked: true,
  strokeOpacity: 1,
  strokeWidth: 1,
  radius: 4,
  radiusUnits: true,
} as const;

interface TileMetadata {
  tilesBbox?: unknown;
  tilesMinZoom?: unknown;
  tilesMaxZoom?: unknown;
}

interface KeplerLayerLike {
  config: { dataId?: string | null; visConfig: Record<string, unknown> };
  formatLayerData(datasets: unknown, oldLayerData: unknown, animationConfig: unknown): Record<string, unknown>;
  renderSubLayers?(props: Record<string, unknown>): unknown;
  renderLayer(opts: unknown): unknown[];
}

const zoom = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;

/**
 * What a query's tiles add to the props kepler hands deck's tile layer: the
 * zoom levels where kepler found none (a TileJSON that gives none, or no
 * TileJSON), and with a box its cut and its extent. Without the extent,
 * deck fills nothing below the first level; with one it would fill the box
 * with tiles of the first level, so the layer is hidden there instead
 * (`visibleMinZoom`), as the XYZ layer is.
 */
export function queryTileProps(
  data: { minZoom?: unknown; maxZoom?: unknown },
  metadata: TileMetadata | undefined
): Record<string, unknown> {
  const minZoom = zoom(data.minZoom) ?? zoom(metadata?.tilesMinZoom);
  const maxZoom = zoom(data.maxZoom) ?? zoom(metadata?.tilesMaxZoom);
  const box = boxOfMetadata(metadata);
  const extent = reliefBoundsOfBox(box);
  return {
    ...(minZoom !== undefined ? { minZoom } : {}),
    ...(maxZoom !== undefined ? { maxZoom } : {}),
    ...(box ? { clipBox: box } : {}),
    ...(extent ? { extent, ...(minZoom !== undefined ? { visibleMinZoom: minZoom } : {}) } : {}),
  };
}

/**
 * The bounds a tile is cut to: its own (kepler cuts each vector tile to its
 * edges, `mvt-layer.ts`) and the query's box, both at once, the box on the
 * copy of the world nearest the tile (`wmsClipBounds`). Null when the tile
 * lies outside the box; the tile's own bounds when the box cuts nothing.
 */
export function cutBounds(
  tileBounds: readonly number[] | undefined,
  box: WmsBox | null
): readonly number[] | null | undefined {
  const cut = wmsClipBounds(box, tileBounds ?? null, false);
  if (!cut) {
    return tileBounds;
  }
  if (!tileBounds || tileBounds.length !== 4) {
    return cut;
  }
  const out = [
    Math.max(tileBounds[0], cut[0]),
    Math.max(tileBounds[1], cut[1]),
    Math.min(tileBounds[2], cut[2]),
    Math.min(tileBounds[3], cut[3]),
  ];
  return out[0] < out[2] && out[1] < out[3] ? out : null;
}

const WITH_CLIP: LayerExtension[] = [BOX_CLIP];

export function withQueryVectorTiles<C extends Constructor<object>>(VectorTileLayer: C): C {
  class QueryVectorTileLayer extends (VectorTileLayer as Constructor<KeplerLayerLike>) {
    constructor(...args: any[]) {
      super(...args);
      const dataId = this.config?.dataId;
      if (typeof dataId === 'string' && isPanelXyzId(dataId)) {
        // Before any saved config is merged over it: a layer the author styled keeps its look.
        Object.assign(this.config.visConfig, QUERY_VECTOR_STYLE);
      }
    }

    formatLayerData(datasets: unknown, oldLayerData: unknown, animationConfig: unknown): Record<string, unknown> {
      const data = super.formatLayerData(datasets, oldLayerData, animationConfig);
      const dataId = this.config?.dataId;
      const dataset = dataId
        ? (datasets as Record<string, { metadata?: TileMetadata }> | undefined)?.[dataId]
        : undefined;
      return dataset ? { ...data, ...queryTileProps(data, dataset.metadata) } : data;
    }

    /**
     * Called by kepler's deck layer with the props of one tile, `this` the
     * deck layer's props: so the box comes in those props (`clipBox`), and
     * kepler's own is reached through `super`, which does not need `this`.
     * The tile's bounds are in degrees on the plane and on the globe alike —
     * kepler picks the clip extension that reads them so — and the box's are
     * too, so the cut is the same on both.
     */
    renderSubLayers(props: Record<string, unknown>): unknown {
      const box = (props.clipBox as WmsBox | undefined) ?? null;
      if (!box) {
        return super.renderSubLayers?.(props);
      }
      const clipBounds = cutBounds(props.clipBounds as number[] | undefined, box);
      if (clipBounds === null) {
        return [];
      }
      return super.renderSubLayers?.({ ...props, clipBounds });
    }
  }
  return QueryVectorTileLayer as unknown as C;
}

/**
 * kepler's Raster Tile layer, for a query's picture archive: the zoom levels,
 * the extent and the cut, on the one tile layer kepler's PMTiles branch
 * returns (`renderPMTilesLayer`). Its rasters of STAC and COGs are left
 * exactly as they are: they carry no box of a query.
 */
export function withQueryRasterTiles<C extends Constructor<object>>(RasterTileLayer: C): C {
  class QueryRasterTileLayer extends (RasterTileLayer as Constructor<KeplerLayerLike>) {
    renderLayer(opts: unknown): unknown[] {
      const layers = super.renderLayer(opts) ?? [];
      const dataId = this.config?.dataId;
      const metadata = (opts as { data?: { dataset?: { metadata?: TileMetadata } } } | undefined)?.data?.dataset
        ?.metadata;
      if (typeof dataId !== 'string' || !isPanelXyzId(dataId) || !metadata) {
        return layers;
      }
      const box = boxOfMetadata(metadata);
      if (!box) {
        return layers;
      }
      const extent = reliefBoundsOfBox(box);
      return layers.map((layer) => {
        const tileLayer = layer as {
          props?: { renderSubLayers?: (props: Record<string, unknown>) => unknown; minZoom?: number };
          clone?: (props: Record<string, unknown>) => unknown;
        };
        const render = tileLayer.props?.renderSubLayers;
        if (!render || !tileLayer.clone) {
          return layer;
        }
        const minZoom = tileLayer.props?.minZoom;
        return tileLayer.clone({
          ...(extent ? { extent, ...(minZoom ? { visibleMinZoom: minZoom } : {}) } : {}),
          renderSubLayers: (props: Record<string, unknown>) => {
            const bbox = (props.tile as { bbox?: { west: number; south: number; east: number; north: number } })?.bbox;
            const tileBounds = bbox ? [bbox.west, bbox.south, bbox.east, bbox.north] : undefined;
            if (cutBounds(tileBounds, box) === null) {
              return [];
            }
            // The box itself, as the XYZ layer cuts a picture, never the box
            // within the tile: a cut on a tile's own edge leaves a seam of
            // discarded pixels between neighbours.
            const clipBounds = wmsClipBounds(box, tileBounds ?? null, false);
            return render(
              clipBounds
                ? {
                    ...props,
                    clipBounds,
                    extensions: [...((props.extensions as LayerExtension[]) ?? []), ...WITH_CLIP],
                  }
                : props
            );
          },
        });
      });
    }
  }
  return QueryRasterTileLayer as unknown as C;
}
