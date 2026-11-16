/**
 * A deck.gl layer that draws Gaussian splats: each splat an ellipsoid whose
 * colour fades from its centre, drawn as the ellipse it covers on the screen,
 * back to front, blended one over another — the forward pass the splats were
 * trained with (KHR_gaussian_splatting's "ellipse" kernel, 3σ cut-off).
 *
 * **On the GPU.** Each splat's centre and colour, and its spread and
 * orientation, sit in two integer textures; the only vertex attribute is the
 * draw order, one index per splat, so a new order costs four bytes a splat and
 * nothing else moves. The vertex shader builds the splat's 3D covariance from
 * its scale and rotation, and projects it with the Jacobian of deck's own
 * projection, read off `project_position` along each of the splat's axes: the
 * model matrix, the metres of `METER_OFFSETS` and the camera all come in that
 * way, so the layer sits wherever any deck layer would.
 *
 * **The order.** Worked out on the CPU (`splatOrder.ts`), by distance from the
 * eye in the splats' own space, and again only once the eye has moved; turning
 * the camera keeps it.
 *
 * Splats do not write depth and are hidden by what is nearer (the base map's
 * buildings, other layers), as glass would be.
 */

import { Layer, project32, picking, type DefaultProps, type LayerProps, type UpdateParameters } from '@deck.gl/core';
import type { Buffer, Texture } from '@luma.gl/core';
import { Geometry, Model } from '@luma.gl/engine';

import { backToFront, needsResort } from './splatOrder';
import { WORKER_SORT_THRESHOLD, workerSorter, type WorkerSorter } from './sortWorker';
import { COLOUR_PASS, DEPTH_PASS, layPicture, OPAQUE, passGeometry, pictureOf, releasePicture } from './splatPicture';
import type { Splats } from './spz';

/** Splats drawn per row of the data textures. */
const TEXTURE_WIDTH = 2048;

const uniformBlock = /* glsl */ `\
layout(std140) uniform gaussianSplatUniforms {
  highp int textureWidth;
  highp int antialiased;
  highp int linearColors;
  float maxRadius;
} gaussianSplat;
`;

const gaussianSplatUniforms = {
  name: 'gaussianSplat',
  vs: uniformBlock,
  fs: uniformBlock,
  uniformTypes: {
    textureWidth: 'i32',
    antialiased: 'i32',
    linearColors: 'i32',
    maxRadius: 'f32',
  },
} as any;

const vs = /* glsl */ `\
#version 300 es
#define SHADER_NAME gaussian-splat-layer-vertex-shader
precision highp float;
precision highp int;
precision highp usampler2D;

in vec3 positions;
in float instanceSplatIndex;

uniform usampler2D splatCenters;
uniform usampler2D splatShapes;

out vec4 vColor;
out vec2 vOffset;

// The extension's cut-off: three standard deviations.
const float CUTOFF = 3.0;
// The screen-space blur 3D Gaussian splatting is trained with, in pixels squared.
const float LOW_PASS = 0.3;

mat3 rotation(vec4 q) {
  float x = q.x, y = q.y, z = q.z, w = q.w;
  return mat3(
    1.0 - 2.0 * (y * y + z * z), 2.0 * (x * y + w * z), 2.0 * (x * z - w * y),
    2.0 * (x * y - w * z), 1.0 - 2.0 * (x * x + z * z), 2.0 * (y * z + w * x),
    2.0 * (x * z + w * y), 2.0 * (y * z - w * x), 1.0 - 2.0 * (x * x + y * y)
  );
}

// GLSL ES 3.00 has no unpackUnorm4x8 (it came in 3.10); its 2x16 unpackers are used for the shapes.
vec4 unpackBytes(uint v) {
  return vec4(float(v & 255u), float((v >> 8u) & 255u), float((v >> 16u) & 255u), float(v >> 24u)) / 255.0;
}

void cull() {
  gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
  vColor = vec4(0.0);
  vOffset = vec2(0.0);
}

void main(void) {
  int index = int(instanceSplatIndex + 0.5);
  ivec2 texel = ivec2(index % gaussianSplat.textureWidth, index / gaussianSplat.textureWidth);
  uvec4 a = texelFetch(splatCenters, texel, 0);
  uvec4 b = texelFetch(splatShapes, texel, 0);
  vec3 center = uintBitsToFloat(a.xyz);
  vec4 color = unpackBytes(a.w);
  vec3 scale = vec3(unpackHalf2x16(b.x), unpackHalf2x16(b.y).x);
  vec4 quaternion = vec4(unpackSnorm2x16(b.z), unpackSnorm2x16(b.w));
  float qLength = length(quaternion);
  quaternion = qLength > 0.0 ? quaternion / qLength : vec4(0.0, 0.0, 0.0, 1.0);

  geometry.worldPosition = center;
  geometry.pickingColor = vec3(
    float((index + 1) & 255), float(((index + 1) >> 8) & 255), float(((index + 1) >> 16) & 255)
  );

  mat3 m = rotation(quaternion) * mat3(scale.x, 0.0, 0.0, 0.0, scale.y, 0.0, 0.0, 0.0, scale.z);
  mat3 sigma = m * transpose(m);

  vec3 low = vec3(0.0);
  vec4 commonCenter = project_position(vec4(center, 1.0), low);
  vec4 clip = project_common_position_to_clipspace(commonCenter);
  geometry.position = commonCenter;
  if (clip.w <= 0.0) {
    cull();
    return;
  }
  // deck's projection is affine up to the divide: a metre along each of the
  // splat's axes, through it, gives the columns of its Jacobian in clip space.
  vec4 cx = project_common_position_to_clipspace(project_position(vec4(center + vec3(1.0, 0.0, 0.0), 1.0), low)) - clip;
  vec4 cy = project_common_position_to_clipspace(project_position(vec4(center + vec3(0.0, 1.0, 0.0), 1.0), low)) - clip;
  vec4 cz = project_common_position_to_clipspace(project_position(vec4(center + vec3(0.0, 0.0, 1.0), 1.0), low)) - clip;
  vec2 ndc = clip.xy / clip.w;
  vec2 halfViewport = project.viewportSize * 0.5;
  // ...and the divide's own derivative brings them to pixels.
  mat3x2 jacobian = mat3x2(
    (cx.xy - ndc * cx.w) / clip.w * halfViewport,
    (cy.xy - ndc * cy.w) / clip.w * halfViewport,
    (cz.xy - ndc * cz.w) / clip.w * halfViewport
  );
  mat2 cov = jacobian * sigma * transpose(jacobian);

  float a0 = cov[0][0];
  float b0 = cov[0][1];
  float c0 = cov[1][1];
  float aa = a0 + LOW_PASS;
  float cc = c0 + LOW_PASS;
  float opacity = color.a * layer.opacity;
  if (gaussianSplat.antialiased == 1) {
    opacity *= sqrt(max((a0 * c0 - b0 * b0) / (aa * cc - b0 * b0), 0.0));
  }
  if (opacity < 1.0 / 255.0) {
    cull();
    return;
  }
  float mid = 0.5 * (aa + cc);
  float radius = length(vec2(0.5 * (aa - cc), b0));
  float major = mid + radius;
  float minor = max(mid - radius, 0.1);
  vec2 axis = abs(b0) > 1e-9 ? normalize(vec2(b0, major - aa)) : (aa >= cc ? vec2(1.0, 0.0) : vec2(0.0, 1.0));
  float sigmaMajor = sqrt(major);
  float sigmaMinor = sqrt(minor);
  float r1 = min(CUTOFF * sigmaMajor, gaussianSplat.maxRadius);
  float r2 = min(CUTOFF * sigmaMinor, gaussianSplat.maxRadius);
  if (any(greaterThan(abs(ndc), vec2(1.0) + vec2(r1) / halfViewport)) || abs(clip.z / clip.w) > 1.0) {
    cull();
    return;
  }
  vec2 offset = positions.x * r1 * axis + positions.y * r2 * vec2(-axis.y, axis.x);
  gl_Position = clip + vec4(offset / halfViewport * clip.w, 0.0, 0.0);
  vOffset = positions.xy * vec2(r1 / sigmaMajor, r2 / sigmaMinor);
  vec3 rgb = color.rgb;
  if (gaussianSplat.linearColors == 1) {
    // Linear BT.709 to the sRGB the screen shows, per splat (the extension blends before converting; close enough).
    rgb = mix(rgb * 12.92, 1.055 * pow(rgb, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), rgb));
  }
  vColor = vec4(rgb, opacity);
  DECKGL_FILTER_COLOR(vColor, geometry);
}
`;

const fs = /* glsl */ `\
#version 300 es
#define SHADER_NAME gaussian-splat-layer-fragment-shader
precision highp float;

in vec4 vColor;
in vec2 vOffset;
out vec4 fragColor;

void main(void) {
  float r2 = dot(vOffset, vOffset);
  if (r2 > 9.0) {
    discard;
  }
  float alpha = vColor.a * exp(-0.5 * r2);
  if (alpha < 1.0 / 255.0) {
    discard;
  }
  // Premultiplied, blended with the source factor one, as the extension advises for 8-bit buffers.
  fragColor = vec4(vColor.rgb * alpha, alpha);
  DECKGL_FILTER_COLOR(fragColor, geometry);
}
`;

/** The GPU state of one set of splats. */
interface SplatGpu {
  centers: Texture;
  shapes: Texture;
  order: Buffer;
}

export interface GaussianSplatLayerProps extends LayerProps {
  /** The splats, in the layer's model space (its `modelMatrix` and coordinate system). */
  splats: Splats | null;
  /** The largest radius an ellipse may take on the screen, in pixels. */
  maxRadius?: number;
  /** The splats' colours are linear BT.709 (`lin_rec709_display`), to be brought to sRGB for the screen. */
  linearColors?: boolean;
  /**
   * For splats trained with the screen-space filter (SPZ's antialiased flag),
   * scale each opacity by what the 0.3 px² blur takes away, as Mip-Splatting
   * and gsplat's "antialiased" mode render: a splat smaller than a pixel is
   * dimmed by as much as the blur spread it. On by default, for the splats
   * that carry the flag (Esri's do): seen from afar, it took the bright
   * flecks and needles off their edges. Off draws them as CesiumJS does.
   */
  antialiasCompensation?: boolean;
  /** Called after the first frame the splats were drawn in. */
  onFirstDraw?: () => void;
  /**
   * Under an opacity of 1, the layers of one group (a tileset's tiles) are drawn into one picture laid on the map
   * once (splatPicture.ts): the first drawn clears it, the last lays it. Without a group, a layer has its own.
   */
  pictureGroup?: string | null;
  pictureFirst?: boolean;
  pictureLast?: boolean;
}

/**
 * How splats are blended: premultiplied colour over what is behind (source
 * factor one), depth tested but never written. Under both naming schemes deck
 * reads, because kepler hands every layer its own, in WebGL's names
 * (`blendFunc` SRC_ALPHA for "normal" blending, `depthTest`, and `depthMask`
 * in 3D), which won over luma's names given alone: each colour was multiplied
 * by its alpha twice (the splats came out dark) and every ellipse wrote depth
 * and cut away the ones behind it (scales where a surface should be).
 */
export const SPLAT_PARAMETERS = {
  // luma.gl's names
  depthWriteEnabled: false,
  depthCompare: 'less-equal',
  blend: true,
  blendColorSrcFactor: 'one',
  blendColorDstFactor: 'one-minus-src-alpha',
  blendColorOperation: 'add',
  blendAlphaSrcFactor: 'one',
  blendAlphaDstFactor: 'one-minus-src-alpha',
  blendAlphaOperation: 'add',
  cullMode: 'none',
  // WebGL's names, as kepler gives them (ONE, ONE_MINUS_SRC_ALPHA, FUNC_ADD, LEQUAL)
  depthMask: false,
  depthTest: true,
  depthFunc: 0x0203,
  blendFunc: [1, 0x0303, 1, 0x0303],
  blendEquation: [0x8006, 0x8006],
} as const;

/** The same, in luma.gl's names only, for the model itself. */
const MODEL_PARAMETERS = Object.fromEntries(
  Object.entries(SPLAT_PARAMETERS).filter(
    ([key]) => !['depthMask', 'depthTest', 'depthFunc', 'blendFunc', 'blendEquation'].includes(key)
  )
);

const defaultProps: DefaultProps<GaussianSplatLayerProps> = {
  splats: { type: 'object', value: null, compare: true } as any,
  maxRadius: { type: 'number', min: 1, value: 1024 },
  linearColors: false,
  antialiasCompensation: true,
  onFirstDraw: { type: 'function', value: () => {}, optional: true } as any,
  parameters: SPLAT_PARAMETERS as any,
  pictureGroup: null,
  pictureFirst: true,
  pictureLast: true,
};

/** A 4×4 column-major matrix inverted, or null if it has none. */
export function invert(m: ArrayLike<number>): number[] | null {
  const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = Array.from(m);
  const b00 = a00 * a11 - a01 * a10;
  const b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11;
  const b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30;
  const b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31;
  const b11 = a22 * a33 - a23 * a32;
  const det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) {
    return null;
  }
  const d = 1 / det;
  return [
    (a11 * b11 - a12 * b10 + a13 * b09) * d,
    (a02 * b10 - a01 * b11 - a03 * b09) * d,
    (a31 * b05 - a32 * b04 + a33 * b03) * d,
    (a22 * b04 - a21 * b05 - a23 * b03) * d,
    (a12 * b08 - a10 * b11 - a13 * b07) * d,
    (a00 * b11 - a02 * b08 + a03 * b07) * d,
    (a32 * b02 - a30 * b05 - a33 * b01) * d,
    (a20 * b05 - a22 * b02 + a23 * b01) * d,
    (a10 * b10 - a11 * b08 + a13 * b06) * d,
    (a01 * b08 - a00 * b10 - a03 * b06) * d,
    (a30 * b04 - a31 * b02 + a33 * b00) * d,
    (a21 * b02 - a20 * b04 - a23 * b00) * d,
    (a11 * b07 - a10 * b09 - a12 * b06) * d,
    (a00 * b09 - a01 * b07 + a02 * b06) * d,
    (a31 * b01 - a30 * b03 - a32 * b00) * d,
    (a20 * b03 - a21 * b01 + a22 * b00) * d,
  ];
}

/** A point through a 4×4 column-major matrix. */
function transformPoint(m: ArrayLike<number>, p: ArrayLike<number>): [number, number, number] {
  const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15] || 1;
  return [
    (m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12]) / w,
    (m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13]) / w,
    (m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]) / w,
  ];
}

/** A float as the bits of a half float (IEEE 754 binary16), rounded to nearest. */
export function toHalf(value: number): number {
  const f = new Float32Array(1);
  const u = new Uint32Array(f.buffer);
  f[0] = value;
  const x = u[0];
  const sign = (x >>> 16) & 0x8000;
  const exponent = ((x >>> 23) & 0xff) - 127 + 15;
  let mantissa = x & 0x7fffff;
  if (exponent >= 31) {
    return sign | 0x7c00;
  }
  if (exponent <= 0) {
    if (exponent < -10) {
      return sign;
    }
    mantissa = (mantissa | 0x800000) >> (1 - exponent);
    return sign | ((mantissa + 0x1000) >> 13);
  }
  const half = sign | (exponent << 10) | (mantissa >> 13);
  // Round to nearest; a carry into the exponent is still the right value.
  return mantissa & 0x1000 ? half + 1 : half;
}

/**
 * The splats packed for the two data textures. Centres: x, y, z as floats and
 * the colour a byte a channel. Shapes: the scales as half floats (two to a
 * channel) and the quaternion as 16-bit signed normalized pairs — a byte a
 * component tilted thin splats seen edge-on by up to a degree, and the roofs
 * of a splat model are made of thin splats.
 */
export function packSplats(
  splats: Splats,
  width = TEXTURE_WIDTH
): { width: number; height: number; centers: Uint32Array; shapes: Uint32Array } {
  const { count, positions, scales, rotations, colors } = splats;
  const w = Math.max(1, Math.min(width, count));
  const height = Math.max(1, Math.ceil(count / w));
  const centers = new Uint32Array(w * height * 4);
  const shapes = new Uint32Array(w * height * 4);
  const centerFloats = new Float32Array(centers.buffer);
  const snorm16 = (v: number) => Math.round(Math.max(-1, Math.min(1, v)) * 32767) & 0xffff;
  for (let i = 0; i < count; i++) {
    centerFloats[i * 4] = positions[i * 3];
    centerFloats[i * 4 + 1] = positions[i * 3 + 1];
    centerFloats[i * 4 + 2] = positions[i * 3 + 2];
    centers[i * 4 + 3] =
      (colors[i * 4] | (colors[i * 4 + 1] << 8) | (colors[i * 4 + 2] << 16) | (colors[i * 4 + 3] << 24)) >>> 0;
    shapes[i * 4] = (toHalf(scales[i * 3]) | (toHalf(scales[i * 3 + 1]) << 16)) >>> 0;
    shapes[i * 4 + 1] = toHalf(scales[i * 3 + 2]);
    shapes[i * 4 + 2] = (snorm16(rotations[i * 4]) | (snorm16(rotations[i * 4 + 1]) << 16)) >>> 0;
    shapes[i * 4 + 3] = (snorm16(rotations[i * 4 + 2]) | (snorm16(rotations[i * 4 + 3]) << 16)) >>> 0;
  }
  return { width: w, height, centers, shapes };
}

/** The middle of the splats' bounds, in their own space. */
function centreOf(splats: Splats): [number, number, number] {
  const low = [Infinity, Infinity, Infinity];
  const high = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < splats.count; i++) {
    for (let k = 0; k < 3; k++) {
      const v = splats.positions[i * 3 + k];
      low[k] = Math.min(low[k], v);
      high[k] = Math.max(high[k], v);
    }
  }
  return [(low[0] + high[0]) / 2, (low[1] + high[1]) / 2, (low[2] + high[2]) / 2];
}

export class GaussianSplatLayer extends Layer<GaussianSplatLayerProps> {
  static layerName = 'GaussianSplatLayer';
  static defaultProps = defaultProps;

  declare state: {
    model?: Model | null;
    gpu?: SplatGpu | null;
    textureWidth: number;
    count: number;
    order?: Float32Array;
    sortedFrom?: [number, number, number] | null;
    centre?: [number, number, number];
    drawn?: boolean;
    /** Large sets: their splats in the shared sorting worker, and the order asked of it. */
    sorter?: WorkerSorter | null;
    /** The order last asked of the worker, and whether one is on its way. */
    generation?: number;
    sorting?: boolean;
    askedAt?: number;
  };

  getShaders() {
    return super.getShaders({ vs, fs, modules: [project32, picking, gaussianSplatUniforms] });
  }

  initializeState(): void {
    this.state = { model: null, gpu: null, textureWidth: 1, count: 0 };
  }

  /** One instance per splat: deck sets the model's instance count from this after every update, and there is no `data`. */
  getNumInstances(): number {
    return this.state?.count ?? 0;
  }

  updateState(params: UpdateParameters<this>): void {
    super.updateState(params);
    const { props, oldProps, changeFlags } = params;
    if (props.splats !== oldProps.splats || changeFlags.extensionsChanged || !this.state.model) {
      this.rebuild(props.splats);
    }
  }

  finalizeState(context: any): void {
    super.finalizeState(context);
    this.release();
    // A layer's own picture goes with it; a group's stays for the group's other layers (splatTiles.ts).
    if (!this.props.pictureGroup) {
      releasePicture(this.context?.device ?? context?.device, this.id);
    }
  }

  private release(): void {
    this.state.sorter?.drop();
    this.state.sorter = null;
    this.state.model?.destroy();
    this.state.gpu?.centers.destroy();
    this.state.gpu?.shapes.destroy();
    this.state.gpu?.order.destroy();
    this.state.model = null;
    this.state.gpu = null;
  }

  private rebuild(splats: Splats | null): void {
    this.release();
    if (!splats || splats.count === 0) {
      this.setState({ count: 0 });
      return;
    }
    const device = this.context.device;
    const packed = packSplats(splats);
    const sampler = {
      minFilter: 'nearest',
      magFilter: 'nearest',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    } as const;
    const centers = device.createTexture({
      id: `${this.id}-centers`,
      format: 'rgba32uint',
      width: packed.width,
      height: packed.height,
      data: packed.centers,
      mipmaps: false,
      sampler,
    } as any);
    const shapes = device.createTexture({
      id: `${this.id}-shapes`,
      format: 'rgba32uint',
      width: packed.width,
      height: packed.height,
      data: packed.shapes,
      mipmaps: false,
      sampler,
    } as any);
    const order = new Float32Array(splats.count);
    for (let i = 0; i < splats.count; i++) {
      order[i] = i;
    }
    const orderBuffer = device.createBuffer({ id: `${this.id}-order`, data: order });
    const model = new Model(device, {
      ...this.getShaders(),
      id: this.props.id,
      bufferLayout: [{ name: 'instanceSplatIndex', format: 'float32', stepMode: 'instance' }],
      geometry: new Geometry({
        topology: 'triangle-strip',
        attributes: { positions: { size: 3, value: new Float32Array([-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0]) } },
      }),
      isInstanced: true,
      instanceCount: splats.count,
      attributes: { instanceSplatIndex: orderBuffer },
      bindings: { splatCenters: centers, splatShapes: shapes },
      parameters: MODEL_PARAMETERS,
    } as any);
    this.setState({
      model,
      gpu: { centers, shapes, order: orderBuffer },
      textureWidth: packed.width,
      count: splats.count,
      order,
      sortedFrom: null,
      centre: centreOf(splats),
      drawn: false,
      sorter:
        splats.count >= WORKER_SORT_THRESHOLD
          ? workerSorter(splats.positions, (sorted, eye, generation) => this.receiveOrder(sorted, eye, generation))
          : null,
      generation: 0,
      sorting: false,
    });
  }

  /** An order back from the worker: drawn from now on, unless the splats have changed since it was asked. */
  private receiveOrder(sorted: Float32Array, eye: [number, number, number], generation: number): void {
    const { gpu, count } = this.state;
    if (generation !== this.state.generation) {
      return;
    }
    this.state.sorting = false;
    if (!gpu || sorted.length !== count) {
      return;
    }
    gpu.order.write(sorted);
    this.state.order = sorted;
    this.state.sortedFrom = eye;
    this.setNeedsRedraw();
  }

  /** The camera, in the splats' own space; null where it cannot be told. */
  eye(): [number, number, number] | null {
    const viewport: any = this.context.viewport;
    const origin = this.props.coordinateOrigin as number[] | undefined;
    const camera: number[] | undefined = viewport?.cameraPosition;
    if (!viewport || !origin || !camera || typeof viewport.projectPosition !== 'function') {
      return null;
    }
    const at = viewport.projectPosition(origin);
    const unitsPerMeter: number[] | undefined = viewport.getDistanceScales?.(origin)?.unitsPerMeter;
    if (!unitsPerMeter) {
      return null;
    }
    const metres = [0, 1, 2].map((k) => (camera[k] - at[k]) / unitsPerMeter[k]);
    const model = this.props.modelMatrix as unknown as ArrayLike<number> | null;
    const inverse = model ? invert(model) : null;
    return inverse ? transformPoint(inverse, metres) : (metres as [number, number, number]);
  }

  private resortIfMoved(): void {
    const { splats } = this.props;
    const { gpu, order, centre, sortedFrom } = this.state;
    const eye = this.eye();
    if (!splats || !gpu || !order || !centre || !eye || !needsResort(sortedFrom, eye, centre)) {
      return;
    }
    const { sorter } = this.state;
    // The first order is worked out here, so that no frame is drawn unsorted while the worker answers.
    if (sorter && sortedFrom) {
      const now = Date.now();
      // One request at a time: a move while it is out is caught by the next frame drawn after it. One
      // that has had no answer in two seconds no longer holds the next back.
      if (!this.state.sorting || now - (this.state.askedAt ?? 0) > 2000) {
        this.state.sorting = true;
        this.state.askedAt = now;
        this.state.generation = (this.state.generation ?? 0) + 1;
        sorter.sort(eye, this.state.generation);
      }
      return;
    }
    backToFront(splats.positions, splats.count, eye, order);
    gpu.order.write(order);
    this.state.sortedFrom = eye;
  }

  /**
   * Draws the splats: straight onto the map, or under an opacity of 1 into the group's picture, which the group's
   * last layer lays on the map (splatPicture.ts). Picking draws straight, at the splats' own alpha.
   */
  draw(opts?: any): void {
    const { model, count } = this.state;
    if (!model || !count) {
      return;
    }
    const renderPass = opts?.renderPass ?? this.context.renderPass;
    const opacity = typeof this.props.opacity === 'number' ? this.props.opacity : 1;
    if (opacity >= OPAQUE || opts?.shaderModuleProps?.picking?.isActive || !renderPass) {
      this.drawSplats(renderPass);
      return;
    }
    const device: any = this.context.device;
    const { width, height, viewport } = passGeometry(device, renderPass);
    const group = this.props.pictureGroup || this.id;
    const picture = pictureOf(device, group, width, height);
    const own = (model as any).parameters;
    // Full strength into the picture: the opacity is the picture's.
    this.setShaderModuleProps({ layer: { opacity: 1 } } as any);
    try {
      for (const pass of [DEPTH_PASS, COLOUR_PASS]) {
        const clear = pass === DEPTH_PASS && this.props.pictureFirst !== false;
        const offscreen = device.beginRenderPass({
          id: `${group}-picture`,
          framebuffer: picture.framebuffer,
          parameters: { viewport },
          ...(clear ? { clearColor: [0, 0, 0, 0], clearDepth: 1 } : { clearColor: false, clearDepth: false }),
        });
        model.setParameters(pass.luma as any);
        try {
          device.withParametersWebGL(pass.gl, () => this.drawSplats(offscreen));
        } finally {
          offscreen.end();
        }
      }
    } finally {
      model.setParameters(own);
      this.setShaderModuleProps({ layer: { opacity: this.props.opacity } } as any);
    }
    if (this.props.pictureLast !== false) {
      layPicture(device, picture, renderPass, opacity);
    }
  }

  private drawSplats(renderPass: any): void {
    const { model, count, textureWidth } = this.state;
    if (!model || !count) {
      return;
    }
    this.resortIfMoved();
    model.shaderInputs.setProps({
      gaussianSplat: {
        textureWidth,
        antialiased: this.props.antialiasCompensation && this.props.splats?.antialiased ? 1 : 0,
        maxRadius: this.props.maxRadius ?? 1024,
        linearColors: this.props.linearColors ? 1 : 0,
      },
    } as any);
    model.setInstanceCount(count);
    model.draw(renderPass);
    if (!this.state.drawn) {
      this.state.drawn = true;
      this.props.onFirstDraw?.();
    }
  }
}
