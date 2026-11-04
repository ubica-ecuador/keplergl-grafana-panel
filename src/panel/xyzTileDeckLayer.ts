import { TileLayer } from '@deck.gl/geo-layers';
import { BitmapLayer } from '@deck.gl/layers';

import type { TileBounds } from '../data/esriImageUrl';

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

export const buildXyzTileDeckLayer = (props: Record<string, unknown>): unknown => {
  const { getTileUrl, ...rest } = props as { getTileUrl: (index: { x: number; y: number; z: number }) => string };
  return new TileLayer({
    tileSize: 256,
    maxRequests: MAX_REQUESTS,
    getTileData: (tile: { index: { x: number; y: number; z: number } }) => getTileUrl(tile.index),
    renderSubLayers,
    ...rest,
  } as never);
};
