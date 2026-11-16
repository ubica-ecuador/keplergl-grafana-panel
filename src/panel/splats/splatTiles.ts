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

import { GaussianSplatLayer, MAX_REPLACED, SPLAT_PARAMETERS, invert } from './gaussianSplatLayer';
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

/** A tile's bounding volume as an ECEF centre and three half-axes, or null. */
function boxOf(tile: any): { centre: number[]; axes: number[][] } | null {
  const volume = tile?.boundingVolume;
  const centre = volume?.center;
  if (!centre) {
    return null;
  }
  const halfAxes = volume.halfAxes;
  if (halfAxes && halfAxes.length >= 9) {
    return {
      centre: [centre[0], centre[1], centre[2]],
      axes: [0, 1, 2].map((c) => [halfAxes[c * 3], halfAxes[c * 3 + 1], halfAxes[c * 3 + 2]]),
    };
  }
  if (typeof volume.radius === 'number') {
    const r = volume.radius;
    return {
      centre: [centre[0], centre[1], centre[2]],
      axes: [
        [r, 0, 0],
        [0, r, 0],
        [0, 0, r],
      ],
    };
  }
  return null;
}

/** The inverse of a 3×3 matrix given as three columns, column-major, or null. */
function invert3(c: number[][]): number[] | null {
  const [a, b, d] = c; // columns
  const m = [a[0], b[0], d[0], a[1], b[1], d[1], a[2], b[2], d[2]]; // row-major
  const det =
    m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
  if (!det) {
    return null;
  }
  const i = [
    (m[4] * m[8] - m[5] * m[7]) / det,
    (m[2] * m[7] - m[1] * m[8]) / det,
    (m[1] * m[5] - m[2] * m[4]) / det,
    (m[5] * m[6] - m[3] * m[8]) / det,
    (m[0] * m[8] - m[2] * m[6]) / det,
    (m[2] * m[3] - m[0] * m[5]) / det,
    (m[3] * m[7] - m[4] * m[6]) / det,
    (m[1] * m[6] - m[0] * m[7]) / det,
    (m[0] * m[4] - m[1] * m[3]) / det,
  ]; // row-major inverse
  return [i[0], i[3], i[6], i[1], i[4], i[7], i[2], i[5], i[8]]; // column-major
}

/**
 * The boxes of `finer` tiles in a splat layer's own space: twelve numbers a box,
 * its centre and the inverse of its half-axes, as the layer's `replaced` prop.
 */
export function replacedBoxes(layer: GaussianSplatLayer, finer: any[]): Float32Array | null {
  const origin = layer.props.coordinateOrigin as number[] | undefined;
  const model = layer.props.modelMatrix as unknown as ArrayLike<number> | null;
  if (!origin || !model || finer.length === 0) {
    return null;
  }
  // ECEF to the layer's space: through east-north-up at its origin, then its model matrix.
  const toModel = invert(multiply(enuToEcef(origin[0], origin[1], origin[2] ?? 0), Array.from(model)));
  if (!toModel) {
    return null;
  }
  const out: number[] = [];
  for (const tile of finer.slice(0, MAX_REPLACED)) {
    const box = boxOf(tile);
    if (!box) {
      continue;
    }
    const c = box.centre;
    const centre = [0, 1, 2].map(
      (r) => toModel[r] * c[0] + toModel[4 + r] * c[1] + toModel[8 + r] * c[2] + toModel[12 + r]
    );
    const axes = box.axes.map((v) =>
      [0, 1, 2].map((r) => toModel[r] * v[0] + toModel[4 + r] * v[1] + toModel[8 + r] * v[2])
    );
    const inverse = invert3(axes);
    if (inverse) {
      out.push(...centre, ...inverse);
    }
  }
  return out.length ? new Float32Array(out) : null;
}

/** The nearest ancestor of a tile among `drawn`, or null. */
function drawnAncestor(tile: any, drawn: Set<unknown>): any {
  for (let p = tile?.parent; p; p = p.parent) {
    if (drawn.has(p)) {
      return p;
    }
  }
  return null;
}

/** The last boxes handed to each layer, kept so a layer is not told of new ones each frame for nothing. */
const lastBoxes = new Map<string, { key: string; boxes: Float32Array | null }>();

/**
 * The tiles' layers in drawing order: everything else first, as deck had it,
 * then the splat layers farthest first.
 *
 * And one level of detail at a time. loaders.gl draws a tile that refines by
 * replacement together with those of its children already loaded, until every
 * child is (`updateAndPushChildren` pushes the visible children before it knows
 * whether all are ready; a child outside the request volume never is). For a
 * mesh the two overlap unseen; splats, translucent and sorted tile by tile,
 * showed both as a grey fur. So a tile drawn under finer ones leaves out its
 * splats inside their boxes, and each place shows the finest splats loaded.
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
  const finerOf = new Map<unknown, any[]>();
  for (const tile of drawn) {
    const ancestor = drawnAncestor(tile, drawn);
    if (ancestor && ancestor.refine !== 1) {
      finerOf.set(ancestor, [...(finerOf.get(ancestor) ?? []), tile]);
    }
  }
  const placed = splatLayers.map((layer) => {
    const finer = finerOf.get(tileOf(layer)) ?? [];
    const key = finer.map((tile) => tile.id).join('|');
    let entry = lastBoxes.get(layer.id);
    if (!entry || entry.key !== key) {
      entry = { key, boxes: key ? replacedBoxes(layer, finer) : null };
      lastBoxes.set(layer.id, entry);
    }
    return entry.boxes === (layer.props.replaced ?? null)
      ? layer
      : (layer.clone({ replaced: entry.boxes }) as GaussianSplatLayer);
  });

  if (lastBoxes.size > 4 * splatLayers.length + 64) {
    const live = new Set(splatLayers.map((layer) => layer.id));
    for (const id of lastBoxes.keys()) {
      if (!live.has(id)) {
        lastBoxes.delete(id);
      }
    }
  }

  const far = placed
    .map((layer) => ({ layer, distance: distanceOf(layer, viewport) ?? 0 }))
    .sort((a, b) => b.distance - a.distance)
    .map(({ layer }) => layer);
  return [...others, ...(far as unknown as T[])];
}
