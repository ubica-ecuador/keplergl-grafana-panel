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
 * **Which tilesets.** Only batched ones round the whole world — those lowered
 * by the ground under the view (`groundsUnderView`) — told apart by a content
 * whose vertices carry the id of the feature they belong to, over more than
 * one feature ({@link hasBuildings}). That is how buildings come: one feature
 * each. Google's Photorealistic 3D Tiles carry no feature ids: their mesh is
 * the ground itself, and it keeps being lowered by the ground under the view.
 * A photogrammetry mesh is one feature or none, and a point cloud or I3S has
 * no glTF to move. A smaller tileset of buildings — a city in LOD2, a BIM
 * model — stands on one ground and is lowered as a whole by its base.
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
 * a part that starts above the ground — an overhang, a skybridge, a tower's
 * upper section — is put on the map by its own lowest vertex, so it may land
 * with the parts below it; a building far from its tile's origin is left
 * buried ({@link MAX_FOOTPRINT_REACH}); and the map is flat, so no relief is
 * shown.
 */

import {
  cartographicOf,
  drawsCartographic,
  hasOwnTransform,
  type TileContentLike,
  type TileLike,
} from './tile3dAltitude';
import { regionBox } from './tile3dLoader';

/** The buffer a post-processed accessor was read from: loaders.gl keeps it, and the bytes, on the buffer view. */
interface BufferViewLike {
  byteOffset?: number;
  byteStride?: number;
  buffer?: { arrayBuffer?: ArrayBufferLike; byteOffset?: number } | null;
}

/** A post-processed glTF accessor, as loaders.gl leaves it and luma.gl reads it (`value`, `normalized`). */
interface AccessorLike {
  value?: ArrayLike<number> | null;
  components?: number;
  componentType?: number;
  normalized?: boolean;
  count?: number;
  byteOffset?: number;
  bufferView?: BufferViewLike | null;
  min?: number[];
  max?: number[];
  bytesPerComponent?: number;
  bytesPerElement?: number;
  [key: string]: unknown;
}

interface PrimitiveLike {
  attributes?: Record<string, AccessorLike | undefined> | null;
  [key: string]: unknown;
}

interface MeshLike {
  id?: string;
  primitives?: PrimitiveLike[] | null;
  [key: string]: unknown;
}

interface NodeLike {
  matrix?: ArrayLike<number> | null;
  translation?: ArrayLike<number> | null;
  rotation?: ArrayLike<number> | null;
  scale?: ArrayLike<number> | null;
  mesh?: MeshLike | null;
  children?: NodeLike[] | null;
}

interface GltfLike {
  scenes?: Array<{ nodes?: NodeLike[] | null } | null> | null;
  meshes?: MeshLike[] | null;
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

/**
 * The vertex attributes that say which feature a vertex belongs to: 3D Tiles
 * 1.0's, its glTF 1.0 spelling, and 1.1's.
 *
 * Not read: batch ids that come Draco-compressed, which loaders.gl decodes as
 * `CUSTOM_ATTRIBUTE_n`, their name lost. A tileset whose buildings all come
 * that way is never told apart as buildings, and is lowered by the ground
 * under the view like any other.
 */
const FEATURE_IDS = ['_BATCHID', 'BATCHID', '_FEATURE_ID_0'];

/** glTF's `FLOAT`. */
const FLOAT = 5126;

/** glTF's component types, as the arrays loaders.gl reads them into. */
const COMPONENT_ARRAYS: Record<
  number,
  { new (buffer: ArrayBufferLike): ArrayLike<number>; BYTES_PER_ELEMENT: number }
> = {
  5120: Int8Array,
  5121: Uint8Array,
  5122: Int16Array,
  5123: Uint16Array,
  5125: Uint32Array,
  5126: Float32Array,
};

/**
 * How far from the origin deck draws a tile round, in metres, a building's
 * footprint may reach and still be put on the map. Cesium OSM Buildings keeps
 * large buildings in coarse tiles (ADD refinement), some 60 km from the tile's
 * centre and further, to near the antipode: there the tile's tangent plane has
 * left the ground so far that a building put on the map by its lowest vertex
 * stood tilted and hundreds of metres to kilometres off. Such a building keeps
 * its geometry, buried below the map as before: hidden rather than misplaced.
 */
const MAX_FOOTPRINT_REACH = 50_000;

/** More features than this in one content, or ids that are not small whole numbers, and it is left as it is. */
const MAX_FEATURES = 10_000_000;

/**
 * One primitive to move: its positions, the feature of each vertex (none: the
 * content is one feature), the node's matrix it is drawn with, and — when its
 * positions are drawn by another node too, with another matrix — that node,
 * whose mesh is to be given positions of its own before this one is moved.
 */
interface Part {
  positions: AccessorLike;
  ids: ArrayLike<number> | null;
  world: number[];
  primitive: PrimitiveLike;
  node: NodeLike;
  shared: boolean;
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

function sameMatrix(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  for (let i = 0; i < 16; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

/** The feature ids of a primitive's vertices, if it has any. */
function featureIds(primitive: PrimitiveLike): ArrayLike<number> | null {
  for (const name of FEATURE_IDS) {
    const value = primitive.attributes?.[name]?.value;
    if (value && value.length > 0) {
      return value;
    }
  }
  return null;
}

/**
 * Every primitive with positions of the scene deck draws — the first:
 * `ScenegraphLayer` asks luma.gl's scenes for `scenes[scene || 0]`, and
 * luma.gl's carry no `scene` — with the matrix of the node it hangs from.
 *
 * Positions drawn twice with the same matrix — two primitives on one
 * accessor — are listed once. Drawn by two nodes with different matrices,
 * the second is marked `shared`: moving them once would move the other copy
 * by the wrong amount.
 */
function partsOf(gltf: GltfLike | null | undefined): Part[] {
  const parts: Part[] = [];
  const seen = new Map<AccessorLike, number[]>();
  const visit = (node: NodeLike | null | undefined, parent: number[], depth: number) => {
    if (!node || typeof node !== 'object' || depth > 64) {
      return;
    }
    const world = multiply(parent, nodeMatrix(node));
    for (const primitive of node.mesh?.primitives ?? []) {
      const positions = primitive?.attributes?.POSITION;
      const count = positions?.value ? positions.value.length / 3 : 0;
      if (!positions || !(count >= 1) || (positions.components ?? 3) !== 3) {
        continue;
      }
      const ids = featureIds(primitive);
      if (ids && ids.length < count) {
        continue;
      }
      const before = seen.get(positions);
      if (before && sameMatrix(before, world)) {
        continue;
      }
      if (!before) {
        seen.set(positions, world);
      }
      parts.push({ positions, ids, world, primitive, node, shared: Boolean(before) });
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
 * (`BATCH_LENGTH`); a glTF is counted. What tells a tileset of buildings
 * apart; once told, every content of it is put on the map
 * ({@link flattenBuildings}), one feature or many.
 */
export function hasBuildings(content: BuildingsContentLike | null | undefined): boolean {
  if (!content?.gltf || content.instances) {
    return false;
  }
  const parts = partsOf(content.gltf).filter((part) => part.ids);
  if (parts.length === 0) {
    return false;
  }
  if (content.type === 'b3dm' || content.featureTableJson) {
    return Number(content.featureTableJson?.BATCH_LENGTH) > 1;
  }
  const first = parts[0].ids![0];
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
  if (divisor === 1) {
    return Float32Array.from(value);
  }
  const out = new Float32Array(value.length);
  for (let i = 0; i < value.length; i++) {
    out[i] = Math.max(value[i] / divisor, -1);
  }
  return out;
}

/**
 * An accessor's values read again from its buffer view, as loaders.gl first
 * read them (`post-process-gltf.js`, `_resolveAccessor`): loaders.gl keeps the
 * tile's whole binary for the buffer views either way. Null when there is no
 * buffer view to read — Draco's decoded attributes have none.
 */
function reread(accessor: AccessorLike): ArrayLike<number> | null {
  const view = accessor.bufferView;
  const arrayBuffer = view?.buffer?.arrayBuffer;
  const Type = COMPONENT_ARRAYS[accessor.componentType ?? -1];
  const count = accessor.count;
  if (!view || !arrayBuffer || !Type || typeof count !== 'number' || !Number.isInteger(count) || count < 1) {
    return null;
  }
  const elementBytes = Type.BYTES_PER_ELEMENT * (accessor.components ?? 3);
  const start = (view.buffer?.byteOffset ?? 0) + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const stride = view.byteStride || elementBytes;
  if (start + stride * (count - 1) + elementBytes > arrayBuffer.byteLength) {
    return null;
  }
  const source = new Uint8Array(arrayBuffer);
  const bytes = new Uint8Array(count * elementBytes);
  if (stride === elementBytes) {
    bytes.set(source.subarray(start, start + count * elementBytes));
  } else {
    for (let i = 0; i < count; i++) {
      bytes.set(source.subarray(start + i * stride, start + i * stride + elementBytes), i * elementBytes);
    }
  }
  return new Type(bytes.buffer);
}

/** Whether two arrays hold the same values, of the same kind. */
function sameValues(a: ArrayLike<number>, b: ArrayLike<number> | null): boolean {
  if (!b || a.length !== b.length || a.constructor !== b.constructor) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i] && !(Number.isNaN(a[i]) && Number.isNaN(b[i]))) {
      return false;
    }
  }
  return true;
}

/** The fields of a positions accessor this module rewrites, and so puts back. */
const REWRITTEN = ['componentType', 'normalized', 'min', 'max', 'bytesPerComponent', 'bytesPerElement'];

/**
 * What each flattened content's accessors held before, to put back exactly:
 * the fields, and the values themselves only when they cannot be read again
 * from the buffer view ({@link reread}) — sparse accessors, Draco's — so that
 * a flattened tile does not carry its positions twice.
 */
interface Original {
  accessor: AccessorLike;
  fields: Record<string, unknown>;
  value: ArrayLike<number> | null;
}
const originals = new WeakMap<object, Original[]>();

/**
 * Gives a node that draws positions another node already draws, with another
 * matrix, a mesh of its own — the same primitives with their own positions
 * accessors — so that each can be moved by what its own matrix asks. luma.gl
 * finds a node's mesh by id among `gltf.meshes`, so the new ones are returned
 * to be listed there.
 */
function splitShared(parts: Part[]): MeshLike[] {
  const added = new Map<NodeLike, { own: MeshLike; mesh: MeshLike }>();
  for (const { node, shared } of parts) {
    if (!shared || added.has(node) || !node.mesh) {
      continue;
    }
    const own = node.mesh;
    const mesh: MeshLike = {
      ...own,
      id: `${own.id ?? 'mesh'}-own-positions-${added.size + 1}`,
      primitives: (own.primitives ?? []).map((primitive) => ({
        ...primitive,
        attributes: {
          ...primitive.attributes,
          ...(primitive.attributes?.POSITION ? { POSITION: { ...primitive.attributes.POSITION } } : {}),
        },
      })),
    };
    added.set(node, { own, mesh });
    node.mesh = mesh;
  }
  // Every part the node draws now comes from its own mesh, shared or not.
  for (const part of parts) {
    const split = added.get(part.node);
    const at = split ? (split.own.primitives ?? []).indexOf(part.primitive) : -1;
    if (split && at >= 0) {
      part.primitive = split.mesh.primitives![at];
      part.positions = part.primitive.attributes!.POSITION!;
    }
  }
  return [...added.values()].map(({ mesh }) => mesh);
}

/**
 * Moves every building of a content down, on its own, until its lowest vertex
 * is drawn at `base` metres — where the tileset's own move has put the map,
 * {@link liftOf}. Returns whether anything moved; a content is moved once, and
 * put back by {@link restoreBuildings}.
 *
 * For a content of a tileset already told apart as buildings
 * ({@link hasBuildings}): one with a single feature, or with no feature ids at
 * all — taken as one — is put on the map like the rest.
 *
 * A vertex is drawn at `(drawing matrix × node matrix × position).z` plus the
 * origin's height; its building's lowest such height is `h`. It is moved by
 * `(h − base) · L⁻¹·ẑ`, `L` being the linear part of that product: straight
 * down, as drawn, and by exactly that much. The east and north of every
 * vertex stay where they were. A building whose footprint reaches further
 * than {@link MAX_FOOTPRINT_REACH} from the origin is not moved.
 *
 * The positions moved become new float arrays — quantized ones brought back
 * to floats (KHR_mesh_quantization), their accessor saying so — and the
 * content a new glTF object: deck builds a tile's scenegraph only when handed
 * a new one.
 */
export function flattenBuildings(content: BuildingsContentLike | null | undefined, base = 0): boolean {
  const drawing = content?.cartographicModelMatrix;
  const originHeight = content?.cartographicOrigin?.[2];
  if (
    !content?.gltf ||
    content.instances ||
    originals.has(content) ||
    !drawing ||
    drawing.length < 16 ||
    typeof originHeight !== 'number' ||
    !Number.isFinite(originHeight) ||
    !drawsCartographic(content)
  ) {
    return false;
  }
  const parts = partsOf(content.gltf);
  let features = 1;
  for (const { ids } of parts) {
    for (let i = 0; ids && i < ids.length; i++) {
      const id = ids[i];
      if (!(id >= 0 && id < MAX_FEATURES) || (id | 0) !== id) {
        return false;
      }
      if (id >= features) {
        features = id + 1;
      }
    }
  }
  if (parts.length === 0) {
    return false;
  }
  // A node drawing positions another node draws too is a second copy of its
  // buildings, measured apart: its features get slots of their own.
  const blocks = new Map<NodeLike, number>();
  for (const { node, shared } of parts) {
    if (shared && !blocks.has(node)) {
      blocks.set(node, (blocks.size + 1) * features);
    }
  }
  const offsets = parts.map(({ node }) => blocks.get(node) ?? 0);
  const slots = features * (blocks.size + 1);
  if (slots > MAX_FEATURES) {
    return false;
  }

  // Each feature's lowest drawn height, and how far its footprint reaches from the origin, squared.
  const lowest = new Float64Array(slots).fill(Infinity);
  const reach = new Float64Array(slots);
  const floats = parts.map((part) => floatsOf(part.positions));
  const matrices = parts.map((part) => multiply(drawing, part.world));
  parts.forEach(({ ids }, k) => {
    const [m0, m1, m2, , m4, m5, m6, , m8, m9, m10, , m12, m13, m14] = matrices[k];
    const zOffset = m14 + originHeight;
    const f = floats[k];
    const offset = offsets[k];
    for (let i = 0, j = 0; j < f.length; i++, j += 3) {
      const x = f[j];
      const y = f[j + 1];
      const z = f[j + 2];
      const id = offset + (ids === null ? 0 : ids[i] | 0);
      const height = m2 * x + m6 * y + m10 * z + zOffset;
      if (height < lowest[id]) {
        lowest[id] = height;
      }
      const east = m0 * x + m4 * y + m8 * z + m12;
      const north = m1 * x + m5 * y + m9 * z + m13;
      const far = east * east + north * north;
      if (far > reach[id]) {
        reach[id] = far;
      }
    }
  });
  const drops = new Float64Array(slots);
  let any = false;
  for (let id = 0; id < slots; id++) {
    if (Number.isFinite(lowest[id]) && reach[id] <= MAX_FOOTPRINT_REACH ** 2 && lowest[id] !== base) {
      drops[id] = lowest[id] - base;
      any = true;
    }
  }
  if (!any) {
    return false;
  }

  const added = splitShared(parts);
  const saved: Original[] = [];
  parts.forEach(({ positions, ids }, k) => {
    // L⁻¹·ẑ: the third column of the inverse, from the cross products of L's columns.
    const m = matrices[k];
    const determinant =
      m[0] * (m[5] * m[10] - m[6] * m[9]) - m[1] * (m[4] * m[10] - m[6] * m[8]) + m[2] * (m[4] * m[9] - m[5] * m[8]);
    if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) {
      return;
    }
    const dx = (m[4] * m[9] - m[5] * m[8]) / determinant;
    const dy = (m[8] * m[1] - m[9] * m[0]) / determinant;
    const dz = (m[0] * m[5] - m[1] * m[4]) / determinant;

    const f = floats[k];
    const offset = offsets[k];
    let moved = false;
    let [minX, minY, minZ, maxX, maxY, maxZ] = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (let i = 0, j = 0; j < f.length; i++, j += 3) {
      const drop = drops[offset + (ids === null ? 0 : ids[i] | 0)];
      if (drop !== 0) {
        f[j] -= drop * dx;
        f[j + 1] -= drop * dy;
        f[j + 2] -= drop * dz;
        moved = true;
      }
      const x = f[j];
      const y = f[j + 1];
      const z = f[j + 2];
      minX = x < minX ? x : minX;
      minY = y < minY ? y : minY;
      minZ = z < minZ ? z : minZ;
      maxX = x > maxX ? x : maxX;
      maxY = y > maxY ? y : maxY;
      maxZ = z > maxZ ? z : maxZ;
    }
    if (!moved) {
      return;
    }

    const fields: Record<string, unknown> = {};
    for (const key of REWRITTEN) {
      if (key in positions) {
        fields[key] = positions[key];
      }
    }
    const value = positions.value!;
    saved.push({ accessor: positions, fields, value: sameValues(value, reread(positions)) ? null : value });
    Object.assign(positions, {
      value: f,
      componentType: FLOAT,
      normalized: false,
      min: [minX, minY, minZ],
      max: [maxX, maxY, maxZ],
      bytesPerComponent: 4,
      bytesPerElement: 12,
    });
  });
  // Meshes split off are listed whatever came of the move: a node now names one, and luma.gl looks it up there.
  if (added.length > 0) {
    content.gltf = { ...content.gltf, meshes: [...(content.gltf.meshes ?? []), ...added] };
  }
  if (saved.length === 0) {
    return false;
  }
  originals.set(content, saved);
  if (added.length === 0) {
    content.gltf = { ...content.gltf };
  }
  return true;
}

/** Puts a content flattened by {@link flattenBuildings} back as it loaded. Returns whether there was anything to put back. */
export function restoreBuildings(content: BuildingsContentLike | null | undefined): boolean {
  const saved = content ? originals.get(content) : undefined;
  if (!content || !saved) {
    return false;
  }
  for (const { accessor, fields, value } of saved) {
    for (const key of REWRITTEN) {
      if (key in fields) {
        accessor[key] = fields[key];
      } else {
        delete accessor[key];
      }
    }
    accessor.value = value ?? reread(accessor);
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
 * its corners, the lowest taken further down by how far a flat face's middle
 * can stand below its corners, the ground curving away from under them. Null
 * for a box not on the globe — Google's root, centred on the centre of the
 * Earth, holds everything anyway — or too wide to read so; and for one that
 * crosses the antimeridian, whose longitudes do not make one region: such a
 * box is left where it is, culled at its real altitude.
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
  return [low[0], low[1], high[0], high[1], low[2] - across / (2 * EARTH_RADIUS), high[2]];
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

/**
 * Each volume's box as it loaded and flattened, and how far the flattened
 * box's centre lies below the real one's; each tile, the box its culling
 * volume was last built from.
 */
const volumeBoxes = new WeakMap<object, { real: ArrayLike<number> | undefined; flat: number[]; drop: number }>();
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
 *
 * A `viewerRequestVolume`, which a few tilesets set to load a tile only with
 * the camera inside it, is left at its real altitude: rare, and OSM Buildings
 * sets none.
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
      const real = volume.box ?? (volume.region ? regionBox(volume.region) : null);
      const drop = real ? cartographicOf(real)[2] - cartographicOf(box)[2] : 0;
      boxes = { real: volume.box, flat: box, drop: Number.isFinite(drop) ? drop : 0 };
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

/**
 * How far below its real place a tile's volume now lies, flattened, in metres
 * — so how far below it loaders.gl has put the origin of a tile that loads now:
 * it takes the centre of the tile's volume. 0 for a volume as it loaded.
 */
export function flattenedDrop(tile: VolumeTileLike | null | undefined): number {
  const volume = tile?.header?.boundingVolume;
  const boxes = volume && typeof volume === 'object' ? volumeBoxes.get(volume) : undefined;
  return boxes && volume!.box === boxes.flat ? boxes.drop : 0;
}
