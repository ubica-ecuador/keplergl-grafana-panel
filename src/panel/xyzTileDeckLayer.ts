import type { LayerExtension } from '@deck.gl/core';
import { TileLayer } from '@deck.gl/geo-layers';
import { BitmapLayer } from '@deck.gl/layers';

import type { TileBounds } from '../data/esriImageUrl';
import type { WmsBox } from '../data/wmsDataset';
import { BOX_CLIP } from './boxClip';
import { wmsClipBounds } from './wmsExtent';

/**
 * The deck.gl layers that draw `{z}/{x}/{y}` tiles: deck's tiling, one bitmap
 * per tile, the address handed to deck's image loader so the browser's cache
 * applies. Kept apart from `xyzTileLayer.ts` so that module stays free of deck.
 */

const MAX_REQUESTS = 6;

function renderSubLayers(props: Record<string, unknown> & { data?: unknown; tile: { bbox: TileBounds } }): unknown {
  if (!props.data) {
    return null;
  }
  const { west, south, east, north } = props.tile.bbox;
  return new BitmapLayer(
    props as never,
    {
      data: undefined,
      image: props.data,
      bounds: [west, south, east, north],
    } as never
  );
}

const WITH_CLIP: LayerExtension[] = [BOX_CLIP];
const NO_CLIP: LayerExtension[] = [];

/** What a tile was handed for the box it was cut to, so the same box hands it the same objects. */
const cuts = new WeakMap<object, { key: string; props: Record<string, unknown> }>();

/**
 * deck's tiling, each tile cut to the query's box (`clipBox`).
 *
 * The cut is the WMS picture's (`wmsClipBounds`), made per tile: the box on
 * the copy of the world nearest the tile, deck's `ClipExtension` discarding
 * every pixel outside it, so the edge tiles stop at the box rather than at
 * their own edges and what a service paints outside its data — white, or a
 * neighbouring country's map — is never drawn. Not on a globe, as for a WMS.
 *
 * Through `getSubLayerPropsByTile`, deck's own hook for props that differ by
 * tile: it clones the tile's bitmap with them, and again only when one of
 * them is a new object, which is why each tile keeps the ones it was given
 * while the box and the projection stay.
 */
class ClippedTileLayer extends TileLayer {
  static layerName = 'ClippedTileLayer';

  getSubLayerPropsByTile(tile: Parameters<TileLayer['getSubLayerPropsByTile']>[0]): Record<string, unknown> | null {
    const box = (this.props as { clipBox?: WmsBox | null }).clipBox ?? null;
    if (!box) {
      return null;
    }
    // kepler's own test for a globe: only the globe viewport has a resolution.
    const globe = Boolean((this.context.viewport as { resolution?: number }).resolution);
    const key = `${box.join(' ')}|${globe}`;
    const held = cuts.get(tile);
    if (held?.key === key) {
      return held.props;
    }
    const [[west, south], [east, north]] = tile.boundingBox;
    const clipBounds = wmsClipBounds(box, [west, south, east, north], globe);
    const props = clipBounds ? { extensions: WITH_CLIP, clipBounds } : { extensions: NO_CLIP };
    cuts.set(tile, { key, props });
    return props;
  }
}

export const buildXyzTileDeckLayer = (props: Record<string, unknown>): unknown => {
  const { getTileUrl, ...rest } = props as { getTileUrl: (index: { x: number; y: number; z: number }) => string };
  return new ClippedTileLayer({
    tileSize: 256,
    maxRequests: MAX_REQUESTS,
    getTileData: (tile: { index: { x: number; y: number; z: number } }) => getTileUrl(tile.index),
    renderSubLayers,
    ...rest,
  } as never);
};
