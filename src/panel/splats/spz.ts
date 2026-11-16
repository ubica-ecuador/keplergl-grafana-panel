/**
 * SPZ, Niantic's compressed Gaussian splats, decoded.
 *
 * SPZ is the payload of glTF's `KHR_gaussian_splatting_compression_spz_2`, the
 * way splats travel in 3D Tiles today (Esri's splat layers, Cesium's tilers):
 * a gzip stream holding a 16-byte header and then, splat after splat, the
 * positions (24-bit fixed point), the opacities, the colours (the zeroth
 * spherical harmonic), the scales (log, 8 bits), the rotations and the higher
 * spherical harmonics. The layout follows Niantic's reference decoder
 * (github.com/nianticlabs/spz, MIT): version 2 stores a rotation's x, y and z
 * in a byte each, version 3 the three smallest components in 10 bits each.
 * Version 4 (zstd streams) is not read: no tileset served it when this was
 * written, and the extension names version 2.
 *
 * The values are taken as the glTF primitive's own: the positions of Esri's
 * tiles match the bounds their accessors state, so no axis is turned here.
 * The spherical harmonics past degree 0, the colour that changes with the
 * angle of view, are kept as SPZ stores them (`SplatSh`).
 */

/** Splats as the layer draws them. */
export interface Splats {
  count: number;
  /** x, y, z per splat, in the primitive's own space. */
  positions: Float32Array;
  /** The spread along each of the splat's own axes, linear. */
  scales: Float32Array;
  /** The splat's orientation, a unit quaternion x, y, z, w. */
  rotations: Float32Array;
  /** Red, green, blue (the diffuse colour) and opacity, 0 to 255. */
  colors: Uint8Array;
  /**
   * The spherical harmonics past degree 0, the colour that changes with the
   * angle of view; absent, each splat has one colour from every side.
   */
  sh?: SplatSh | null;
  /**
   * Trained with a screen-space filter (SPZ's antialiased flag, Mip-Splatting):
   * the drawing scales each opacity by what the 2D blur it adds takes away.
   */
  antialiased: boolean;
}

/**
 * A set of splats' spherical harmonics past degree 0, as SPZ stores them: for
 * each splat, for each coefficient (degree 1's three, then degree 2's five,
 * then degree 3's seven, each in the basis order of 3D Gaussian Splatting),
 * red, green and blue, each a byte b standing for (b − 128) / 128.
 */
export interface SplatSh {
  degree: 1 | 2 | 3;
  coefficients: Uint8Array;
}

const MAGIC = 0x5053474e; // 'NGSP'
const HEADER_BYTES = 16;
const FLAG_ANTIALIASED = 0x1;
/** SPZ stores a colour coefficient as 0.5 + c × COLOR_SCALE, in a byte. */
const COLOR_SCALE = 0.15;
/** The zeroth real spherical harmonic, Y₀₀ = 1 / (2√π). */
const SH_C0 = 0.28209479177387814;
const SQRT1_2 = Math.SQRT1_2;

/** Spherical harmonic coefficients per colour channel past degree 0. */
export function shDim(degree: number): number {
  return (degree + 1) * (degree + 1) - 1;
}

/** Whether the bytes start a gzip stream. */
export function isGzip(bytes: Uint8Array): boolean {
  return bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

/** A gzip stream, inflated by the browser's own `DecompressionStream`. */
export async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const inflate = new DecompressionStream('gzip');
  const writer = inflate.writable.getWriter();
  // Not awaited: the readable side has to be drained for the writes to finish.
  // A broken stream fails both sides; the reader's failure is the one thrown.
  writer
    .write(bytes as unknown as BufferSource)
    .then(() => writer.close())
    .catch(() => {});
  const reader = inflate.readable.getReader();
  const parts: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    parts.push(value);
    length += value.length;
  }
  const out = new Uint8Array(length);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** A quaternion stored as the three smallest of its components (SPZ 3), into `out` at `at`. */
function smallestThree(bytes: Uint8Array, offset: number, out: Float32Array, at: number): void {
  let comp = (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
  const mask = (1 << 9) - 1;
  const largest = comp >>> 30;
  let squares = 0;
  for (let i = 3; i >= 0; i--) {
    if (i !== largest) {
      const magnitude = comp & mask;
      const negative = (comp >>> 9) & 1;
      comp >>>= 10;
      const value = (SQRT1_2 * magnitude) / mask;
      out[at + i] = negative ? -value : value;
      squares += value * value;
    }
  }
  out[at + largest] = Math.sqrt(Math.max(0, 1 - squares));
}

/** A quaternion stored as its x, y and z with w ≥ 0 (SPZ 2), into `out` at `at`. */
function firstThree(bytes: Uint8Array, offset: number, out: Float32Array, at: number): void {
  const x = bytes[offset] / 127.5 - 1;
  const y = bytes[offset + 1] / 127.5 - 1;
  const z = bytes[offset + 2] / 127.5 - 1;
  out[at] = x;
  out[at + 1] = y;
  out[at + 2] = z;
  out[at + 3] = Math.sqrt(Math.max(0, 1 - x * x - y * y - z * z));
}

/** A spherical harmonic coefficient as SPZ stores it in a byte: (b − 128) / 128, clamped to ±1. */
export function shByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value * 128 + 128)));
}

function clampByte(value: number): number {
  return value <= 0 ? 0 : value >= 255 ? 255 : Math.round(value);
}

/** Each splat's harmonics up to degree 3, from the SPZ's own (degree 4's coefficients, if any, left out). */
function shOf(raw: Uint8Array, offset: number, count: number, degree: number): Uint8Array {
  const stored = shDim(degree) * 3;
  const kept = shDim(Math.min(degree, 3)) * 3;
  if (stored === kept) {
    return raw.slice(offset, offset + count * stored);
  }
  const out = new Uint8Array(count * kept);
  for (let i = 0; i < count; i++) {
    out.set(raw.subarray(offset + i * stored, offset + i * stored + kept), i * kept);
  }
  return out;
}

/** An inflated SPZ stream, read into splats. Throws on anything it cannot read. */
export function parseSpz(raw: Uint8Array): Splats {
  if (raw.length < HEADER_BYTES) {
    throw new Error('SPZ: shorter than its header');
  }
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const magic = view.getUint32(0, true);
  const version = view.getUint32(4, true);
  const count = view.getUint32(8, true);
  const shDegree = view.getUint8(12);
  const fractionalBits = view.getUint8(13);
  const flags = view.getUint8(14);
  if (magic !== MAGIC) {
    throw new Error('SPZ: not an SPZ stream');
  }
  if (version !== 2 && version !== 3) {
    throw new Error(`SPZ: version ${version} is not read (only 2 and 3)`);
  }
  if (shDegree > 4) {
    throw new Error(`SPZ: spherical harmonics of degree ${shDegree}`);
  }
  const rotationBytes = version >= 3 ? 4 : 3;
  const shBytes = shDim(shDegree) * 3;
  const expected = HEADER_BYTES + count * (9 + 1 + 3 + 3 + rotationBytes + shBytes);
  if (raw.length < expected) {
    throw new Error(`SPZ: ${raw.length} bytes for ${count} splats, ${expected} expected`);
  }

  const positions = new Float32Array(count * 3);
  const scales = new Float32Array(count * 3);
  const rotations = new Float32Array(count * 4);
  const colors = new Uint8Array(count * 4);

  const fixed = 1 / (1 << fractionalBits);
  let offset = HEADER_BYTES;
  for (let i = 0; i < count * 3; i++, offset += 3) {
    let value = raw[offset] | (raw[offset + 1] << 8) | (raw[offset + 2] << 16);
    if (value & 0x800000) {
      value -= 0x1000000;
    }
    positions[i] = value * fixed;
  }
  // Opacities, already through the sigmoid: a byte is the opacity × 255.
  for (let i = 0; i < count; i++, offset++) {
    colors[i * 4 + 3] = raw[offset];
  }
  // Colours, as the zeroth harmonic's coefficient; the diffuse colour is 0.5 + Y₀₀ × it.
  for (let i = 0; i < count * 3; i++, offset++) {
    const coefficient = (raw[offset] / 255 - 0.5) / COLOR_SCALE;
    colors[Math.floor(i / 3) * 4 + (i % 3)] = clampByte((0.5 + SH_C0 * coefficient) * 255);
  }
  for (let i = 0; i < count * 3; i++, offset++) {
    scales[i] = Math.exp(raw[offset] / 16 - 10);
  }
  const unpack = version >= 3 ? smallestThree : firstThree;
  for (let i = 0; i < count; i++, offset += rotationBytes) {
    unpack(raw, offset, rotations, i * 4);
  }
  // The higher harmonics, already in the layout the layer reads: copied as they are.
  const sh: SplatSh | null =
    shDegree > 0
      ? { degree: Math.min(shDegree, 3) as 1 | 2 | 3, coefficients: shOf(raw, offset, count, shDegree) }
      : null;

  return { count, positions, scales, rotations, colors, sh, antialiased: (flags & FLAG_ANTIALIASED) !== 0 };
}

/** SPZ bytes, gzipped (as the glTF extension carries them) or already inflated, read into splats. */
export async function decodeSpz(bytes: Uint8Array): Promise<Splats> {
  return parseSpz(isGzip(bytes) ? await gunzip(bytes) : bytes);
}
