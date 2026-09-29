/**
 * Buildings on the flat map, each on its own ground.
 *
 * Cesium OSM Buildings — and any tileset built the same way — places every
 * building at the real altitude of its base, taken from a terrain model. The
 * panel's map is flat at z = 0 and deck.gl's camera ignores terrain, so no one
 * height can put such a tileset on it: lowered by the ground under the centre
 * of the view (`tile3dAltitude.ts`), Cuenca's buildings were drawn from −125 m
 * to +800 m above the map (measured 2026-09-28 on ion asset 96188), those on
 * the hills round the city hundreds of metres in the air, and the same in San
 * Francisco. Large buildings kept in coarse tiles sank besides, ~d²/2R below
 * the map at d from their tile's origin (~60 m at 28 km), because deck draws a
 * tile on its origin's tangent plane.
 *
 * So a tileset of buildings has each one moved down on its own, as its tile
 * loads, until its lowest vertex is drawn on the map ({@link flattenBuildings}).
 * The tileset itself is then put nowhere but where the Height adjustment says.
 * Measured in the frame deck actually draws — the content's drawing matrix,
 * the glTF node's, and the origin's height — so the tangent plane's drop and
 * deck's metres (`tile3dDeckMetres.ts`) are already in it.
 *
 * **Which tilesets.** Only batched ones: contents whose vertices carry the id
 * of the feature they belong to, and more than one feature ({@link hasBuildings}).
 * That is how buildings come — one feature each. Google's Photorealistic 3D
 * Tiles carry no feature ids: their mesh is the ground itself, and it keeps
 * being lowered by the ground under the view. A photogrammetry mesh is one
 * feature or none, and a point cloud or I3S has no glTF to move.
 *
 * **What the traversal culls against has to come down too.** loaders.gl culls
 * a tile by its bounding volume, at the tile's real altitude, and a building
 * drawn on the map at street level while its tile is culled 2 500 m up is not
 * drawn at all: that is why a tileset round the world had been lowered by the
 * ground under the view in the first place. So each tile is culled by a box
 * from the map up to as tall as its own volume ({@link setVolumesFlat}).
 *
 * What it does not do: a building standing on a slope keeps the slope of its
 * roof relative to its base, since only its lowest vertex is put on the map;
 * and the map is flat, so no relief is shown.
 */

import {
  cartographicOf,
  drawsCartographic,
  hasOwnTransform,
  type TileContentLike,
  type TileLike,
} from './tile3dAltitude';
import { regionBox } from './tile3dLoader';

/** A post-processed glTF accessor, as loaders.gl leaves it and luma.gl reads it (`value`, `normalized`). */
interface AccessorLike {
  value?: ArrayLike<number> | null;
  components?: number;
  componentType?: number;
  normalized?: boolean;
  min?: number[];
  max?: number[];
  bytesPerComponent?: number;
  bytesPerElement?: number;
  [key: string]: unknown;
}

interface NodeLike {
  matrix?: ArrayLike<number> | null;
  translation?: ArrayLike<number> | null;
  rotation?: ArrayLike<number> | null;
  scale?: ArrayLike<number> | null;
  mesh?: { primitives?: Array<{ attributes?: Record<string, AccessorLike | undefined> | null }> | null } | null;
  children?: NodeLike[] | null;
}

interface GltfLike {
  scenes?: Array<{ nodes?: NodeLike[] | null } | null> | null;
  [key: string]: unknown;
}

/** A loaded tile's content, as far as this module reads it. */
export interface BuildingsContentLike extends TileContentLike {
  /** loaders.gl's: `b3dm`, `glTF`, `i3dm`, `pnts`… */
  type?: string;
  /** A b3dm's feature table: `BATCH_LENGTH` is how many features it holds. */
  featureTableJson?: { BATCH_LENGTH?: unknown } | null;
  /** Post-processed: accessors resolved, each with its `value`. */
  gltf?: GltfLike | null;
  /** An i3dm's instances: one model placed many times, not buildings. */
  instances?: unknown;
}

/** The vertex attributes that say which feature a vertex belongs to: 3D Tiles 1.0's, its glTF 1.0 spelling, and 1.1's. */
const FEATURE_IDS = ['_BATCHID', 'BATCHID', '_FEATURE_ID_0'];

/** glTF's `FLOAT`. */
const FLOAT = 5126;

/** One primitive to move: its positions, the feature of each vertex, and the node's matrix it is drawn with. */
interface Part {
  positions: AccessorLike;
  ids: ArrayLike<number>;
  world: number[];
}

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** Column-major 4×4 product. */
function multiply(a: ArrayLike<number>, b: ArrayLike<number>): number[] {
  const out = new Array<number>(16);
  for (let column = 0; column < 4; column++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        sum += a[k * 4 + row] * b[column * 4 + k];
      }
      out[column * 4 + row] = sum;
    }
  }
  return out;
}

/** A glTF node's own matrix: `matrix`, or translation × rotation (a quaternion) × scale — what luma.gl draws it with. */
function nodeMatrix(node: NodeLike): number[] {
  if (node.matrix && node.matrix.length >= 16) {
    return Array.from({ length: 16 }, (_, i) => node.matrix![i]);
  }
  const [tx, ty, tz] = node.translation && node.translation.length >= 3 ? Array.from(node.translation) : [0, 0, 0];
  const [x, y, z, w] = node.rotation && node.rotation.length >= 4 ? Array.from(node.rotation) : [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale && node.scale.length >= 3 ? Array.from(node.scale) : [1, 1, 1];
  return [
    (1 - 2 * (y * y + z * z)) * sx,
    2 * (x * y + z * w) * sx,
    2 * (x * z - y * w) * sx,
    0,
    2 * (x * y - z * w) * sy,
    (1 - 2 * (x * x + z * z)) * sy,
    2 * (y * z + x * w) * sy,
    0,
    2 * (x * z + y * w) * sz,
    2 * (y * z - x * w) * sz,
    (1 - 2 * (x * x + y * y)) * sz,
    0,
    tx,
    ty,
    tz,
    1,
  ];
}

/**
 * Every primitive of the scene deck draws — the first: `ScenegraphLayer` asks
 * luma.gl's scenes for `scenes[scene || 0]`, and luma.gl's carry no `scene` —
 * that has positions and feature ids, with the matrix of the node it hangs
 * from. A positions accessor shared by two primitives is moved once.
 */
function partsOf(gltf: GltfLike | null | undefined): Part[] {
  const parts: Part[] = [];
  const seen = new Set<AccessorLike>();
  const visit = (node: NodeLike | null | undefined, parent: number[], depth: number) => {
    if (!node || typeof node !== 'object' || depth > 64) {
      return;
    }
    const world = multiply(parent, nodeMatrix(node));
    for (const primitive of node.mesh?.primitives ?? []) {
      const attributes = primitive?.attributes;
      const positions = attributes?.POSITION;
      const ids = FEATURE_IDS.map((name) => attributes?.[name]?.value).find((value) => value && value.length > 0);
      const count = positions?.value ? positions.value.length / 3 : 0;
      if (!positions || seen.has(positions) || !ids || !(count >= 1) || ids.length < count) {
        continue;
      }
      if ((positions.components ?? 3) !== 3) {
        continue;
      }
      seen.add(positions);
      parts.push({ positions, ids, world });
    }
    for (const child of node.children ?? []) {
      visit(child, world, depth + 1);
    }
  };
  for (const node of gltf?.scenes?.[0]?.nodes ?? []) {
    visit(node, IDENTITY, 0);
  }
  return parts;
}

/**
 * Whether a content is batched buildings: vertices tagged with the feature
 * they belong to, over more than one feature. A b3dm says how many it holds
 * (`BATCH_LENGTH`); a glTF is counted.
 */
export function hasBuildings(content: BuildingsContentLike | null | undefined): boolean {
  if (!content?.gltf || content.instances) {
    return false;
  }
  const parts = partsOf(content.gltf);
  if (parts.length === 0) {
    return false;
  }
  if (content.type === 'b3dm' || content.featureTableJson) {
    return Number(content.featureTableJson?.BATCH_LENGTH) > 1;
  }
  const first = parts[0].ids[0];
  return parts.some(({ ids }) => Array.prototype.some.call(ids, (id: number) => id !== first));
}

/** What a normalized integer is divided by to come back to [−1, 1] or [0, 1]; 1 for anything else. */
function normalizer(accessor: AccessorLike): number {
  const value = accessor.value;
  if (!accessor.normalized) {
    return 1;
  }
  if (value instanceof Int8Array) {
    return 127;
  }
  if (value instanceof Uint8Array || value instanceof Uint8ClampedArray) {
    return 255;
  }
  if (value instanceof Int16Array) {
    return 32767;
  }
  if (value instanceof Uint16Array) {
    return 65535;
  }
  if (value instanceof Uint32Array) {
    return 4294967295;
  }
  return 1;
}

/** An accessor's positions as the floats luma.gl would hand the GPU: quantized ones brought back first. */
function floatsOf(accessor: AccessorLike): Float32Array {
  const value = accessor.value!;
  const divisor = normalizer(accessor);
  const out = new Float32Array(value.length);
  for (let i = 0; i < value.length; i++) {
    out[i] = divisor === 1 ? value[i] : Math.max(value[i] / divisor, -1);
  }
  return out;
}

/** The fields of a positions accessor this module rewrites, and so puts back. */
const REWRITTEN = ['value', 'componentType', 'normalized', 'min', 'max', 'bytesPerComponent', 'bytesPerElement'];

/** What each flattened content's accessors held before: exactly, so switching back is exact. */
const originals = new WeakMap<object, Array<{ accessor: AccessorLike; fields: Record<string, unknown> }>>();

/**
 * Moves every building of a content down, on its own, until its lowest vertex
 * is drawn at `base` metres — where the tileset's own move has put the map,
 * {@link liftOf}. Returns whether anything moved; a content is moved once, and
 * put back by {@link restoreBuildings}.
 *
 * A vertex is drawn at `(drawing matrix × node matrix × position).z` plus the
 * origin's height; its building's lowest such height is `h`. It is moved by
 * `(h − base) · L⁻¹·ẑ`, `L` being the linear part of that product: straight
 * down, as drawn, and by exactly that much. The east and north of every
 * vertex stay where they were.
 *
 * The positions become new float arrays — quantized ones brought back to
 * floats (KHR_mesh_quantization), their accessor saying so — and the content a
 * new glTF object: deck builds a tile's scenegraph only when handed a new one.
 */
export function flattenBuildings(content: BuildingsContentLike | null | undefined, base = 0): boolean {
  const drawing = content?.cartographicModelMatrix;
  const originHeight = content?.cartographicOrigin?.[2];
  if (
    !content ||
    originals.has(content) ||
    !drawing ||
    drawing.length < 16 ||
    typeof originHeight !== 'number' ||
    !Number.isFinite(originHeight) ||
    !drawsCartographic(content) ||
    !hasBuildings(content)
  ) {
    return false;
  }

  const parts = partsOf(content.gltf).map((part) => ({
    ...part,
    matrix: multiply(drawing, part.world),
    moved: floatsOf(part.positions),
  }));
  const lowest = new Map<number, number>();
  for (const { ids, matrix, moved } of parts) {
    for (let i = 0; i < moved.length / 3; i++) {
      const [x, y, z] = [moved[i * 3], moved[i * 3 + 1], moved[i * 3 + 2]];
      const height = matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14] + originHeight;
      const id = ids[i];
      if (Number.isFinite(height) && !(lowest.get(id)! <= height)) {
        lowest.set(id, height);
      }
    }
  }

  const saved: Array<{ accessor: AccessorLike; fields: Record<string, unknown> }> = [];
  for (const { positions, ids, matrix, moved } of parts) {
    // L⁻¹·ẑ: the third column of the inverse, from the cross products of L's columns.
    const [c0, c1, c2] = [0, 4, 8].map((k) => [matrix[k], matrix[k + 1], matrix[k + 2]]);
    const cross = (a: number[], b: number[]) => a[0] * b[1] - a[1] * b[0];
    const determinant =
      c0[0] * (c1[1] * c2[2] - c1[2] * c2[1]) -
      c0[1] * (c1[0] * c2[2] - c1[2] * c2[0]) +
      c0[2] * (c1[0] * c2[1] - c1[1] * c2[0]);
    if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) {
      continue;
    }
    const down = [cross(c1, c2) / determinant, cross(c2, c0) / determinant, cross(c0, c1) / determinant];

    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < moved.length / 3; i++) {
      const drop = (lowest.get(ids[i]) ?? base) - base;
      for (let axis = 0; axis < 3; axis++) {
        moved[i * 3 + axis] -= drop * down[axis];
        min[axis] = Math.min(min[axis], moved[i * 3 + axis]);
        max[axis] = Math.max(max[axis], moved[i * 3 + axis]);
      }
    }

    const fields: Record<string, unknown> = {};
    for (const key of REWRITTEN) {
      if (key in positions) {
        fields[key] = positions[key];
      }
    }
    saved.push({ accessor: positions, fields });
    Object.assign(positions, {
      value: moved,
      componentType: FLOAT,
      normalized: false,
      min,
      max,
      bytesPerComponent: 4,
      bytesPerElement: 12,
    });
  }
  if (saved.length === 0) {
    return false;
  }
  originals.set(content, saved);
  content.gltf = { ...content.gltf };
  return true;
}

/** Puts a content flattened by {@link flattenBuildings} back as it loaded. Returns whether there was anything to put back. */
export function restoreBuildings(content: BuildingsContentLike | null | undefined): boolean {
  const saved = content ? originals.get(content) : undefined;
  if (!content || !saved) {
    return false;
  }
  for (const { accessor, fields } of saved) {
    for (const key of REWRITTEN) {
      if (key in fields) {
        accessor[key] = fields[key];
      } else {
        delete accessor[key];
      }
    }
  }
  originals.delete(content);
  content.gltf = { ...content.gltf };
  return true;
}

/**
 * How far the tileset's own move (its model matrix, a translation) has lifted
 * a loaded content, in metres: the height of the origin deck draws it round,
 * less the height it would have had unmoved. What {@link flattenBuildings}
 * puts the buildings' bases at, so that once the tileset is put where the
 * Height adjustment says they sit on the map.
 */
export function liftOf(
  content: BuildingsContentLike | null | undefined,
  modelMatrix: ArrayLike<number> | null | undefined
): number {
  const origin = content?.cartesianOrigin;
  if (!origin || origin.length < 3 || !modelMatrix || modelMatrix.length < 16) {
    return 0;
  }
  const translation = [modelMatrix[12], modelMatrix[13], modelMatrix[14]];
  if (translation.every((value) => value === 0)) {
    return 0;
  }
  const unmoved = [origin[0] - translation[0], origin[1] - translation[1], origin[2] - translation[2]];
  return cartographicOf(origin)[2] - cartographicOf(unmoved)[2];
}

/*
 * Culling where the buildings are drawn.
 */

/** A box or sphere whose centre lies this far from the centre of the Earth is written in ECEF, on the globe. */
const ON_THE_GLOBE = 6_000_000;

/** A box wider than this, in metres from its centre, is not read as a region: its sides bend with the Earth. */
const MAX_BOX_HALF_EXTENT = 50_000;

/** WGS 84's equatorial radius, in metres. */
const EARTH_RADIUS = 6_378_137;

/**
 * The region an ECEF box stands on: the longitudes, latitudes and heights of
 * its corners, the highest raised by how far a face's middle can stand above
 * its corners as the ground curves away under them. Null for a box not on the
 * globe — Google's root, centred on the centre of the Earth, holds everything
 * anyway — or too wide to read so.
 */
function regionOfBox(box: ArrayLike<number>): number[] | null {
  const centre = [box[0], box[1], box[2]];
  const axes = [0, 1, 2].map((i) => [box[3 + i * 3], box[4 + i * 3], box[5 + i * 3]]);
  const lengths = axes.map((axis) => Math.hypot(axis[0], axis[1], axis[2]));
  if (!(Math.hypot(centre[0], centre[1], centre[2]) > ON_THE_GLOBE) || !(Math.max(...lengths) <= MAX_BOX_HALF_EXTENT)) {
    return null;
  }
  const low = [Infinity, Infinity, Infinity];
  const high = [-Infinity, -Infinity, -Infinity];
  for (const a of [-1, 1]) {
    for (const b of [-1, 1]) {
      for (const c of [-1, 1]) {
        const corner = [0, 1, 2].map((k) => centre[k] + a * axes[0][k] + b * axes[1][k] + c * axes[2][k]);
        const [longitude, latitude, height] = cartographicOf(corner);
        [(longitude * Math.PI) / 180, (latitude * Math.PI) / 180, height].forEach((value, k) => {
          low[k] = Math.min(low[k], value);
          high[k] = Math.max(high[k], value);
        });
      }
    }
  }
  if (high[0] - low[0] > Math.PI) {
    return null;
  }
  const across = lengths.reduce((sum, length) => sum + length * length, 0);
  return [low[0], low[1], high[0], high[1], low[2], high[2] + across / (2 * EARTH_RADIUS)];
}

/**
 * The box a tile's buildings are culled by once each sits on the map: over the
 * same ground as its volume, from the map up to as tall as the volume. A
 * building in the tile stood between its lowest and highest heights, so it is
 * no taller than that. Null when the volume cannot be read as a region.
 */
function flatBox(volume: Record<string, ArrayLike<number> | undefined>): number[] | null {
  const region = volume.region && volume.region.length >= 6 ? Array.from(volume.region) : null;
  const ground = region ?? (volume.box && volume.box.length >= 12 ? regionOfBox(volume.box) : null);
  if (!ground || !ground.every(Number.isFinite)) {
    return null;
  }
  return regionBox([ground[0], ground[1], ground[2], ground[3], 0, Math.max(ground[5] - ground[4], 0)]);
}

/** A tile as {@link setVolumesFlat} reads and rebuilds it. */
export interface VolumeTileLike extends Pick<TileLike, 'transform' | 'header'> {
  header?: (TileLike['header'] & { boundingVolume?: Record<string, any> }) | null;
  parent?: VolumeTileLike | null;
  /** loaders.gl's own, private: builds the tile's culling volume again from its header. */
  _updateBoundingVolume?(header: unknown): void;
}

/** Each volume's box as it loaded and flattened; each tile, the box its culling volume was last built from. */
const volumeBoxes = new WeakMap<object, { real: ArrayLike<number> | undefined; flat: number[] }>();
const builtFrom = new WeakMap<object, unknown>();

/** Whether a tile, or one above it, carries a transform of its own: its volume is not in ECEF, and is left alone. */
function underTransform(tile: VolumeTileLike): boolean {
  for (let link: VolumeTileLike | null | undefined = tile; link; link = link.parent) {
    if (hasOwnTransform(link as TileLike)) {
      return true;
    }
  }
  return false;
}

/**
 * Has the traversal cull each tile where its buildings are drawn once
 * flattened, or where they stand when `flat` is false.
 *
 * loaders.gl reads a tile's `box` before its region (`tile3dLoader.ts` gives
 * every region one), so the header's box is swapped, the region kept for the
 * altitude code, and the tile's volume built again from it. The header is
 * shared by the tile of every viewport's tree, and whatever tile is built from
 * it later takes the box it holds then. Returns whether any tile changed.
 */
export function setVolumesFlat(tiles: Iterable<VolumeTileLike>, flat: boolean): boolean {
  let changed = false;
  for (const tile of tiles) {
    const header = tile?.header;
    const volume = header?.boundingVolume;
    if (!volume || typeof volume !== 'object' || underTransform(tile)) {
      continue;
    }
    let boxes = volumeBoxes.get(volume);
    if (!boxes) {
      const box = flat ? flatBox(volume) : null;
      if (!box) {
        continue;
      }
      boxes = { real: volume.box, flat: box };
      volumeBoxes.set(volume, boxes);
    }
    const wanted = flat ? boxes.flat : boxes.real;
    if (wanted) {
      volume.box = wanted;
    } else {
      delete volume.box;
    }
    if (!builtFrom.has(tile) || builtFrom.get(tile) !== wanted) {
      tile._updateBoundingVolume?.(header);
      builtFrom.set(tile, wanted);
      changed = true;
    }
  }
  return changed;
}
