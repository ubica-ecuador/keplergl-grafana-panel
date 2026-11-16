/**
 * Splats seen through: a layer's opacity applied to a scan as a whole.
 *
 * Multiplying each splat's alpha by the opacity does nothing a viewer can see:
 * a surface of splats is dozens of splats deep, and blended back to front they
 * still cover what is behind them at 0.6. Under 1, the splats are drawn into a
 * picture of their own first, at full strength, then that picture is laid on
 * the map with the opacity. The picture keeps the depth of the nearest splats,
 * so whatever stands in front of the scan (the base map's buildings, other
 * layers) still hides it (`gl_FragDepth`, tested against the map's depth).
 *
 * A tileset is many splat layers, a tile each, and their pictures laid one by
 * one would double the opacity where tiles meet: the layers of one group share
 * one picture, the first drawn clearing it and the last laying it on the map
 * (`pictureGroup`, `pictureFirst`, `pictureLast`; splatTiles.ts sets them).
 */

import type { Framebuffer, Texture } from '@luma.gl/core';
import { Geometry, Model } from '@luma.gl/engine';

/** Below this a layer is seen through; at or above it, drawn straight onto the map. */
export const OPAQUE = 0.999;

const compositeUniforms = {
  name: 'splatComposite',
  fs: /* glsl */ `\
layout(std140) uniform splatCompositeUniforms {
  float opacity;
} splatComposite;
`,
  uniformTypes: { opacity: 'f32' },
} as any;

const COMPOSITE_VS = /* glsl */ `\
#version 300 es
in vec2 positions;
void main(void) {
  gl_Position = vec4(positions, 0.0, 1.0);
}
`;

// The picture is the size of the map's own buffer, so a fragment reads the texel under it.
const COMPOSITE_FS = /* glsl */ `\
#version 300 es
precision highp float;
uniform sampler2D splatColor;
uniform sampler2D splatDepth;
out vec4 fragColor;
void main(void) {
  ivec2 texel = ivec2(gl_FragCoord.xy);
  vec4 color = texelFetch(splatColor, texel, 0);
  if (color.a < 1.0 / 255.0) {
    discard;
  }
  gl_FragDepth = texelFetch(splatDepth, texel, 0).r;
  // Premultiplied, as the splats were blended.
  fragColor = color * splatComposite.opacity;
}
`;

/** The picture over the map: premultiplied blending, depth tested against the map, never written. */
const COMPOSITE_PARAMETERS = {
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
} as const;
/** The same in WebGL's names, which kepler's own parameters are set in and would otherwise win. */
const COMPOSITE_GL = {
  depthMask: false,
  depthTest: true,
  depthFunc: 0x0203,
  blend: true,
  blendFunc: [1, 0x0303, 1, 0x0303],
  blendEquation: [0x8006, 0x8006],
};

/** The passes into the picture, in luma's names (the model's) and WebGL's (the state around it). */
export interface PicturePass {
  luma: Record<string, unknown>;
  gl: Record<string, unknown>;
}

/** Pass 1: the depth of the nearest splats, no colour. */
export const DEPTH_PASS: PicturePass = {
  luma: { depthWriteEnabled: true, depthCompare: 'less', blend: false, colorMask: 0, cullMode: 'none' },
  gl: { depthMask: true, depthTest: true, depthFunc: 0x0201, blend: false, colorMask: [false, false, false, false] },
};
/** Pass 2: the colours, blended back to front, every splat drawn (the depth is pass 1's alone). */
export const COLOUR_PASS: PicturePass = {
  luma: {
    depthWriteEnabled: false,
    depthCompare: 'always',
    blend: true,
    blendColorSrcFactor: 'one',
    blendColorDstFactor: 'one-minus-src-alpha',
    blendColorOperation: 'add',
    blendAlphaSrcFactor: 'one',
    blendAlphaDstFactor: 'one-minus-src-alpha',
    blendAlphaOperation: 'add',
    colorMask: 0xf,
    cullMode: 'none',
  },
  gl: {
    depthMask: false,
    depthTest: false,
    blend: true,
    blendFunc: [1, 0x0303, 1, 0x0303],
    blendEquation: [0x8006, 0x8006],
    colorMask: [true, true, true, true],
  },
};

interface Picture {
  framebuffer: Framebuffer;
  color: Texture;
  depth: Texture;
  width: number;
  height: number;
  composite: Model | null;
}

/** Each device's pictures, by group. */
const pictures = new WeakMap<object, Map<string, Picture>>();

/** The picture a group of splat layers is drawn into, the size of the map's buffer, made again when that changes. */
export function pictureOf(device: any, group: string, width: number, height: number): Picture {
  let byGroup = pictures.get(device);
  if (!byGroup) {
    byGroup = new Map();
    pictures.set(device, byGroup);
  }
  const known = byGroup.get(group);
  if (known && known.width === width && known.height === height) {
    return known;
  }
  if (known) {
    dropPicture(known);
  }
  const sampler = {
    minFilter: 'nearest',
    magFilter: 'nearest',
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
  } as const;
  // Sampled as well as drawn into (RENDER_ATTACHMENT | TEXTURE).
  const usage = 0x10 | 0x04;
  const color = device.createTexture({
    id: `${group}-picture-color`,
    format: 'rgba8unorm',
    width,
    height,
    usage,
    mipmaps: false,
    sampler,
  });
  const depth = device.createTexture({
    id: `${group}-picture-depth`,
    format: 'depth24plus',
    width,
    height,
    usage,
    mipmaps: false,
    sampler,
  });
  const framebuffer = device.createFramebuffer({
    id: `${group}-picture`,
    width,
    height,
    colorAttachments: [color],
    depthStencilAttachment: depth,
  });
  const picture: Picture = { framebuffer, color, depth, width, height, composite: known?.composite ?? null };
  byGroup.set(group, picture);
  return picture;
}

function dropPicture(picture: Picture): void {
  picture.framebuffer.destroy();
  picture.color.destroy();
  picture.depth.destroy();
}

/** Forgets a group's picture (its layers are gone). */
export function releasePicture(device: any, group: string): void {
  const byGroup = device ? pictures.get(device) : undefined;
  const picture = byGroup?.get(group);
  if (picture) {
    dropPicture(picture);
    picture.composite?.destroy();
    byGroup!.delete(group);
  }
}

/** Lays a picture on the map with an opacity, in the render pass the map is drawn in. */
export function layPicture(device: any, picture: Picture, renderPass: any, opacity: number): void {
  if (!picture.composite) {
    picture.composite = new Model(device, {
      id: 'splat-picture-composite',
      vs: COMPOSITE_VS,
      fs: COMPOSITE_FS,
      modules: [compositeUniforms],
      geometry: new Geometry({
        topology: 'triangle-strip',
        attributes: { positions: { size: 2, value: new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]) } },
      }),
      vertexCount: 4,
      parameters: COMPOSITE_PARAMETERS,
    } as any);
  }
  const composite = picture.composite;
  composite.setBindings({ splatColor: picture.color, splatDepth: picture.depth });
  composite.shaderInputs.setProps({ splatComposite: { opacity } } as any);
  device.withParametersWebGL(COMPOSITE_GL, () => composite.draw(renderPass));
}

/** The size of the buffer a render pass draws into, and the viewport it draws with. */
export function passGeometry(device: any, renderPass: any): { width: number; height: number; viewport: number[] } {
  const target = renderPass?.props?.framebuffer;
  const [width, height]: number[] =
    target && target.handle !== null
      ? [target.width, target.height]
      : device.getDefaultCanvasContext().getDrawingBufferSize();
  return { width, height, viewport: renderPass?.glParameters?.viewport ?? [0, 0, width, height] };
}
