import { TileLayer } from '@deck.gl/geo-layers';
import { BitmapLayer } from '@deck.gl/layers';

import type { PartTiles } from './cogPaintedLayer';

/**
 * The deck.gl layers that draw TiTiler's painted COG tiles.
 *
 * The twin of `zarrDeckLayer.ts`, and thin for the same reason: `/cog/…​.png`
 * answers with an ordinary image, already reprojected to Web Mercator and
 * already coloured, so there is no decoding, no colormap texture and no band
 * arithmetic here — a `TileLayer` to decide which tiles the viewport needs, and
 * a `BitmapLayer` to put each one on the map.
 *
 * Kept apart from `cogPaintedLayer.ts` so that module stays free of deck imports
 * and can be tested without loading the whole graph.
 */

/**
 * How many tiles to have in flight at once.
 *
 * Matched to the tile server rather than to the browser: TiTiler runs with
 * `WEB_CONCURRENCY: '4'` in the bench compose, and reading a COG is CPU-bound
 * work that blocks a worker. Asking for more than the server can work on at
 * once only lengthens the queue every request waits in.
 */
const MAX_REQUESTS = 4;

/** Puts one already-rendered tile on the map. */
function renderSubLayers(
  props: Record<string, unknown> & {
    data?: unknown;
    tile: { bbox: { west: number; south: number; east: number; north: number } };
  }
): unknown {
  // A tile outside the image arrives as null, and on this path that is the
  // ordinary case rather than a fault: a COG covers one UTM zone, so a map
  // showing more than one asks each layer for tiles it does not have and is
  // answered 404. Drawing nothing is right; throwing would take the map down.
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

type TileBox = { west: number; south: number; east: number; north: number };

/** Whether a piece's box touches a tile's; a piece that does not say where it lies is asked everywhere. */
export function touches(box: PartTiles['bbox'], tile: TileBox): boolean {
  return !box || (box[0] <= tile.east && box[2] >= tile.west && box[1] <= tile.north && box[3] >= tile.south);
}

/**
 * One tile of a scene of several images (a mosaic): the server's picture of each piece whose box touches the
 * tile, laid oldest first so the newest is on top. A piece the server has no tile for (404 outside its image) adds
 * nothing; a tile no piece covers is null, which draws nothing, as for a single image.
 */
export async function mosaicTile(
  parts: PartTiles[],
  tile: { index: { x: number; y: number; z: number }; bbox: TileBox; signal?: AbortSignal },
  load: (url: string, signal?: AbortSignal) => Promise<ImageBitmap | null> = loadImage
): Promise<ImageBitmap | HTMLCanvasElement | null> {
  const { x, y, z } = tile.index;
  const images = await Promise.all(
    parts
      .filter((part) => touches(part.bbox, tile.bbox))
      .map((part) =>
        load(part.template.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y)), tile.signal)
      )
  );
  const drawn = images.filter((image): image is ImageBitmap => image !== null);
  if (drawn.length <= 1) {
    return drawn[0] ?? null;
  }
  const canvas = document.createElement('canvas');
  canvas.width = drawn[0].width;
  canvas.height = drawn[0].height;
  const context = canvas.getContext('2d');
  for (const image of drawn) {
    context?.drawImage(image, 0, 0, canvas.width, canvas.height);
  }
  return canvas;
}

async function loadImage(url: string, signal?: AbortSignal): Promise<ImageBitmap | null> {
  try {
    const response = await fetch(url, { signal });
    return response.ok ? await createImageBitmap(await response.blob()) : null;
  } catch {
    return null;
  }
}

/** Builds the tile layer, in the shape `makeCogPaintedLayer` asks for. */
export const buildCogPaintedDeckLayer = (props: Record<string, unknown>): unknown => {
  const { partTiles, ...rest } = props as Record<string, unknown> & { partTiles?: PartTiles[] };
  return new TileLayer({
    tileSize: 256,
    maxRequests: MAX_REQUESTS,
    renderSubLayers,
    ...(partTiles?.length
      ? { getTileData: (tile: Parameters<typeof mosaicTile>[1]) => mosaicTile(partTiles, tile) }
      : {}),
    ...rest,
  } as never);
};
