import { gzipSync } from 'zlib';

import { isSplatGlb, multiply, readGlb, splatsFromGlb } from './glbSplats';
import { packSpz, splatGlb, type PlainSplat } from './spzFixture';

import { TextDecoder as NodeTextDecoder, TextEncoder as NodeTextEncoder } from 'util';
import { DecompressionStream as NodeDecompressionStream } from 'stream/web';

// jsdom has neither; the browsers the panel runs in have both.
Object.assign(globalThis, {
  DecompressionStream: (globalThis as any).DecompressionStream ?? NodeDecompressionStream,
  TextDecoder: (globalThis as any).TextDecoder ?? NodeTextDecoder,
  TextEncoder: (globalThis as any).TextEncoder ?? NodeTextEncoder,
});

const SPLATS: PlainSplat[] = [
  { position: [1, 2, 3], scale: [0.1, 0.2, 0.3], rotation: [0, 0, 0, 1], color: [1, 0, 0], opacity: 1 },
  { position: [-4, 5, -6], scale: [1, 1, 1], rotation: [0, 0, 0, 1], color: [0, 1, 0], opacity: 0.5 },
];

/** Esri's Portcoast tiles turn their content from z up to glTF's y up with this node matrix. */
const Z_UP_TO_Y_UP = [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1];

describe('splats in a binary glTF', () => {
  it('tells a glTF of splats from any other', () => {
    const glb = splatGlb(new Uint8Array(gzipSync(packSpz(SPLATS))), 2);
    expect(isSplatGlb(glb)).toBe(true);
    const plain = new Uint8Array(glb.slice(0));
    const json = readGlb(plain)!.json;
    expect(json.extensionsUsed).toContain('KHR_gaussian_splatting');
    expect(isSplatGlb(new TextEncoder().encode('{"asset":{}}').buffer)).toBe(false);
    expect(isSplatGlb(new ArrayBuffer(8))).toBe(false);
  });

  it('decodes the SPZ of each primitive, with its node transform', async () => {
    const glb = splatGlb(new Uint8Array(gzipSync(packSpz(SPLATS))), 2, Z_UP_TO_Y_UP);
    const chunks = await splatsFromGlb(glb);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].matrix).toEqual(Z_UP_TO_Y_UP);
    const { splats } = chunks[0];
    expect(splats.count).toBe(2);
    expect(Array.from(splats.positions.subarray(3, 6)).map((v) => Math.round(v))).toEqual([-4, 5, -6]);
    expect(splats.colors[4 + 1]).toBeGreaterThan(250);
    expect(Math.abs(splats.colors[4 + 3] - 128)).toBeLessThanOrEqual(1);
  });

  it('multiplies column-major matrices', () => {
    const translate = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 20, 30, 1];
    // Translate after turning: the turned point, moved.
    const m = multiply(translate, Z_UP_TO_Y_UP);
    const p = [1, 2, 3];
    const out = [0, 1, 2].map((r) => m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r]);
    expect(out).toEqual([11, 23, 28]);
  });
});
