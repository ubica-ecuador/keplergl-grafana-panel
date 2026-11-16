import { TextDecoder as NodeTextDecoder, TextEncoder as NodeTextEncoder } from 'util';

import { splatsFromGlb } from './glbSplats';
import { packSh, shColour, SH_GLSL, SH_TEXTURE_WIDTH, shTexels } from './splatSh';
import { parseSpz, shByte, type SplatSh } from './spz';
import { packSpz } from './spzFixture';

Object.assign(globalThis, {
  TextDecoder: (globalThis as any).TextDecoder ?? NodeTextDecoder,
  TextEncoder: (globalThis as any).TextEncoder ?? NodeTextEncoder,
});

const splat = (sh?: number[]) => ({
  position: [0, 0, 0] as [number, number, number],
  scale: [1, 1, 1] as [number, number, number],
  rotation: [0, 0, 0, 1] as [number, number, number, number],
  color: [0.5, 0.5, 0.5] as [number, number, number],
  opacity: 1,
  sh,
});

/** Degree 3's 45 values, each a little different, in ±1. */
const ramp = (offset: number) => Array.from({ length: 45 }, (_, k) => ((k * 7 + offset) % 23) / 23 - 0.5);

describe('the colour that changes with the angle of view', () => {
  it('is read from SPZ as SPZ stores it: per splat, per coefficient, red, green, blue', () => {
    const splats = parseSpz(packSpz([splat(ramp(0)), splat(ramp(5))], { shDegree: 3 }));
    expect(splats.sh?.degree).toBe(3);
    expect(splats.sh?.coefficients).toHaveLength(2 * 45);
    expect(splats.sh!.coefficients[45 + 4]).toBe(shByte(ramp(5)[4]));
    expect(parseSpz(packSpz([splat()])).sh).toBeNull();
  });

  it('keeps degree 1 and 2 as they are, and only the first three degrees of more', () => {
    expect(parseSpz(packSpz([splat(ramp(0).slice(0, 9))], { shDegree: 1 })).sh?.coefficients).toHaveLength(9);
    expect(parseSpz(packSpz([splat(ramp(0).slice(0, 24))], { shDegree: 2 })).sh?.degree).toBe(2);
    const four = parseSpz(packSpz([splat([...ramp(0), ...Array(27).fill(0.25)])], { shDegree: 4 })).sh!;
    expect(four.degree).toBe(3);
    expect(Array.from(four.coefficients)).toEqual(ramp(0).map(shByte));
  });

  it('is packed 1, 2 or 3 texels a splat, rows of a whole number of splats', () => {
    expect([1, 2, 3].map(shTexels)).toEqual([1, 2, 3]);
    const sh: SplatSh = { degree: 3, coefficients: new Uint8Array([...ramp(0), ...ramp(5)].map(shByte)) };
    const packed = packSh(sh, 2)!;
    expect(packed.width).toBe(6);
    expect(packed.height).toBe(1);
    const bytes = new Uint8Array(packed.data.buffer);
    // The second splat starts at its third texel, 48 bytes in; the three bytes past its 45 are left 0.
    expect(Array.from(bytes.subarray(48, 93))).toEqual(ramp(5).map(shByte));
    expect(bytes[45]).toBe(0);
    expect(SH_TEXTURE_WIDTH % 3).toBe(0);
  });

  it('keeps one colour past the GPU budget or the largest texture', () => {
    const sh: SplatSh = { degree: 3, coefficients: new Uint8Array(0) };
    expect(packSh(sh, 6_000_000)).toBeNull();
    expect(packSh(sh, 100_000, 64)).toBeNull();
  });

  it("sums 3D Gaussian Splatting's basis along the direction from the eye", () => {
    // Degree 1 only, red: Y(1,-1) ~ -y, Y(1,0) ~ z, Y(1,1) ~ -x, each 0.4886 at a unit axis.
    const one = (j: number) => {
      const values = Array(9).fill(0);
      values[j * 3] = 0.5;
      return { degree: 1 as const, coefficients: new Uint8Array(values.map(shByte)) };
    };
    const c1 = 0.4886025119029199 * 0.5;
    expect(shColour(one(0), 0, [0, 1, 0])[0]).toBeCloseTo(-c1, 6);
    expect(shColour(one(1), 0, [0, 0, 1])[0]).toBeCloseTo(c1, 6);
    expect(shColour(one(2), 0, [1, 0, 0])[0]).toBeCloseTo(-c1, 6);
    // Seen from the other side, the opposite.
    expect(shColour(one(2), 0, [-1, 0, 0])[0]).toBeCloseTo(c1, 6);
    expect(shColour(one(2), 0, [0, 1, 0])[0]).toBeCloseTo(0, 6);
  });

  it('is read by the shader from the bytes the texture holds, the same sum', () => {
    // The shader's byte reading, in JS: word b >> 2, shift (b & 3) × 8, as SH_GLSL's shCoef.
    const sh: SplatSh = { degree: 3, coefficients: new Uint8Array([...ramp(0), ...ramp(5)].map(shByte)) };
    const packed = packSh(sh, 2)!;
    const coefOf = (index: number, j: number, c: number) => {
      const words = packed.data.subarray(index * 3 * 4, index * 3 * 4 + 12);
      const b = j * 3 + c;
      return (((words[b >> 2] >>> ((b & 3) * 8)) & 255) - 128) / 128;
    };
    for (let j = 0; j < 15; j++) {
      for (let c = 0; c < 3; c++) {
        expect(coefOf(1, j, c)).toBeCloseTo((sh.coefficients[45 + j * 3 + c] - 128) / 128, 9);
      }
    }
    expect(SH_GLSL).toContain('uniform highp usampler2D splatSh;');
    expect(SH_GLSL).toContain(`#define SH_TEXTURE_WIDTH ${SH_TEXTURE_WIDTH}`);
  });

  it("is read from a glTF's plain attributes, degree by degree", async () => {
    const count = 1;
    const floats: number[][] = [];
    const attributes: Record<string, number> = {};
    const add = (name: string, values: number[]) => {
      attributes[name] = floats.length;
      floats.push(values);
    };
    add('POSITION', [0, 0, 0]);
    add('KHR_gaussian_splatting:ROTATION', [0, 0, 0, 1]);
    add('KHR_gaussian_splatting:SCALE', [1, 1, 1]);
    add('KHR_gaussian_splatting:OPACITY', [1]);
    add('KHR_gaussian_splatting:SH_DEGREE_0_COEF_0', [0, 0, 0]);
    add('KHR_gaussian_splatting:SH_DEGREE_1_COEF_0', [0.1, 0.2, 0.3]);
    add('KHR_gaussian_splatting:SH_DEGREE_1_COEF_1', [-0.1, -0.2, -0.3]);
    add('KHR_gaussian_splatting:SH_DEGREE_1_COEF_2', [0.5, 0, -0.5]);
    // Degree 2 incomplete: left out.
    add('KHR_gaussian_splatting:SH_DEGREE_2_COEF_0', [0.9, 0.9, 0.9]);
    let offset = 0;
    const views = floats.map((values) => {
      const view = { buffer: 0, byteOffset: offset, byteLength: values.length * 4 };
      offset += values.length * 4;
      return view;
    });
    const accessors = floats.map((values, i) => ({
      bufferView: i,
      componentType: 5126,
      count,
      type: ['SCALAR', '', '', 'VEC3', 'VEC4'][values.length],
    }));
    const json = {
      asset: { version: '2.0' },
      extensionsUsed: ['KHR_gaussian_splatting'],
      buffers: [{ byteLength: offset }],
      bufferViews: views,
      accessors,
      meshes: [
        { primitives: [{ mode: 0, attributes, extensions: { KHR_gaussian_splatting: { kernel: 'ellipse' } } }] },
      ],
      nodes: [{ mesh: 0 }],
      scenes: [{ nodes: [0] }],
      scene: 0,
    };
    const text = new TextEncoder().encode(JSON.stringify(json));
    const jsonLength = Math.ceil(text.length / 4) * 4;
    const total = 12 + 8 + jsonLength + 8 + offset;
    const out = new Uint8Array(total);
    const view = new DataView(out.buffer);
    view.setUint32(0, 0x46546c67, true);
    view.setUint32(4, 2, true);
    view.setUint32(8, total, true);
    view.setUint32(12, jsonLength, true);
    view.setUint32(16, 0x4e4f534a, true);
    out.fill(0x20, 20, 20 + jsonLength);
    out.set(text, 20);
    view.setUint32(20 + jsonLength, offset, true);
    view.setUint32(24 + jsonLength, 0x004e4942, true);
    new Float32Array(out.buffer, 28 + jsonLength, offset / 4).set(floats.flat());
    const [chunk] = await splatsFromGlb(out.buffer);
    expect(chunk.splats.sh?.degree).toBe(1);
    expect(Array.from(chunk.splats.sh!.coefficients)).toEqual(
      [0.1, 0.2, 0.3, -0.1, -0.2, -0.3, 0.5, 0, -0.5].map(shByte)
    );
  });
});
