/**
 * SPZ streams written for the tests, as Niantic's encoder packs them
 * (github.com/nianticlabs/spz, `packGaussians`): what the decoder reads back
 * must be what went in, to SPZ's own precision.
 */

export interface PlainSplat {
  position: [number, number, number];
  /** Linear. */
  scale: [number, number, number];
  /** x, y, z, w. */
  rotation: [number, number, number, number];
  /** 0 to 1. */
  color: [number, number, number];
  opacity: number;
  /** Optional harmonics past degree 0: for each coefficient, red, green, blue, each in ±1. */
  sh?: number[];
}

const COLOR_SCALE = 0.15;
const SH_C0 = 0.28209479177387814;

function toByte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function normalized(q: [number, number, number, number]): [number, number, number, number] {
  const n = Math.hypot(...q);
  return q.map((v) => v / n) as [number, number, number, number];
}

function smallestThree(q: [number, number, number, number]): number[] {
  const r = normalized(q);
  let largest = 0;
  for (let i = 1; i < 4; i++) {
    if (Math.abs(r[i]) > Math.abs(r[largest])) {
      largest = i;
    }
  }
  const negate = r[largest] < 0 ? 1 : 0;
  let comp = largest;
  for (let i = 0; i < 4; i++) {
    if (i !== largest) {
      const negbit = (r[i] < 0 ? 1 : 0) ^ negate;
      const mag = Math.floor(511 * (Math.abs(r[i]) / Math.SQRT1_2) + 0.5);
      comp = ((comp << 10) | (negbit << 9) | mag) >>> 0;
    }
  }
  return [comp & 0xff, (comp >>> 8) & 0xff, (comp >>> 16) & 0xff, (comp >>> 24) & 0xff];
}

function firstThree(q: [number, number, number, number]): number[] {
  const r = normalized(q);
  const sign = r[3] < 0 ? -127.5 : 127.5;
  return [0, 1, 2].map((i) => toByte(r[i] * sign + 127.5));
}

/** An inflated SPZ stream of these splats, version 2 or 3, with harmonics of `shDegree` (0: none past degree 0). */
export function packSpz(
  splats: PlainSplat[],
  { version = 3, flags = 0, fractionalBits = 12, shDegree = 0 } = {}
): Uint8Array {
  const n = splats.length;
  const rotationBytes = version >= 3 ? 4 : 3;
  const shBytes = ((shDegree + 1) * (shDegree + 1) - 1) * 3;
  const bytes = new Uint8Array(16 + n * (9 + 1 + 3 + 3 + rotationBytes + shBytes));
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x5053474e, true);
  view.setUint32(4, version, true);
  view.setUint32(8, n, true);
  view.setUint8(12, shDegree);
  view.setUint8(13, fractionalBits);
  view.setUint8(14, flags);
  let at = 16;
  for (const s of splats) {
    for (const v of s.position) {
      const fixed = Math.round(v * (1 << fractionalBits)) & 0xffffff;
      bytes[at++] = fixed & 0xff;
      bytes[at++] = (fixed >> 8) & 0xff;
      bytes[at++] = (fixed >> 16) & 0xff;
    }
  }
  for (const s of splats) {
    bytes[at++] = toByte(s.opacity * 255);
  }
  for (const s of splats) {
    for (const c of s.color) {
      const coefficient = (c - 0.5) / SH_C0;
      bytes[at++] = toByte(coefficient * (COLOR_SCALE * 255) + 0.5 * 255);
    }
  }
  for (const s of splats) {
    for (const v of s.scale) {
      bytes[at++] = toByte((Math.log(v) + 10) * 16);
    }
  }
  for (const s of splats) {
    for (const b of version >= 3 ? smallestThree(s.rotation) : firstThree(s.rotation)) {
      bytes[at++] = b;
    }
  }
  for (const s of splats) {
    for (let k = 0; k < shBytes; k++) {
      bytes[at++] = toByte((s.sh?.[k] ?? 0) * 128 + 128);
    }
  }
  return bytes;
}

/**
 * A zstd frame holding these bytes as they are (raw blocks of at most 128 KB),
 * which any zstd decoder reads: enough to test SPZ 4 without a compressor.
 */
export function zstdRaw(bytes: Uint8Array): Uint8Array {
  const blocks = Math.max(1, Math.ceil(bytes.length / 131072));
  const out = new Uint8Array(4 + 1 + 8 + blocks * 3 + bytes.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0xfd2fb528, true);
  // Single segment, an 8-byte content size, no checksum, no dictionary.
  out[4] = 0b11100000;
  view.setBigUint64(5, BigInt(bytes.length), true);
  let at = 13;
  for (let b = 0; b < blocks; b++) {
    const part = bytes.subarray(b * 131072, (b + 1) * 131072);
    // Block header: last block bit, type 0 (raw), its size.
    const header = (part.length << 3) | (b === blocks - 1 ? 1 : 0);
    out[at] = header & 0xff;
    out[at + 1] = (header >>> 8) & 0xff;
    out[at + 2] = (header >>> 16) & 0xff;
    out.set(part, at + 3);
    at += 3 + part.length;
  }
  return out;
}

/**
 * An SPZ of version 4 of these splats, as Niantic's library writes it: a
 * 32-byte header in the clear, the table of contents, each attribute in a zstd
 * stream of its own (raw blocks here, see `zstdRaw`).
 */
export function packSpzV4(
  splats: PlainSplat[],
  options: { flags?: number; fractionalBits?: number; shDegree?: number } = {}
): Uint8Array {
  const v3 = packSpz(splats, { ...options, version: 3 });
  const count = splats.length;
  const shDegree = options.shDegree ?? 0;
  const sizes = [count * 9, count, count * 3, count * 3, count * 4];
  if (shDegree > 0) {
    sizes.push(count * ((shDegree + 1) * (shDegree + 1) - 1) * 3);
  }
  const streams: Uint8Array[] = [];
  let from = 16;
  for (const size of sizes) {
    streams.push(zstdRaw(v3.subarray(from, from + size)));
    from += size;
  }
  const toc = 32;
  const out = new Uint8Array(toc + sizes.length * 16 + streams.reduce((sum, s) => sum + s.length, 0));
  const view = new DataView(out.buffer);
  out.set(v3.subarray(0, 16));
  view.setUint32(4, 4, true);
  out[15] = sizes.length;
  view.setUint32(16, toc, true);
  let at = toc + sizes.length * 16;
  streams.forEach((stream, i) => {
    view.setBigUint64(toc + i * 16, BigInt(stream.length), true);
    view.setBigUint64(toc + i * 16 + 8, BigInt(sizes[i]), true);
    out.set(stream, at);
    at += stream.length;
  });
  return out;
}

/** A binary glTF with one primitive of splats, its SPZ in the binary chunk, under one node with `matrix`. */
export function splatGlb(spz: Uint8Array, count: number, matrix?: number[]): ArrayBuffer {
  const json = {
    asset: { version: '2.0' },
    extensionsUsed: ['KHR_gaussian_splatting', 'KHR_gaussian_splatting_compression_spz_2'],
    extensionsRequired: ['KHR_gaussian_splatting', 'KHR_gaussian_splatting_compression_spz_2'],
    buffers: [{ byteLength: spz.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: spz.length }],
    accessors: [{ type: 'VEC3', componentType: 5126, count }],
    meshes: [
      {
        primitives: [
          {
            mode: 0,
            attributes: { POSITION: 0 },
            extensions: {
              KHR_gaussian_splatting: {
                kernel: 'ellipse',
                extensions: { KHR_gaussian_splatting_compression_spz_2: { bufferView: 0 } },
              },
            },
          },
        ],
      },
    ],
    nodes: [{ mesh: 0, ...(matrix ? { matrix } : {}) }],
    scenes: [{ nodes: [0] }],
    scene: 0,
  };
  const text = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = Math.ceil(text.length / 4) * 4;
  const binLength = Math.ceil(spz.length / 4) * 4;
  const total = 12 + 8 + jsonLength + 8 + binLength;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  out.fill(0x20, 20, 20 + jsonLength);
  out.set(text, 20);
  view.setUint32(20 + jsonLength, binLength, true);
  view.setUint32(24 + jsonLength, 0x004e4942, true);
  out.set(spz, 28 + jsonLength);
  return out.buffer;
}
