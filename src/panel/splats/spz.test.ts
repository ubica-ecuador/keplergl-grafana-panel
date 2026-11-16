import { gzipSync } from 'zlib';

import { decodeSpz, isGzip, parseSpz } from './spz';
import { packSpz, packSpzV4, type PlainSplat } from './spzFixture';

import { TextDecoder as NodeTextDecoder, TextEncoder as NodeTextEncoder } from 'util';
import { DecompressionStream as NodeDecompressionStream } from 'stream/web';

// jsdom has neither; the browsers the panel runs in have both.
Object.assign(globalThis, {
  DecompressionStream: (globalThis as any).DecompressionStream ?? NodeDecompressionStream,
  TextDecoder: (globalThis as any).TextDecoder ?? NodeTextDecoder,
  TextEncoder: (globalThis as any).TextEncoder ?? NodeTextEncoder,
});

const SPLATS: PlainSplat[] = [
  { position: [1.5, -2.25, 30.125], scale: [0.02, 0.5, 3], rotation: [0, 0, 0, 1], color: [1, 0.5, 0], opacity: 0.9 },
  {
    position: [-115.38, 16.5, -23.77],
    scale: [1, 1, 1],
    rotation: [0.5, 0.5, 0.5, 0.5],
    color: [0.2, 0.4, 0.6],
    opacity: 0.05,
  },
  { position: [0, 0, 0], scale: [0.001, 0.001, 0.001], rotation: [-0.3, 0.1, 0.9, -0.2], color: [0, 0, 1], opacity: 1 },
];

function quaternionClose(actual: ArrayLike<number>, expected: number[], tolerance: number) {
  const n = Math.hypot(...expected);
  const q = expected.map((v) => v / n);
  // q and −q are the same rotation.
  const dot = Math.abs(q.reduce((sum, v, i) => sum + v * actual[i], 0));
  expect(dot).toBeGreaterThan(1 - tolerance);
}

describe('SPZ', () => {
  it.each([2, 3])('reads version %i back as it was packed', (version) => {
    const splats = parseSpz(packSpz(SPLATS, { version }));
    expect(splats.count).toBe(3);
    expect(splats.antialiased).toBe(false);
    SPLATS.forEach((s, i) => {
      for (let k = 0; k < 3; k++) {
        // 12 fractional bits: a quarter of a millimetre.
        expect(splats.positions[i * 3 + k]).toBeCloseTo(s.position[k], 3);
        // Log scale in sixteenths: within 3.2 %.
        expect(Math.abs(Math.log(splats.scales[i * 3 + k] / s.scale[k]))).toBeLessThan(1 / 32 + 1e-6);
        expect(Math.abs(splats.colors[i * 4 + k] - s.color[k] * 255)).toBeLessThanOrEqual(2);
      }
      expect(Math.abs(splats.colors[i * 4 + 3] - s.opacity * 255)).toBeLessThanOrEqual(1);
      quaternionClose(splats.rotations.subarray(i * 4, i * 4 + 4), s.rotation, version >= 3 ? 1e-4 : 1e-3);
    });
  });

  it('reads version 4: its header in the clear, each attribute in a zstd stream', async () => {
    const sh = Array.from({ length: 9 }, (_, k) => (k - 4) / 8);
    const withSh = SPLATS.map((s) => ({ ...s, sh }));
    const four = packSpzV4(withSh, { flags: 1, shDegree: 1 });
    expect(isGzip(four)).toBe(false);
    const read = await decodeSpz(four);
    const three = parseSpz(packSpz(withSh, { flags: 1, shDegree: 1 }));
    expect(read.count).toBe(3);
    expect(read.antialiased).toBe(true);
    expect(Array.from(read.positions)).toEqual(Array.from(three.positions));
    expect(Array.from(read.rotations)).toEqual(Array.from(three.rotations));
    expect(Array.from(read.colors)).toEqual(Array.from(three.colors));
    expect(Array.from(read.sh!.coefficients)).toEqual(Array.from(three.sh!.coefficients));
    expect(parseSpz(packSpzV4(SPLATS)).sh).toBeNull();
  });

  it('keeps the antialiased flag', () => {
    expect(parseSpz(packSpz(SPLATS, { flags: 1 })).antialiased).toBe(true);
  });

  it('inflates a gzipped stream, as the glTF extension carries it', async () => {
    const zipped = new Uint8Array(gzipSync(packSpz(SPLATS)));
    expect(isGzip(zipped)).toBe(true);
    const splats = await decodeSpz(zipped);
    expect(splats.count).toBe(3);
    expect(splats.positions[2]).toBeCloseTo(30.125, 3);
  });

  it('refuses what it cannot read', () => {
    const packed = packSpz(SPLATS);
    expect(() => parseSpz(packed.subarray(0, 40))).toThrow(/bytes for 3 splats/);
    const v5 = packed.slice();
    new DataView(v5.buffer).setUint32(4, 5, true);
    expect(() => parseSpz(v5)).toThrow(/version 5/);
    // A version 4 header with the streams of another degree.
    const v4 = packSpzV4(SPLATS);
    v4[12] = 2;
    expect(() => parseSpz(v4)).toThrow(/streams/);
    const junk = packed.slice();
    junk[0] = 0;
    expect(() => parseSpz(junk)).toThrow(/not an SPZ/);
  });
});
