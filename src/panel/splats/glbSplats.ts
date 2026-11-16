/**
 * The Gaussian splats in a binary glTF, as the glTF extension
 * `KHR_gaussian_splatting` puts them there: a primitive of points whose
 * attributes are each splat's place, spread, orientation, colour and opacity,
 * compressed as SPZ (`KHR_gaussian_splatting_compression_spz_2`) or as plain
 * accessors.
 *
 * loaders.gl 4 knows neither extension, and a tile that requires them (every
 * splat tile served so far: Esri's, Cesium's) never draws. So a 3D tile is
 * looked at before loaders.gl parses it (`isSplatGlb`), and one of splats is
 * read here instead (`splatsFromGlb`).
 *
 * The attributes are read under both names the extension has had: the
 * ratified one (`KHR_gaussian_splatting:OPACITY` and `:SH_DEGREE_0_COEF_0`)
 * and the release candidate's, `COLOR_0` with the opacity in its alpha, which
 * the tilesets in the wild still write.
 */

import { decodeSpz, shByte, type Splats, type SplatSh } from './spz';

/** The extension a primitive of splats declares. */
export const SPLAT_EXTENSION = 'KHR_gaussian_splatting';
/** Its SPZ compression. */
export const SPZ_EXTENSION = 'KHR_gaussian_splatting_compression_spz_2';

/** The splats of one primitive and the global transform of the node that draws them, column-major. */
export interface SplatChunk {
  splats: Splats;
  matrix: number[];
}

const GLB_MAGIC = 0x46546c67; // 'glTF'
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;
const SH_C0 = 0.28209479177387814;

interface Glb {
  json: Record<string, any>;
  bin: Uint8Array | null;
}

/** The JSON and binary chunks of a binary glTF, or null if it is not one. */
export function readGlb(buffer: ArrayBuffer | ArrayBufferView): Glb | null {
  const bytes =
    buffer instanceof ArrayBuffer
      ? new Uint8Array(buffer)
      : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  if (bytes.byteLength < 20) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== GLB_MAGIC || view.getUint32(4, true) !== 2) {
    return null;
  }
  const length = Math.min(view.getUint32(8, true), bytes.byteLength);
  let json: Record<string, any> | null = null;
  let bin: Uint8Array | null = null;
  for (let offset = 12; offset + 8 <= length;) {
    const chunkLength = view.getUint32(offset, true);
    const chunkType = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (start + chunkLength > length) {
      break;
    }
    if (chunkType === CHUNK_JSON && !json) {
      json = JSON.parse(new TextDecoder().decode(bytes.subarray(start, start + chunkLength)));
    } else if (chunkType === CHUNK_BIN && !bin) {
      bin = bytes.subarray(start, start + chunkLength);
    }
    offset = start + chunkLength;
  }
  return json ? { json, bin } : null;
}

/** Whether a binary glTF holds splats: it names the extension. Reads only its JSON. */
export function isSplatGlb(buffer: ArrayBuffer | ArrayBufferView): boolean {
  try {
    const glb = readGlb(buffer);
    const used = glb?.json?.extensionsUsed;
    return Array.isArray(used) && used.includes(SPLAT_EXTENSION);
  } catch {
    return false;
  }
}

// --- node transforms -------------------------------------------------------

type Mat4 = number[];

const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** a × b, both column-major. */
export function multiply(a: Mat4, b: Mat4): Mat4 {
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

/** A node's own transform: its matrix, or its translation, rotation and scale. */
function localMatrix(node: Record<string, any>): Mat4 {
  if (Array.isArray(node.matrix) && node.matrix.length === 16) {
    return node.matrix.map(Number);
  }
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  return [
    (1 - 2 * (y * y + z * z)) * sx,
    2 * (x * y + w * z) * sx,
    2 * (x * z - w * y) * sx,
    0,
    2 * (x * y - w * z) * sy,
    (1 - 2 * (x * x + z * z)) * sy,
    2 * (y * z + w * x) * sy,
    0,
    2 * (x * z + w * y) * sz,
    2 * (y * z - w * x) * sz,
    (1 - 2 * (x * x + y * y)) * sz,
    0,
    tx,
    ty,
    tz,
    1,
  ];
}

/** Every node of the scene shown that draws a mesh, with its global transform. */
function meshNodes(json: Record<string, any>): Array<{ mesh: number; matrix: Mat4 }> {
  const nodes: Array<Record<string, any>> = Array.isArray(json.nodes) ? json.nodes : [];
  const scenes: Array<Record<string, any>> = Array.isArray(json.scenes) ? json.scenes : [];
  const scene = scenes[typeof json.scene === 'number' ? json.scene : 0];
  const roots: number[] = scene?.nodes ?? nodes.map((_, i) => i);
  const found: Array<{ mesh: number; matrix: Mat4 }> = [];
  const visit = (index: number, parent: Mat4, depth: number) => {
    const node = nodes[index];
    if (!node || depth > 64) {
      return;
    }
    const matrix = multiply(parent, localMatrix(node));
    if (typeof node.mesh === 'number') {
      found.push({ mesh: node.mesh, matrix });
    }
    for (const child of node.children ?? []) {
      visit(child, matrix, depth + 1);
    }
  };
  for (const root of roots) {
    visit(root, IDENTITY, 0);
  }
  return found;
}

// --- plain accessors -------------------------------------------------------

const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

/** An accessor's values as floats, normalized integers brought to [0, 1] or [−1, 1]. */
function readAccessor(
  json: Record<string, any>,
  bin: Uint8Array | null,
  index: number | undefined
): { values: Float32Array; size: number } | null {
  if (typeof index !== 'number') {
    return null;
  }
  const accessor = json.accessors?.[index];
  const size = COMPONENTS[accessor?.type];
  if (!accessor || !size || typeof accessor.bufferView !== 'number' || !bin) {
    return null;
  }
  const bufferView = json.bufferViews?.[accessor.bufferView];
  if (!bufferView) {
    return null;
  }
  const count: number = accessor.count;
  const type: number = accessor.componentType;
  const bytesPer = type === 5126 || type === 5125 ? 4 : type === 5122 || type === 5123 ? 2 : 1;
  const stride = bufferView.byteStride || size * bytesPer;
  const base = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const values = new Float32Array(count * size);
  const normalized = Boolean(accessor.normalized);
  for (let i = 0; i < count; i++) {
    for (let k = 0; k < size; k++) {
      const at = base + i * stride + k * bytesPer;
      let v: number;
      switch (type) {
        case 5126:
          v = view.getFloat32(at, true);
          break;
        case 5120:
          v = view.getInt8(at);
          v = normalized ? Math.max(v / 127, -1) : v;
          break;
        case 5121:
          v = view.getUint8(at);
          v = normalized ? v / 255 : v;
          break;
        case 5122:
          v = view.getInt16(at, true);
          v = normalized ? Math.max(v / 32767, -1) : v;
          break;
        case 5123:
          v = view.getUint16(at, true);
          v = normalized ? v / 65535 : v;
          break;
        default:
          v = view.getUint32(at, true);
      }
      values[i * size + k] = v;
    }
  }
  return { values, size };
}

/** A primitive's splats from its plain accessors, or null if it lacks one the layer needs. */
function plainSplats(
  json: Record<string, any>,
  bin: Uint8Array | null,
  attributes: Record<string, number>
): Splats | null {
  const position = readAccessor(json, bin, attributes.POSITION);
  const rotation = readAccessor(json, bin, attributes[`${SPLAT_EXTENSION}:ROTATION`]);
  const scale = readAccessor(json, bin, attributes[`${SPLAT_EXTENSION}:SCALE`]);
  if (!position || position.size !== 3 || !rotation || rotation.size !== 4 || !scale || scale.size !== 3) {
    return null;
  }
  const count = position.values.length / 3;
  const colors = new Uint8Array(count * 4);
  const sh0 = readAccessor(json, bin, attributes[`${SPLAT_EXTENSION}:SH_DEGREE_0_COEF_0`]);
  const opacity = readAccessor(json, bin, attributes[`${SPLAT_EXTENSION}:OPACITY`]);
  const color = readAccessor(json, bin, attributes.COLOR_0);
  for (let i = 0; i < count; i++) {
    for (let k = 0; k < 3; k++) {
      const v = sh0 ? 0.5 + SH_C0 * sh0.values[i * 3 + k] : color ? color.values[i * color.size + k] : 1;
      colors[i * 4 + k] = Math.max(0, Math.min(255, Math.round(v * 255)));
    }
    const a = opacity ? opacity.values[i] : color && color.size === 4 ? color.values[i * 4 + 3] : 1;
    colors[i * 4 + 3] = Math.max(0, Math.min(255, Math.round(a * 255)));
  }
  return {
    count,
    positions: position.values,
    scales: scale.values,
    rotations: rotation.values,
    colors,
    sh: plainSh(json, bin, attributes, count),
    antialiased: false,
  };
}

/**
 * A primitive's harmonics past degree 0, from the extension's attributes
 * (`KHR_gaussian_splatting:SH_DEGREE_l_COEF_n`, a vec3 each), up to the last
 * degree it has whole; null without degree 1.
 */
function plainSh(
  json: Record<string, any>,
  bin: Uint8Array | null,
  attributes: Record<string, number>,
  count: number
): SplatSh | null {
  const degrees: Float32Array[][] = [];
  for (let l = 1; l <= 3; l++) {
    const coefficients: Float32Array[] = [];
    for (let n = 0; n < 2 * l + 1; n++) {
      const read = readAccessor(json, bin, attributes[`${SPLAT_EXTENSION}:SH_DEGREE_${l}_COEF_${n}`]);
      if (!read || read.size !== 3 || read.values.length !== count * 3) {
        break;
      }
      coefficients.push(read.values);
    }
    if (coefficients.length !== 2 * l + 1) {
      break;
    }
    degrees.push(coefficients);
  }
  if (degrees.length === 0) {
    return null;
  }
  const all = degrees.flat();
  const perSplat = all.length * 3;
  const bytes = new Uint8Array(count * perSplat);
  for (let i = 0; i < count; i++) {
    all.forEach((values, j) => {
      for (let c = 0; c < 3; c++) {
        bytes[i * perSplat + j * 3 + c] = shByte(values[i * 3 + c]);
      }
    });
  }
  return { degree: degrees.length as 1 | 2 | 3, coefficients: bytes };
}

/**
 * Every primitive of splats in a binary glTF, decoded, with the global
 * transform of its node. Primitives of anything else are left out.
 */
export async function splatsFromGlb(buffer: ArrayBuffer | ArrayBufferView): Promise<SplatChunk[]> {
  const glb = readGlb(buffer);
  if (!glb) {
    throw new Error('Not a binary glTF');
  }
  const { json, bin } = glb;
  const chunks: SplatChunk[] = [];
  for (const { mesh, matrix } of meshNodes(json)) {
    for (const primitive of json.meshes?.[mesh]?.primitives ?? []) {
      const extension = primitive?.extensions?.[SPLAT_EXTENSION];
      if (!extension) {
        continue;
      }
      const spz = extension.extensions?.[SPZ_EXTENSION];
      let splats: Splats | null = null;
      if (spz && typeof spz.bufferView === 'number' && bin) {
        const view = json.bufferViews?.[spz.bufferView];
        const start = view?.byteOffset ?? 0;
        splats = await decodeSpz(bin.subarray(start, start + (view?.byteLength ?? 0)));
      } else {
        splats = plainSplats(json, bin, primitive.attributes ?? {});
      }
      if (splats && splats.count > 0) {
        chunks.push({ splats, matrix });
      }
    }
  }
  return chunks;
}
