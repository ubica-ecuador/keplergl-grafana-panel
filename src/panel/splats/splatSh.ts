/**
 * The colour of a splat that changes with the angle it is seen from: its
 * spherical harmonics past degree 0, up to degree 3, as 3D Gaussian Splatting
 * trains them (the basis and the constants of its renderer).
 *
 * **On the GPU.** Each splat's coefficients, a byte each as SPZ stores them
 * (spz.ts `SplatSh`), are packed in a third integer texture, 1 to 3 texels a
 * splat by degree (9, 24 or 45 bytes). The vertex shader reads them, works out
 * the direction from the eye to the splat in the splats' own space (the space
 * they were trained in, the eye brought there as the sort brings it) and adds
 * the sum of the harmonics to the splat's diffuse colour.
 */

import type { SplatSh } from './spz';

/** Texels a row of the harmonics' texture: a multiple of 3, so a splat's texels never straddle two rows. */
export const SH_TEXTURE_WIDTH = 4095;

/** The most bytes the harmonics of one set of splats may take on the GPU; past it, they keep one colour. */
export const SH_GPU_BUDGET = 256 * 1024 * 1024;

/** Texels a splat takes for its harmonics of this degree: 16 bytes a texel. */
export function shTexels(degree: number): number {
  return Math.ceil((((degree + 1) * (degree + 1) - 1) * 3) / 16);
}

/**
 * The harmonics packed for their texture: splat i's bytes from texel
 * i × shTexels(degree), in row-major order of SH_TEXTURE_WIDTH-texel rows; or
 * null past the GPU budget or the device's largest texture.
 */
export function packSh(
  sh: SplatSh,
  count: number,
  maxTextureSize = 8192
): { width: number; height: number; data: Uint32Array } | null {
  const texels = shTexels(sh.degree);
  const perSplat = (((sh.degree + 1) * (sh.degree + 1) - 1) * 3) as number;
  const total = count * texels;
  if (total * 16 > SH_GPU_BUDGET) {
    return null;
  }
  const width = Math.min(SH_TEXTURE_WIDTH, Math.max(texels, total));
  const height = Math.max(1, Math.ceil(total / width));
  if (height > maxTextureSize || width > maxTextureSize) {
    return null;
  }
  const data = new Uint32Array(width * height * 4);
  const bytes = new Uint8Array(data.buffer);
  for (let i = 0; i < count; i++) {
    bytes.set(sh.coefficients.subarray(i * perSplat, (i + 1) * perSplat), i * texels * 16);
  }
  return { width, height, data };
}

const SH_C1 = 0.4886025119029199;
const SH_C2 = [1.0925484305920792, -1.0925484305920792, 0.31539156525252005, -1.0925484305920792, 0.5462742152960396];
const SH_C3 = [
  -0.5900435899266435, 2.890611442640554, -0.4570457994644658, 0.3731763325901154, -0.4570457994644658,
  1.445305721320277, -0.5900435899266435,
];

/**
 * What a splat's harmonics add to its diffuse colour seen along `dir` (from
 * the eye to the splat, unit length), red, green and blue on the 0–1 scale:
 * the same sum as the shader's (`SH_GLSL`), for the tests.
 */
export function shColour(sh: SplatSh, index: number, dir: [number, number, number]): [number, number, number] {
  const perSplat = ((sh.degree + 1) * (sh.degree + 1) - 1) * 3;
  const coef = (j: number) =>
    [0, 1, 2].map((c) => (sh.coefficients[index * perSplat + j * 3 + c] - 128) / 128) as [number, number, number];
  const [x, y, z] = dir;
  const terms: Array<[number, number]> = [
    [-SH_C1 * y, 0],
    [SH_C1 * z, 1],
    [-SH_C1 * x, 2],
  ];
  if (sh.degree > 1) {
    const [xx, yy, zz, xy, yz, xz] = [x * x, y * y, z * z, x * y, y * z, x * z];
    terms.push(
      [SH_C2[0] * xy, 3],
      [SH_C2[1] * yz, 4],
      [SH_C2[2] * (2 * zz - xx - yy), 5],
      [SH_C2[3] * xz, 6],
      [SH_C2[4] * (xx - yy), 7]
    );
    if (sh.degree > 2) {
      terms.push(
        [SH_C3[0] * y * (3 * xx - yy), 8],
        [SH_C3[1] * xy * z, 9],
        [SH_C3[2] * y * (4 * zz - xx - yy), 10],
        [SH_C3[3] * z * (2 * zz - 3 * xx - 3 * yy), 11],
        [SH_C3[4] * x * (4 * zz - xx - yy), 12],
        [SH_C3[5] * z * (xx - yy), 13],
        [SH_C3[6] * x * (xx - 3 * yy), 14]
      );
    }
  }
  const out: [number, number, number] = [0, 0, 0];
  for (const [weight, j] of terms) {
    const c = coef(j);
    out[0] += weight * c[0];
    out[1] += weight * c[1];
    out[2] += weight * c[2];
  }
  return out;
}

/** The shader's side: reads a splat's coefficients and sums them along a direction (`shColour`'s twin). */
export const SH_GLSL = /* glsl */ `\
#define SH_TEXTURE_WIDTH ${SH_TEXTURE_WIDTH}
uniform highp usampler2D splatSh;

uint shWords[12];

vec3 shCoef(int j) {
  vec3 v;
  for (int c = 0; c < 3; c++) {
    int b = j * 3 + c;
    uint w = shWords[b >> 2];
    v[c] = (float((w >> uint((b & 3) * 8)) & 255u) - 128.0) / 128.0;
  }
  return v;
}

vec3 splatShColour(int index, int degree, vec3 dir) {
  int texels = degree == 1 ? 1 : (degree == 2 ? 2 : 3);
  for (int t = 0; t < 3; t++) {
    if (t >= texels) {
      break;
    }
    int linear = index * texels + t;
    uvec4 v = texelFetch(splatSh, ivec2(linear % SH_TEXTURE_WIDTH, linear / SH_TEXTURE_WIDTH), 0);
    shWords[t * 4] = v.x;
    shWords[t * 4 + 1] = v.y;
    shWords[t * 4 + 2] = v.z;
    shWords[t * 4 + 3] = v.w;
  }
  float x = dir.x;
  float y = dir.y;
  float z = dir.z;
  vec3 r = ${SH_C1} * (-y * shCoef(0) + z * shCoef(1) - x * shCoef(2));
  if (degree > 1) {
    float xx = x * x;
    float yy = y * y;
    float zz = z * z;
    r += ${SH_C2[0]} * x * y * shCoef(3) + ${SH_C2[1]} * y * z * shCoef(4) +
      ${SH_C2[2]} * (2.0 * zz - xx - yy) * shCoef(5) + ${SH_C2[3]} * x * z * shCoef(6) +
      ${SH_C2[4]} * (xx - yy) * shCoef(7);
    if (degree > 2) {
      r += ${SH_C3[0]} * y * (3.0 * xx - yy) * shCoef(8) + ${SH_C3[1]} * x * y * z * shCoef(9) +
        ${SH_C3[2]} * y * (4.0 * zz - xx - yy) * shCoef(10) +
        ${SH_C3[3]} * z * (2.0 * zz - 3.0 * xx - 3.0 * yy) * shCoef(11) +
        ${SH_C3[4]} * x * (4.0 * zz - xx - yy) * shCoef(12) + ${SH_C3[5]} * z * (xx - yy) * shCoef(13) +
        ${SH_C3[6]} * x * (xx - 3.0 * yy) * shCoef(14);
    }
  }
  return r;
}
`;
