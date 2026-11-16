/**
 * Tiles of Gaussian splats inside deck's Tile3DLayer.
 *
 * The loader (`tile3dLoader.ts`) reads a splat tile's splats into
 * `content.splats`; deck would hand the tile to a ScenegraphLayer, which has
 * no glTF to draw. Here a tile with splats gets a {@link GaussianSplatLayer}
 * per primitive instead, placed as deck places a glTF tile (its cartographic
 * origin and model matrix, the glTF node's transform on top), and the tiles'
 * layers are drawn farthest first, so that one tile's splats blend over the
 * tiles behind it. Within a tile, the layer sorts its own splats.
 */

import { GaussianSplatLayer, SPLAT_PARAMETERS } from './gaussianSplatLayer';
import { cartographicOf, isIdentity } from '../tile3dAltitude';
import { multiply, type SplatChunk } from './glbSplats';

/** What this module reads of a loaders.gl tile. */
export interface SplatTileLike {
  id: string;
  content?: {
    splats?: SplatChunk[];
    cartographicOrigin?: ArrayLike<number>;
    modelMatrix?: ArrayLike<number>;
  } | null;
  tileDrawn?: boolean;
}

/** Whether a tile's content is splats (read, or found unreadable). */
export function isSplatTile(tile: SplatTileLike | null | undefined): boolean {
  return Array.isArray(tile?.content?.splats);
}

/** A splat tile's layers, one per primitive, with the props deck's own sublayers get. */
export function splatTileLayers(
  tile: SplatTileLike,
  layerId: string,
  subLayerProps: Record<string, unknown>
): GaussianSplatLayer[] {
  const { splats = [], cartographicOrigin, modelMatrix } = tile.content ?? {};
  const placed = Array.from(modelMatrix ?? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  const markDrawn = () => {
    tile.tileDrawn = true;
  };
  if (splats.length === 0) {
    // Nothing to draw: the tile is done, or loaders.gl would hold the tiles it replaces for ever.
    markDrawn();
    return [];
  }
  return splats.map(
    (chunk, i) =>
      new GaussianSplatLayer(subLayerProps, {
        id: `${layerId}-splats-${tile.id}-${i}`,
        tile,
        splats: chunk.splats,
        coordinateSystem: 'meter-offsets',
        coordinateOrigin: cartographicOrigin ? Array.from(cartographicOrigin) : [0, 0, 0],
        modelMatrix: multiply(placed, chunk.matrix),
        pickable: false,
        // Over whatever kepler hands its sublayers (see SPLAT_PARAMETERS).
        parameters: { ...((subLayerProps.parameters as object) ?? {}), ...SPLAT_PARAMETERS },
        onFirstDraw: markDrawn,
      } as any)
  );
}

interface ViewportLike {
  cameraPosition?: ArrayLike<number>;
  projectPosition?: (xyz: number[]) => number[];
}

/** How far from the camera a layer's tile stands, in deck's common units; null if it cannot be told. */
function distanceOf(layer: any, viewport: ViewportLike | null | undefined): number | null {
  const origin = layer?.props?.coordinateOrigin;
  const camera = viewport?.cameraPosition;
  if (!origin || !camera || typeof viewport?.projectPosition !== 'function') {
    return null;
  }
  const [x, y, z] = viewport.projectPosition(Array.from(origin as ArrayLike<number>));
  return Math.hypot(x - camera[0], y - camera[1], (z ?? 0) - camera[2]);
}

/** glTF's y up turned to 3D Tiles' z up, as loaders.gl turns a glTF tile (`rotateX(π/2)`), column-major. */
const Y_UP_TO_Z_UP = [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1];

/** Splats sampled per tile for its base. */
const BASE_SAMPLE = 4096;

/** The share of a tile's splats taken to lie below its ground: strays under the surface. */
const BASE_PERCENTILE = 0.02;

/**
 * How high above the ellipsoid a splat tile's lowest splats stand: the 2nd
 * percentile of the heights of a sample of them, placed by the tile's own
 * transforms as its tileset states them (`transform` down the tree, the glTF's
 * y up turned z up, the node's matrix), not by the matrices the panel moves
 * when it puts a tileset on the ground, so the answer does not follow the move.
 * Null for a tile with no splats or no transform to place them by.
 */
export function splatTileBase(tile: any): number | null {
  const chunks: SplatChunk[] | undefined = tile?.content?.splats;
  if (!Array.isArray(chunks) || chunks.length === 0) {
    return null;
  }
  let placed: number[] = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const chain: any[] = [];
  for (let link = tile; link; link = link.parent) {
    chain.unshift(link);
  }
  let transformed = false;
  for (const link of chain) {
    const transform = link.transform ?? link.header?.transform;
    if (transform && transform.length >= 16 && !isIdentity(transform)) {
      placed = multiply(placed, Array.from(transform as ArrayLike<number>));
      transformed = true;
    }
  }
  if (!transformed) {
    return null;
  }
  if ((tile.content.gltfUpAxis ?? 'Y') === 'Y') {
    placed = multiply(placed, Y_UP_TO_Z_UP);
  }
  const heights: number[] = [];
  for (const chunk of chunks) {
    const m = multiply(placed, chunk.matrix);
    const { count, positions } = chunk.splats;
    const step = Math.max(1, Math.floor((count * chunks.length) / BASE_SAMPLE));
    for (let i = 0; i < count; i += step) {
      const [x, y, z] = [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]];
      const ecef = [0, 1, 2].map((r) => m[r] * x + m[4 + r] * y + m[8 + r] * z + m[12 + r]);
      heights.push(cartographicOf(ecef)[2]);
    }
  }
  if (heights.length === 0) {
    return null;
  }
  heights.sort((a, b) => a - b);
  return heights[Math.floor(heights.length * BASE_PERCENTILE)];
}

/**
 * Lowers the base a tileset of splats is grounded by to a newly loaded tile's,
 * if it lies lower. True when it moved: the layer is to be updated, and the
 * tileset put on the ground again.
 */
export function noteSplatBase(tileset: { splatBase?: number | null } | null | undefined, tile: any): boolean {
  if (!tileset || !tile || noted.has(tile)) {
    return false;
  }
  noted.add(tile);
  const base = splatTileBase(tile);
  if (base === null || !Number.isFinite(base)) {
    return false;
  }
  const current = tileset.splatBase;
  if (typeof current === 'number' && base >= current - 0.5) {
    return false;
  }
  tileset.splatBase = base;
  return true;
}

const noted = new WeakSet<object>();

/** WGS 84. */
const A = 6378137;
const E2 = 6.69437999014e-3;

/** East, north, up at a place to ECEF, column-major: what loaders.gl's cartographic model matrix is relative to. */
export function enuToEcef(longitude: number, latitude: number, height: number): number[] {
  const l = (longitude * Math.PI) / 180;
  const p = (latitude * Math.PI) / 180;
  const n = A / Math.sqrt(1 - E2 * Math.sin(p) ** 2);
  const [sl, cl, sp, cp] = [Math.sin(l), Math.cos(l), Math.sin(p), Math.cos(p)];
  return [
    -sl,
    cl,
    0,
    0,
    -sp * cl,
    -sp * sl,
    cp,
    0,
    cp * cl,
    cp * sl,
    sp,
    0,
    (n + height) * cp * cl,
    (n + height) * cp * sl,
    (n * (1 - E2) + height) * sp,
    1,
  ];
}

/** A child loaders.gl may need drawn: in view, or not yet known to be out of it. */
function inView(tile: any): boolean {
  return tile?.isVisibleAndInRequestVolume !== false;
}

/** How many tiles up a tile stands from its root. */
function depthOf(tile: any): number {
  let depth = 0;
  for (let p = tile?.parent; p; p = p.parent) {
    depth++;
  }
  return depth;
}

/** Whether `ancestor` is above `tile` in the tree. */
function isAbove(ancestor: unknown, tile: any): boolean {
  for (let p = tile?.parent; p; p = p.parent) {
    if (p === ancestor) {
      return true;
    }
  }
  return false;
}

/**
 * Whether a tile's ground is drawn by the tiles drawn now: by itself, or by
 * every child of it in view. A tile with nothing to draw (no content) is; an
 * external tileset not yet loaded is not, nor a tile whose content is not
 * drawn and has no child to stand in for it.
 */
export function coveredBy(tile: any, drawn: ReadonlySet<unknown>, depth = 0): boolean {
  if (drawn.has(tile)) {
    return true;
  }
  if (!tile || depth > 32) {
    return false;
  }
  const children = (Array.isArray(tile.children) ? tile.children : []).filter(inView);
  if (children.length === 0) {
    return Boolean(tile.hasEmptyContent);
  }
  return children.every((child: any) => coveredBy(child, drawn, depth + 1));
}

/**
 * The drawn tiles to leave undrawn, so that each place shows one level of
 * detail: a tile whose children in view are all covered gives way to them;
 * one with a child in view not yet covered is drawn alone, every finer tile
 * drawn under it left out until they all are. Top down: what a tile decides
 * for its descendants stands.
 */
export function tilesGivingWay(drawn: ReadonlySet<unknown>): Set<unknown> {
  const hidden = new Set<unknown>();
  const byDepth = [...drawn].sort((a, b) => depthOf(a) - depthOf(b));
  for (const tile of byDepth as any[]) {
    if (hidden.has(tile) || tile.refine === 1) {
      continue;
    }
    const children = (Array.isArray(tile.children) ? tile.children : []).filter(inView);
    if (children.length > 0 && children.every((child: any) => coveredBy(child, drawn))) {
      hidden.add(tile);
      continue;
    }
    for (const other of byDepth) {
      if (other !== tile && isAbove(tile, other)) {
        hidden.add(other);
      }
    }
  }
  return hidden;
}

/**
 * The tiles' layers in drawing order: everything else first, as deck had it,
 * then the splat layers farthest first.
 *
 * And one level of detail at a time, as 3D Tiles' replacement means. loaders.gl
 * draws a tile that refines by replacement together with those of its children
 * already loaded, until every child is (`updateAndPushChildren` pushes the
 * visible children before it knows whether all are ready). For a mesh the two
 * overlap unseen; splats, translucent and sorted tile by tile, showed both as a
 * grey fur. Leaving a coarse tile's splats out inside the boxes of the finer
 * ones drawn left holes where a finer tile's splats did not fill its box. So a
 * coarse tile gives way only once every child of it in view is drawn, or is
 * covered by its own; until then it is drawn alone (`tilesGivingWay`).
 */
export function orderSplatLayers<T>(
  layers: T[] | null | undefined,
  viewport: ViewportLike | null | undefined
): T[] | null | undefined {
  if (!Array.isArray(layers)) {
    return layers;
  }
  const flat = (layers as unknown[]).flat(Infinity) as T[];
  const splatLayers = flat.filter((layer) => layer instanceof GaussianSplatLayer) as unknown as GaussianSplatLayer[];
  if (splatLayers.length === 0) {
    return layers;
  }
  const others = flat.filter((layer) => !(layer instanceof GaussianSplatLayer));

  const tileOf = (layer: GaussianSplatLayer) => (layer.props as any).tile;
  // Drawn as deck's Tile3DLayer decides (`filterSubLayer`): selected, and for this viewport.
  const viewportId = (viewport as { id?: string } | null | undefined)?.id;
  const drawnHere = (tile: any) =>
    Boolean(tile?.selected) &&
    (!viewportId || !Array.isArray(tile.viewportIds) || tile.viewportIds.includes(viewportId));
  const drawn = new Set(splatLayers.map(tileOf).filter(drawnHere));
  const hidden = tilesGivingWay(drawn);
  const shown = splatLayers.map((layer) =>
    hidden.has(tileOf(layer)) && layer.props.visible !== false
      ? (layer.clone({ visible: false }) as GaussianSplatLayer)
      : layer
  );

  const far = shown
    .map((layer) => ({ layer, distance: distanceOf(layer, viewport) ?? 0 }))
    .sort((a, b) => b.distance - a.distance)
    .map(({ layer }) => layer);
  return [...others, ...(far as unknown as T[])];
}
